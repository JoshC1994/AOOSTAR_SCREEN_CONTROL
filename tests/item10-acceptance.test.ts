import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn, spawnSync, type ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {DEFAULT_CONFIG} from '../src/presets.ts';
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  EXPECTED_TOTAL_CHUNKS,
  rgbaToRgb565Le,
} from '../src/server/aoostar/protocol.ts';
import {
  clearEmergencyStop,
  closeActiveSerialTransportAsync,
  pushFrameOverRealSerialAsync,
  resetFrameDiffCache,
  sendDisplayOnHandshake,
  sendDisplayOnHandshakeAsync,
  type AsyncSerialPortTransport,
  type SerialPortTransport,
} from '../src/server/aoostar/serial.ts';
import {detectAsterctlBinary, getAsterctlStatus} from '../src/server/aoostar/asterctl.ts';
import {renderScreenToRgbaBuffer} from '../src/server/frameRenderer.ts';
import {
  resetDaemonBackoff,
  resetDaemonRotation,
  runHardwareDaemonTick,
  turnDisplayOffManual,
  turnDisplayOnManual,
} from '../src/server/hardwareDaemon.ts';
import {buildExposedEntities} from '../src/server/telemetry.ts';
import type {LcdScreen, StudioConfig, TelemetrySnapshot} from '../src/types.ts';

interface EmulatorState {
  slave_path: string;
  display_on_count: number;
  display_off_count: number;
  frames: Array<{
    chunks_received: number;
    first_offset: number | null;
    last_offset: number | null;
    offsets_sample: number[];
    sha256_short: string;
  }>;
  unknown_bytes: number;
}

function hasPython3(): boolean {
  const res = spawnSync('python3', ['--version'], {stdio: 'pipe'});
  return res.status === 0;
}

async function startPtyEmulator(extraArgs: string[] = []): Promise<{
  proc: ChildProcessWithoutNullStreams;
  slavePath: string;
  stateFile: string;
  tmpDir: string;
  stop: () => Promise<void>;
}> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-pty-acc-'));
  const stateFile = path.join(tmpDir, 'state.json');
  const scriptPath = path.resolve(process.cwd(), 'tests', 'pty-emulator.py');

  const proc = spawn('python3', [scriptPath, '--state-file', stateFile, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const slavePath = await new Promise<string>((resolve, reject) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`PTY emulator timed out starting. stderr=${stderrBuf}`));
    }, 5000);

    proc.stderr.on('data', (d: Buffer) => {
      stderrBuf += d.toString('utf8');
    });

    proc.stdout.on('data', (d: Buffer) => {
      stdoutBuf += d.toString('utf8');
      const nl = stdoutBuf.indexOf('\n');
      if (nl !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        try {
          const parsed = JSON.parse(line) as {ready?: boolean; slave_path?: string};
          if (parsed.ready && parsed.slave_path) {
            clearTimeout(timer);
            resolve(parsed.slave_path);
          }
        } catch (err) {
          clearTimeout(timer);
          reject(err);
        }
      }
    });

    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`PTY emulator exited prematurely (${code}): ${stderrBuf}`));
    });
  });

  const stop = async () => {
    if (!proc.killed && proc.exitCode === null) {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 1500);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    fs.rmSync(tmpDir, {recursive: true, force: true});
  };

  return {proc, slavePath, stateFile, tmpDir, stop};
}

function readState(stateFile: string): EmulatorState {
  return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as EmulatorState;
}

async function waitForCondition(fn: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('Timed out waiting for PTY emulator state update');
}

function makeTestTelemetry(): TelemetrySnapshot {
  return {
    timestamp: Date.now(),
    sourceMode: 'simulation',
    sourceLabel: 'Test Host',
    isRealUnraidHost: false,
    agentConnected: false,
    haConnected: false,
    system: {
      hostname: 'unraid-test',
      unraidVersion: '7.0.0',
      kernel: '6.6.0-unraid',
      uptimeSeconds: 3600,
      cpuModel: 'AMD Ryzen 7 PRO',
      cpuCores: 16,
      cpuPercent: 25,
      cpuTempC: 50,
      cpuPowerW: 40,
      ramUsedBytes: 16 * 1024 ** 3,
      ramTotalBytes: 64 * 1024 ** 3,
      ramCachedBytes: 4 * 1024 ** 3,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      loadAvg: [0.5, 0.5, 0.5],
    },
    disks: [],
    array: {
      state: 'STARTED',
      parityValid: true,
      parityCheckRunning: false,
      parityProgressPercent: 0,
      usedBytes: 2e12,
      totalBytes: 8e12,
      freeBytes: 6e12,
      moverRunning: false,
    },
    zfsPools: [],
    shares: [],
    containers: [],
    vms: [],
    tasks: [],
    sessions: [],
    ups: {
      connected: false,
      model: '',
      status: 'ONLINE',
      batteryPercent: 0,
      loadPercent: 0,
      runtimeMinutes: 0,
      inputVoltage: 0,
      nominalPowerW: 0,
      currentPowerW: 0,
    },
    fans: [],
    temps: [],
    network: [],
    gpus: [],
    history: {
      timestamps: ['12:00:00'],
      cpuSeries: [25],
      ramSeries: [25],
      netRxSeries: [0],
      netTxSeries: [0],
    },
  };
}

function makeStaticClockScreen(id: string, name: string, durationSec: number, bg = '#0B0E14'): LcdScreen {
  return {
    id,
    name,
    enabled: true,
    durationSec,
    transition: 'cut',
    backgroundType: 'solid',
    backgroundColor: bg,
    backgroundDim: 0,
    themeId: 'dark',
    widgets: [
      {
        id: `${id}-clock`,
        type: 'clock',
        x: 40,
        y: 40,
        w: 280,
        h: 120,
        title: name,
        accentColor: '#F59E0B',
        textColor: '#F8FAFC',
        bgColor: '#0D131D',
        bgOpacity: 0.9,
        borderOpacity: 0.3,
        fontScale: 1,
        fontFamily: 'mono',
      },
    ],
  };
}

test('Item 10 + 11: asterctl absent state handled cleanly and --version binary probe is cached once per env path', () => {
  const prevBin = process.env.AOOSTAR_ASTERCTL_BIN;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-bin-'));

  try {
    process.env.AOOSTAR_ASTERCTL_BIN = path.join(tmpDir, 'does-not-exist-asterctl');
    const absentStatus = getAsterctlStatus();
    assert.equal(absentStatus.available, false);
    assert.equal(absentStatus.mode, 'absent');

    const countFile = path.join(tmpDir, 'calls.txt');
    const wrapperBin = path.join(tmpDir, 'fake-asterctl');
    fs.writeFileSync(
      wrapperBin,
      `#!/bin/sh\necho "1" >> "${countFile}"\necho "asterctl 0.9.0-test"\n`,
      {mode: 0o755}
    );

    process.env.AOOSTAR_ASTERCTL_BIN = wrapperBin;
    const probe1 = detectAsterctlBinary();
    const probe2 = detectAsterctlBinary();
    const probe3 = getAsterctlStatus();

    assert.equal(probe1.available, true);
    assert.equal(probe1.version, 'asterctl 0.9.0-test');
    assert.equal(probe2.version, 'asterctl 0.9.0-test');
    assert.equal(probe3.mode, 'idle');

    const lines = fs.readFileSync(countFile, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, 'asterctl --version should be spawned only once and cached');
  } finally {
    if (prevBin === undefined) delete process.env.AOOSTAR_ASTERCTL_BIN;
    else process.env.AOOSTAR_ASTERCTL_BIN = prevBin;
    detectAsterctlBinary(true);
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

test('Item 13: stale RX ACK byte is drained before DISPLAY_ON on both sync and async transports', async () => {
  class StaleSyncTransport implements SerialPortTransport {
    public rxQueue = Buffer.from([0x41]); // stale 'A' sitting in buffer before DISPLAY_ON
    public writes: Buffer[] = [];
    writeAll(data: Buffer) {
      this.writes.push(Buffer.from(data));
    }
    flush() {}
    bytesToRead() {
      return this.rxQueue.length;
    }
    read(maxBytes: number) {
      const out = this.rxQueue.subarray(0, maxBytes);
      this.rxQueue = this.rxQueue.subarray(out.length);
      return Buffer.from(out);
    }
    sleepMs() {}
    close() {}
  }

  class StaleAsyncTransport implements AsyncSerialPortTransport {
    public rxQueue = Buffer.from([0x41]); // stale 'A'
    public writes: Buffer[] = [];
    async writeAll(data: Buffer) {
      this.writes.push(Buffer.from(data));
    }
    async flush() {}
    async drainRx() {
      this.rxQueue = Buffer.alloc(0);
    }
    async bytesToRead() {
      return this.rxQueue.length;
    }
    async read(maxBytes: number) {
      const out = this.rxQueue.subarray(0, maxBytes);
      this.rxQueue = this.rxQueue.subarray(out.length);
      return Buffer.from(out);
    }
    async sleepMs() {}
    async close() {}
  }

  const staleSync = new StaleSyncTransport();
  assert.throws(
    () => sendDisplayOnHandshake(staleSync),
    /no response received/i,
    'Sync handshake must drain stale 0x41 before DISPLAY_ON and not false-ACK'
  );
  assert.equal(staleSync.writes.length, 1);

  const staleAsync = new StaleAsyncTransport();
  await assert.rejects(
    () => sendDisplayOnHandshakeAsync(staleAsync),
    /no response received/i,
    'Async handshake must drain stale 0x41 before DISPLAY_ON and not false-ACK'
  );
  assert.equal(staleAsync.writes.length, 1);
});

test('Item 9 + 12 + 20: clock seconds tick sends small diff, full push keeps event-loop lag < 50ms, and brightness changes force full sync', async (t) => {
  if (!hasPython3()) {
    t.skip('python3 not installed');
    return;
  }

  const prevSerialEnv = process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
  const prevPtyEnv = process.env.AOOSTAR_TEST_PTY_PATH;
  const emu = await startPtyEmulator();

  try {
    process.env.AOOSTAR_ENABLE_SERIAL_WRITES = 'true';
    process.env.AOOSTAR_TEST_PTY_PATH = emu.slavePath;
    clearEmergencyStop();
    await closeActiveSerialTransportAsync();
    resetFrameDiffCache();

    const telemetry = makeTestTelemetry();
    const exposed = buildExposedEntities(telemetry, [], [], {});
    const screen = makeStaticClockScreen('clock-diff', 'Clock Diff Screen', 15);

    const frameT0 = renderScreenToRgbaBuffer({
      screen,
      telemetry,
      haEntities: [],
      exposedEntities: exposed,
      rotation: 0,
      brightnessPercent: 85,
      now: new Date('2026-11-25T12:00:00Z'),
    });

    // Item 12: measure event loop lag during full 15,360-chunk push
    const lagHist = monitorEventLoopDelay({resolution: 10});
    lagHist.enable();
    const push1 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frameT0,
      requestedDevicePath: emu.slavePath,
      brightnessKey: 85,
    });
    lagHist.disable();
    const maxLagMs = lagHist.max / 1e6;

    assert.equal(push1.fullSync, true);
    assert.equal(push1.chunksSent, EXPECTED_TOTAL_CHUNKS);
    assert.ok(maxLagMs < 50, `Expected max event-loop lag < 50ms during full frame push, got ${maxLagMs.toFixed(1)}ms`);

    await waitForCondition(() => readState(emu.stateFile).frames.length >= 1);

    // Item 9: advance clock by 1 second -> only clock seconds region changes -> small diff chunk count
    const frameT1 = renderScreenToRgbaBuffer({
      screen,
      telemetry,
      haEntities: [],
      exposedEntities: exposed,
      rotation: 0,
      brightnessPercent: 85,
      now: new Date('2026-11-25T12:00:01Z'),
    });
    const rgbT1 = rgbaToRgb565Le(frameT1);
    const expectedHashT1 = crypto.createHash('sha256').update(rgbT1).digest('hex').slice(0, 12).toUpperCase();

    const push2 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frameT1,
      requestedDevicePath: emu.slavePath,
      brightnessKey: 85,
    });
    assert.equal(push2.fullSync, false);
    assert.equal(push2.unchangedSkipped, false);
    assert.ok(
      push2.chunksSent > 0 && push2.chunksSent < 600,
      `Expected small diff for 1s clock change, got ${push2.chunksSent} chunks`
    );

    await waitForCondition(() => readState(emu.stateFile).frames.length >= 2);
    const state2 = readState(emu.stateFile);
    assert.equal(state2.frames[1].chunks_received, push2.chunksSent);
    assert.equal(state2.frames[1].sha256_short, expectedHashT1);
    assert.equal(state2.unknown_bytes, 0);

    // Item 20: changing brightnessKey invalidates diff cache & forces full sync even for identical RGBA buffer
    const push3 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frameT1,
      requestedDevicePath: emu.slavePath,
      brightnessKey: 40,
    });
    assert.equal(push3.fullSync, true);
    assert.equal(push3.chunksSent, EXPECTED_TOTAL_CHUNKS);
  } finally {
    await closeActiveSerialTransportAsync();
    clearEmergencyStop();
    if (prevSerialEnv === undefined) delete process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
    else process.env.AOOSTAR_ENABLE_SERIAL_WRITES = prevSerialEnv;
    if (prevPtyEnv === undefined) delete process.env.AOOSTAR_TEST_PTY_PATH;
    else process.env.AOOSTAR_TEST_PTY_PATH = prevPtyEnv;
    await emu.stop();
  }
});

test('Item 10 + 10d + 18: daemon rotates per-screen dwell times (1s vs 3s) and handles manual off with asterctl uninstalled', async (t) => {
  if (!hasPython3()) {
    t.skip('python3 not installed');
    return;
  }

  const prevSerialEnv = process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
  const prevPtyEnv = process.env.AOOSTAR_TEST_PTY_PATH;
  const prevBin = process.env.AOOSTAR_ASTERCTL_BIN;
  const emu = await startPtyEmulator();

  try {
    process.env.AOOSTAR_ENABLE_SERIAL_WRITES = 'true';
    process.env.AOOSTAR_TEST_PTY_PATH = emu.slavePath;
    process.env.AOOSTAR_ASTERCTL_BIN = '/nonexistent/asterctl-not-installed';
    clearEmergencyStop();
    await closeActiveSerialTransportAsync();
    resetFrameDiffCache();
    resetDaemonBackoff();

    const cfg: StudioConfig = {
      ...structuredClone(DEFAULT_CONFIG),
      integrations: {
        ...structuredClone(DEFAULT_CONFIG.integrations),
        sourceMode: 'simulation',
        haUrl: '',
        haToken: '',
        agentEnabled: false,
      },
      hardware: {
        ...structuredClone(DEFAULT_CONFIG.hardware),
        devicePath: emu.slavePath,
        brightness: 85,
        rotation: 0,
        sleepScheduleEnabled: false,
      },
      screens: [
        makeStaticClockScreen('screen-1s', 'Screen 1s', 1, '#0B0E14'),
        makeStaticClockScreen('screen-3s', 'Screen 3s', 3, '#101828'),
      ],
    };

    const t0 = new Date('2026-11-25T12:00:00Z').getTime();
    resetDaemonRotation(0, t0);

    // Tick 0 at t0: stays on screen-1s
    const m0 = await runHardwareDaemonTick(() => cfg, undefined, undefined, {now: new Date(t0)});
    assert.equal(m0?.screenId, 'screen-1s');

    // Tick 1 at t0 + 1100ms (>= 1s durationSec of screen-1s): rotates to screen-3s
    const m1 = await runHardwareDaemonTick(() => cfg, undefined, undefined, {now: new Date(t0 + 1100)});
    assert.equal(m1?.screenId, 'screen-3s');

    // Tick 2 at t0 + 2300ms (1200ms elapsed on screen-3s < 3s durationSec): stays on screen-3s (not flattened!)
    const m2 = await runHardwareDaemonTick(() => cfg, undefined, undefined, {now: new Date(t0 + 2300)});
    assert.equal(m2?.screenId, 'screen-3s');

    // Tick 3 at t0 + 4200ms (3100ms elapsed on screen-3s >= 3s durationSec): rotates back to screen-1s
    const m3 = await runHardwareDaemonTick(() => cfg, undefined, undefined, {now: new Date(t0 + 4200)});
    assert.equal(m3?.screenId, 'screen-1s');

    // When rotationEnabled is false, daemon stays pinned on current screen even past durationSec
    const pinnedCfg: StudioConfig = {
      ...cfg,
      rotationEnabled: false,
    };
    const m4 = await runHardwareDaemonTick(() => pinnedCfg, undefined, undefined, {now: new Date(t0 + 12_000)});
    assert.equal(m4?.screenId, 'screen-1s');

    // Item 18: Manual off sends DISPLAY_OFF directly via Node transport with asterctl absent
    const offMeta = await turnDisplayOffManual(() => cfg);
    assert.equal(offMeta.powerState, 'off');
    await waitForCondition(() => readState(emu.stateFile).display_off_count >= 1);
    assert.ok(readState(emu.stateFile).display_off_count >= 1);

    // Manual On sends DISPLAY_ON and pushes active screen full frame
    const framesBeforeOn = readState(emu.stateFile).frames.length;
    const onMeta = await turnDisplayOnManual(() => cfg);
    assert.equal(onMeta.powerState, 'on');
    await waitForCondition(() => readState(emu.stateFile).frames.length > framesBeforeOn);
    const finalState = readState(emu.stateFile);
    assert.ok(finalState.display_on_count >= 1);
    assert.equal(finalState.unknown_bytes, 0);
  } finally {
    await closeActiveSerialTransportAsync();
    clearEmergencyStop();
    if (prevSerialEnv === undefined) delete process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
    else process.env.AOOSTAR_ENABLE_SERIAL_WRITES = prevSerialEnv;
    if (prevPtyEnv === undefined) delete process.env.AOOSTAR_TEST_PTY_PATH;
    else process.env.AOOSTAR_TEST_PTY_PATH = prevPtyEnv;
    if (prevBin === undefined) delete process.env.AOOSTAR_ASTERCTL_BIN;
    else process.env.AOOSTAR_ASTERCTL_BIN = prevBin;
    detectAsterctlBinary(true);
    await emu.stop();
  }
});

test('POST /api/config autoPushEnabled=true and POST /api/hardware/deploy arm daemon and push live screen over PTY', async (t) => {
  if (!hasPython3()) {
    t.skip('python3 not installed');
    return;
  }

  const prevNoAutostart = process.env.AOOSTAR_NO_AUTOSTART;
  const prevApiToken = process.env.AOOSTAR_API_TOKEN;
  const prevSerialEnv = process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
  const prevPtyEnv = process.env.AOOSTAR_TEST_PTY_PATH;
  const apiToken = 'test-auto-push-token-123456';

  process.env.AOOSTAR_NO_AUTOSTART = 'true';
  process.env.AOOSTAR_API_TOKEN = apiToken;

  const http = await import('node:http');
  const {createStudioApp} = await import('../server.ts');

  const emu = await startPtyEmulator();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-auto-push-'));

  process.env.AOOSTAR_ENABLE_SERIAL_WRITES = 'true';
  process.env.AOOSTAR_TEST_PTY_PATH = emu.slavePath;
  clearEmergencyStop();
  await closeActiveSerialTransportAsync();
  resetFrameDiffCache();
  resetDaemonBackoff();

  const ctx = createStudioApp({dataDir, bindHost: '127.0.0.1', port: 0});
  const server = http.createServer(ctx.app);

  const reqJson = (port: number, method: string, reqPath: string, body?: unknown) =>
    new Promise<{status: number; body: string}>((resolve, reject) => {
      const payload = body !== undefined ? JSON.stringify(body) : undefined;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          method,
          path: reqPath,
          headers: {
            Host: `127.0.0.1:${port}`,
            Authorization: `Bearer ${apiToken}`,
            Connection: 'close',
            ...(payload ? {'Content-Type': 'application/json'} : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8')}));
        }
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    assert.ok(addr && typeof addr !== 'string');
    const port = addr.port;

    // 1. Ticking autoPushEnabled=true in Settings POSTs config -> arms session push & triggers immediate frame
    const enableRes = await reqJson(port, 'POST', '/api/config', {
      hardware: {
        devicePath: emu.slavePath,
        autoPushEnabled: true,
        sleepScheduleEnabled: false,
      },
    });
    assert.equal(enableRes.status, 200);
    await waitForCondition(() => readState(emu.stateFile).frames.length >= 1, 5000);

    const diag1 = await reqJson(port, 'GET', '/api/diagnostics');
    assert.equal(diag1.status, 200);
    const diag1Json = JSON.parse(diag1.body) as {sessionPushArmed: boolean; daemonState: string};
    assert.equal(diag1Json.sessionPushArmed, true);
    assert.equal(diag1Json.daemonState, 'active');

    // 2. Unchecking autoPushEnabled=false disarms session push and sets daemonState to idle
    const disableRes = await reqJson(port, 'POST', '/api/config', {
      hardware: {autoPushEnabled: false},
    });
    assert.equal(disableRes.status, 200);
    const diag2 = await reqJson(port, 'GET', '/api/diagnostics');
    const diag2Json = JSON.parse(diag2.body) as {sessionPushArmed: boolean; daemonState: string};
    assert.equal(diag2Json.sessionPushArmed, false);
    assert.equal(diag2Json.daemonState, 'idle');

    // 3. Clicking Push to Screen (/api/hardware/deploy) re-enables autoPushEnabled, arms daemon, and pushes frame
    const framesBeforeDeploy = readState(emu.stateFile).frames.length;
    const deployRes = await reqJson(port, 'POST', '/api/hardware/deploy', {
      activeScreenId: ctx.getConfig().screens[0].id,
    });
    assert.equal(deployRes.status, 200);
    const deployJson = JSON.parse(deployRes.body) as {
      hardware: {autoPushEnabled: boolean};
      hardwareDeploy: {deployed: boolean; daemonState: string};
    };
    assert.equal(deployJson.hardware.autoPushEnabled, true);
    assert.equal(deployJson.hardwareDeploy.deployed, true);
    assert.equal(deployJson.hardwareDeploy.daemonState, 'active');
    await waitForCondition(() => readState(emu.stateFile).frames.length > framesBeforeDeploy, 5000);
  } finally {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await ctx.shutdown();
    await closeActiveSerialTransportAsync();
    clearEmergencyStop();
    if (prevNoAutostart === undefined) delete process.env.AOOSTAR_NO_AUTOSTART;
    else process.env.AOOSTAR_NO_AUTOSTART = prevNoAutostart;
    if (prevApiToken === undefined) delete process.env.AOOSTAR_API_TOKEN;
    else process.env.AOOSTAR_API_TOKEN = prevApiToken;
    if (prevSerialEnv === undefined) delete process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
    else process.env.AOOSTAR_ENABLE_SERIAL_WRITES = prevSerialEnv;
    if (prevPtyEnv === undefined) delete process.env.AOOSTAR_TEST_PTY_PATH;
    else process.env.AOOSTAR_TEST_PTY_PATH = prevPtyEnv;
    fs.rmSync(dataDir, {recursive: true, force: true});
    await emu.stop();
  }
});
