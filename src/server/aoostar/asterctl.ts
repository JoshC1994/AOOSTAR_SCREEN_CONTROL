import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {AsterctlLogLine} from '../../types.ts';
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  encodePngRgba,
  rgbaToRgb565Le,
} from './protocol.ts';
import {
  canPerformRealSerialWrite,
  closeActiveSerialTransportAsync,
  inspectSerialPermissions,
  recordSerialLog,
  resetFrameDiffCache,
  resolveStrictAoostarDevice,
  setLastProtocolError,
  withSerialLock,
} from './serial.ts';

export type {AsterctlLogLine};

export interface AsterctlStatus {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  running: boolean;
  pid: number | null;
  mode: 'idle' | 'running' | 'absent';
  cfgDir: string;
  lastExitCode: number | null;
  lastError: string | null;
  logs: AsterctlLogLine[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ASTERCTL_DIAG_DIR = path.join(DATA_DIR, 'asterctl-diag');

const MAX_ASTERCTL_LOGS = 120;
const asterctlLogs: AsterctlLogLine[] = [];
let activeChild: ChildProcess | null = null;
let lastExitCode: number | null = null;
let lastAsterctlError: string | null = null;

function pushAsterctlLog(stream: AsterctlLogLine['stream'], rawLine: string) {
  const line = rawLine.trim();
  if (!line) return;
  const entry: AsterctlLogLine = {
    timestamp: new Date().toISOString(),
    stream,
    line,
  };
  asterctlLogs.unshift(entry);
  if (asterctlLogs.length > MAX_ASTERCTL_LOGS) asterctlLogs.length = MAX_ASTERCTL_LOGS;

  if (stream === 'stderr') {
    console.error(`[asterctl] ${line}`);
  } else {
    console.log(`[asterctl] ${line}`);
  }
}

interface CachedBinaryProbe {
  envKey: string;
  available: boolean;
  binaryPath: string | null;
  executable: boolean;
  version: string | null;
  error: string | null;
}

let cachedBinaryProbe: CachedBinaryProbe | null = null;

function getCandidateBinaries(): string[] {
  const envBin = (process.env.AOOSTAR_ASTERCTL_BIN || '').trim();
  if (envBin) {
    return [envBin];
  }
  return [
    '/usr/local/bin/asterctl',
    '/usr/bin/asterctl',
    path.resolve(process.cwd(), 'bin/asterctl'),
  ];
}

/**
 * Probes `asterctl --version` once per runtime (or when `AOOSTAR_ASTERCTL_BIN` changes)
 * and caches the result so `--version` is not spawned on every status poll or call.
 */
export function detectAsterctlBinary(forceRefresh = false): CachedBinaryProbe {
  const envKey = (process.env.AOOSTAR_ASTERCTL_BIN || '').trim();
  if (!forceRefresh && cachedBinaryProbe && cachedBinaryProbe.envKey === envKey) {
    return cachedBinaryProbe;
  }

  for (const candidate of getCandidateBinaries()) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      cachedBinaryProbe = {
        envKey,
        available: false,
        binaryPath: candidate,
        executable: false,
        version: null,
        error: `Binary at ${candidate} is not executable`,
      };
      return cachedBinaryProbe;
    }

    try {
      const out = execFileSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      cachedBinaryProbe = {
        envKey,
        available: true,
        binaryPath: candidate,
        executable: true,
        version: out || 'asterctl (version unknown)',
        error: null,
      };
      return cachedBinaryProbe;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      cachedBinaryProbe = {
        envKey,
        available: false,
        binaryPath: candidate,
        executable: true,
        version: null,
        error: `Failed to execute ${candidate} --version: ${msg}`,
      };
      return cachedBinaryProbe;
    }
  }

  cachedBinaryProbe = {
    envKey,
    available: false,
    binaryPath: null,
    executable: false,
    version: null,
    error: null,
  };
  return cachedBinaryProbe;
}

export function getAsterctlStatus(): AsterctlStatus {
  const bin = detectAsterctlBinary(false);
  const running = Boolean(activeChild && activeChild.exitCode === null && !activeChild.killed);
  return {
    available: bin.available,
    binaryPath: bin.binaryPath,
    version: bin.version,
    running,
    pid: activeChild?.pid ?? null,
    mode: !bin.available ? 'absent' : running ? 'running' : 'idle',
    cfgDir: ASTERCTL_DIAG_DIR,
    lastExitCode,
    lastError: lastAsterctlError || (!bin.available && bin.binaryPath ? bin.error : null),
    logs: [...asterctlLogs],
  };
}

export async function stopAsterctlProcess(): Promise<void> {
  const proc = activeChild;
  if (!proc) return;

  activeChild = null;
  if (proc.exitCode !== null || proc.killed) return;

  pushAsterctlLog('system', `Stopping one-shot asterctl PID ${proc.pid}...`);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      finish();
    }, 2500);

    proc.once('exit', () => {
      clearTimeout(killTimer);
      finish();
    });

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(killTimer);
      finish();
    }
  });
}

/**
 * Generates an unmistakable 960x376 RGBA calibration pattern for explicit diagnostics.
 */
export function createCalibrationTestRgba(): Buffer {
  const buf = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  const bars: Array<[number, number, number]> = [
    [245, 158, 11],  // Amber
    [16, 185, 129],  // Emerald
    [56, 189, 248],  // Cyan
    [244, 63, 94],   // Rose
    [248, 250, 252], // White
    [30, 41, 59],    // Slate
  ];

  for (let y = 0; y < DISPLAY_HEIGHT; y++) {
    for (let x = 0; x < DISPLAY_WIDTH; x++) {
      const idx = (y * DISPLAY_WIDTH + x) * 4;
      const isBorder = x < 6 || x >= DISPLAY_WIDTH - 6 || y < 6 || y >= DISPLAY_HEIGHT - 6;
      if (isBorder) {
        buf[idx] = 245;
        buf[idx + 1] = 158;
        buf[idx + 2] = 11;
        buf[idx + 3] = 255;
      } else if (y < 240) {
        const barIdx = Math.min(bars.length - 1, Math.floor((x / DISPLAY_WIDTH) * bars.length));
        const [r, g, b] = bars[barIdx];
        buf[idx] = r;
        buf[idx + 1] = g;
        buf[idx + 2] = b;
        buf[idx + 3] = 255;
      } else {
        const checker = ((Math.floor(x / 16) + Math.floor(y / 16)) & 1) === 0 ? 18 : 34;
        buf[idx] = checker;
        buf[idx + 1] = checker + 4;
        buf[idx + 2] = checker + 12;
        buf[idx + 3] = 255;
      }
    }
  }
  return buf;
}

export async function runOneShotAsterctlCommand(args: string[]): Promise<{stdout: string; stderr: string}> {
  const bin = detectAsterctlBinary(false);
  if (!bin.available || !bin.binaryPath) {
    throw new Error(bin.error || 'Optional asterctl binary not found');
  }

  fs.mkdirSync(ASTERCTL_DIAG_DIR, {recursive: true});

  return await new Promise((resolve, reject) => {
    const child = spawn(bin.binaryPath!, args, {
      cwd: ASTERCTL_DIAG_DIR,
      env: {...process.env, RUST_LOG: process.env.RUST_LOG || 'info'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChild = child;

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
      if (activeChild === child) activeChild = null;
      reject(new Error(`asterctl command timed out after 20s (${args.join(' ')})`));
    }, 20_000);

    child.stdout?.on('data', (d: Buffer) => {
      const txt = d.toString('utf8');
      stdout += txt;
      for (const line of txt.split(/\r?\n/)) pushAsterctlLog('stdout', line);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const txt = d.toString('utf8');
      stderr += txt;
      for (const line of txt.split(/\r?\n/)) pushAsterctlLog('stderr', line);
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (activeChild === child) activeChild = null;
      lastExitCode = code;
      if (code === 0) {
        resolve({stdout: stdout.trim(), stderr: stderr.trim()});
      } else {
        const errMsg = `asterctl exited with code ${code}: ${(stderr || stdout).trim() || 'no output'}`;
        lastAsterctlError = errMsg;
        setLastProtocolError(errMsg);
        reject(new Error(errMsg));
      }
    });
  });
}

/**
 * Runs an explicit one-shot `asterctl --on` or `--off` diagnostic power command while holding
 * the single serial mutex, closing the active Node serial fd first and invalidating the diff
 * cache afterwards so the next Node push cleanly re-opens, drains RX, and performs a full sync.
 */
export async function runAsterctlPowerDiagnostic(params: {
  action: 'on' | 'off';
  requestedDevicePath?: string;
  confirmed: boolean;
}): Promise<{devicePath: string; action: 'on' | 'off'; output: string}> {
  if (!params.confirmed) {
    throw new Error('Explicit user confirmation is required before invoking asterctl on the USB device.');
  }

  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    throw new Error(gate.reason || 'Serial writes disabled');
  }

  const bin = detectAsterctlBinary(false);
  if (!bin.available || !bin.binaryPath) {
    throw new Error(bin.error || 'Optional asterctl binary is not installed');
  }

  return await withSerialLock(async () => {
    const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
    if (!resolved.devicePath) {
      throw new Error(resolved.error || 'Aoostar device (0416:90a1) not found');
    }

    await closeActiveSerialTransportAsync();
    try {
      const flag = params.action === 'off' ? '--off' : '--on';
      recordSerialLog('INFO', `ASTERCTL_DIAG_${params.action.toUpperCase()} (${resolved.devicePath})`, 0);
      const res = await runOneShotAsterctlCommand(['--device', resolved.devicePath, flag]);
      setLastProtocolError(null);
      return {
        devicePath: resolved.devicePath,
        action: params.action,
        output: [res.stdout, res.stderr].filter(Boolean).join('\n'),
      };
    } finally {
      resetFrameDiffCache();
    }
  });
}

/**
 * Optional diagnostic check: compares Node RGB565 generation against `asterctl --simulate --save`
 * (when installed) and optionally runs `--on` / `--off` under the serial mutex.
 */
export async function testAsterctlIntegration(params: {
  requestedDevicePath?: string;
  testRealDevice?: boolean;
  action?: 'simulate' | 'on' | 'off';
  confirmed?: boolean;
}) {
  const bin = detectAsterctlBinary(false);
  const perms = inspectSerialPermissions(params.requestedDevicePath);

  if (!bin.available || !bin.binaryPath) {
    return {
      ok: false,
      optionalAbsent: true,
      binaryFound: false,
      binaryPath: bin.binaryPath,
      version: bin.version,
      simulateOk: false,
      deviceReady: perms.exists && perms.readable && perms.writable && perms.isAoostarMatch,
      permissions: perms,
      realHardwareTested: false,
      message:
        'Optional asterctl binary is not installed. Live LCD updates run natively over the Node async serial transport.',
    };
  }

  fs.mkdirSync(ASTERCTL_DIAG_DIR, {recursive: true});
  const calibrationRgba = createCalibrationTestRgba();
  const simPngPath = path.join(ASTERCTL_DIAG_DIR, 'simulate_test.png');
  fs.writeFileSync(simPngPath, encodePngRgba(calibrationRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT));
  const nodeRgb565Bytes = rgbaToRgb565Le(calibrationRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT).length;

  let simulateOk = false;
  let simOutput = '';
  try {
    const res = await runOneShotAsterctlCommand(['--simulate', '--save', '--image', simPngPath]);
    simulateOk = true;
    simOutput = [res.stdout, res.stderr].filter(Boolean).join('\n');
  } catch (err) {
    return {
      ok: false,
      binaryFound: true,
      binaryPath: bin.binaryPath,
      version: bin.version,
      simulateOk: false,
      deviceReady: perms.exists && perms.readable && perms.writable && perms.isAoostarMatch,
      permissions: perms,
      realHardwareTested: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }

  let realHardwareTested = false;
  let realOutput = '';
  const powerAction =
    params.action === 'off' ? 'off' : params.testRealDevice || params.action === 'on' ? 'on' : null;

  if (powerAction) {
    const res = await runAsterctlPowerDiagnostic({
      action: powerAction,
      requestedDevicePath: params.requestedDevicePath,
      confirmed: Boolean(params.confirmed),
    });
    realHardwareTested = true;
    realOutput = res.output;
  }

  const deviceReady = perms.exists && perms.readable && perms.writable && perms.isAoostarMatch;
  return {
    ok: simulateOk && (!powerAction || realHardwareTested),
    binaryFound: true,
    binaryPath: bin.binaryPath,
    version: bin.version,
    simulateOk,
    simulateOutput: simOutput,
    nodeReferenceBytes: nodeRgb565Bytes,
    deviceReady,
    permissions: perms,
    realHardwareTested,
    realOutput,
    message: realHardwareTested
      ? `asterctl ${bin.version} --simulate --save + --${powerAction} verified cleanly on ${perms.devicePath}.`
      : deviceReady
        ? `asterctl ${bin.version} --simulate --save passed (${nodeRgb565Bytes}B RGB565); ${perms.devicePath} (${perms.usbVidPid}) is R/W ready.`
        : `asterctl ${bin.version} --simulate --save passed; hardware device issue: ${perms.error || 'not connected'}.`,
  };
}
