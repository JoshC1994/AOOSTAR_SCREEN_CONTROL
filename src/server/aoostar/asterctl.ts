import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {ExposedEntity, LcdScreen, TelemetrySnapshot} from '../../types.ts';
import {
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  encodePngRgba,
} from './protocol.ts';
import {
  canPerformRealSerialWrite,
  inspectSerialPermissions,
  recordSerialLog,
  resolveStrictAoostarDevice,
  setLastProtocolError,
} from './serial.ts';

export interface AsterctlLogLine {
  timestamp: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
}

export interface AsterctlStatus {
  available: boolean;
  binaryPath: string | null;
  version: string | null;
  running: boolean;
  pid: number | null;
  mode: 'daemon' | 'stopped';
  cfgDir: string;
  monitorJsonPath: string;
  lastExitCode: number | null;
  lastError: string | null;
  logs: AsterctlLogLine[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const ASTERCTL_ROOT = path.join(DATA_DIR, 'asterctl');
const ASTERCTL_CFG_DIR = path.join(ASTERCTL_ROOT, 'cfg');
const ASTERCTL_SENSORS_DIR = path.join(ASTERCTL_CFG_DIR, 'sensors');
const ASTERCTL_VALUES_PATH = path.join(ASTERCTL_SENSORS_DIR, 'values.txt');
const ASTERCTL_MAPPING_PATH = path.join(ASTERCTL_CFG_DIR, 'sensor-mapping.cfg');
const ASTERCTL_MONITOR_JSON = path.join(ASTERCTL_CFG_DIR, 'monitor.json');
const ASTERCTL_FONT_DIR = fs.existsSync('/app/asterctl-fonts')
  ? '/app/asterctl-fonts'
  : path.join(ASTERCTL_ROOT, 'fonts');

const CANDIDATE_BINARIES = [
  process.env.AOOSTAR_ASTERCTL_BIN,
  '/usr/local/bin/asterctl',
  '/usr/bin/asterctl',
  path.resolve(process.cwd(), 'bin/asterctl'),
].filter((p): p is string => Boolean(p && p.trim()));

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

export function detectAsterctlBinary(): {
  available: boolean;
  binaryPath: string | null;
  executable: boolean;
  version: string | null;
  error: string | null;
} {
  for (const candidate of CANDIDATE_BINARIES) {
    if (!fs.existsSync(candidate)) continue;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
    } catch {
      return {
        available: false,
        binaryPath: candidate,
        executable: false,
        version: null,
        error: `Binary at ${candidate} is not executable`,
      };
    }

    try {
      const out = execFileSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 3000,
      }).trim();
      return {
        available: true,
        binaryPath: candidate,
        executable: true,
        version: out || 'asterctl (version unknown)',
        error: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        available: false,
        binaryPath: candidate,
        executable: true,
        version: null,
        error: `Failed to execute ${candidate} --version: ${msg}`,
      };
    }
  }

  return {
    available: false,
    binaryPath: null,
    executable: false,
    version: null,
    error: 'asterctl binary not found in /usr/local/bin/asterctl or AOOSTAR_ASTERCTL_BIN',
  };
}

export function getAsterctlStatus(): AsterctlStatus {
  const bin = detectAsterctlBinary();
  return {
    available: bin.available,
    binaryPath: bin.binaryPath,
    version: bin.version,
    running: Boolean(activeChild && activeChild.exitCode === null && !activeChild.killed),
    pid: activeChild?.pid ?? null,
    mode: activeChild && activeChild.exitCode === null ? 'daemon' : 'stopped',
    cfgDir: ASTERCTL_CFG_DIR,
    monitorJsonPath: ASTERCTL_MONITOR_JSON,
    lastExitCode,
    lastError: lastAsterctlError || bin.error,
    logs: [...asterctlLogs],
  };
}

function ensureAsterctlDirectories() {
  fs.mkdirSync(ASTERCTL_CFG_DIR, {recursive: true});
  fs.mkdirSync(ASTERCTL_SENSORS_DIR, {recursive: true});
  fs.mkdirSync(ASTERCTL_FONT_DIR, {recursive: true});
}

export function writeAsterctlSensorSnapshot(
  telemetry: TelemetrySnapshot,
  exposedEntities: ExposedEntity[]
): void {
  ensureAsterctlDirectories();

  const lines: string[] = [
    `cpu_temperature = ${telemetry.system.cpuTempC}`,
    `cpu_percent = ${telemetry.system.cpuPercent}`,
    `memory_usage = ${Math.round(
      (telemetry.system.ramUsedBytes / Math.max(1, telemetry.system.ramTotalBytes)) * 100
    )}`,
    `cpu_power = ${telemetry.system.cpuPowerW}`,
    `array_used_percent = ${Math.round(
      (telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes)) * 100
    )}`,
  ];

  for (const ent of exposedEntities) {
    const safeKey = ent.id.replace(/[^a-zA-Z0-9_.-]/g, '_');
    lines.push(`${safeKey} = ${ent.rawValue}`);
  }

  fs.writeFileSync(ASTERCTL_VALUES_PATH, `${lines.join('\n')}\n`, 'utf8');

  if (!fs.existsSync(ASTERCTL_MAPPING_PATH)) {
    const mapping = [
      '# Aoostar Display Studio sensor mapping for asterctl',
      'cpu_temperature: cpu_temperature',
      'cpu_percent: cpu_percent',
      'memory_usage: memory_usage',
    ].join('\n');
    fs.writeFileSync(ASTERCTL_MAPPING_PATH, `${mapping}\n`, 'utf8');
  }
}

/**
 * Generates a monitor.json compatible with zehnm/aoostar-rs & xavtb78/aoostar-proxmox-lcd
 * and writes rendered 960x376 PNG panel assets.
 */
export function writeAsterctlMonitorAssets(params: {
  screens: Array<{screen: LcdScreen; rgbaBuffer: Buffer}>;
  refreshSec?: number;
  defaultSwitchTimeSec?: number;
}): {monitorJsonPath: string; imagePaths: string[]} {
  ensureAsterctlDirectories();

  const activeScreens = params.screens.filter((item) => item.screen.enabled);
  const targetList = activeScreens.length > 0 ? activeScreens : params.screens.slice(0, 1);
  if (targetList.length === 0) {
    throw new Error('Cannot generate monitor.json without at least one screen');
  }

  const imagePaths: string[] = [];
  const diyPanels = targetList.map((entry, idx) => {
    const filename = `studio_panel_${idx + 1}.png`;
    const fullImgPath = path.join(ASTERCTL_CFG_DIR, filename);
    const png = encodePngRgba(entry.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    fs.writeFileSync(fullImgPath, png);
    imagePaths.push(fullImgPath);

    return {
      id: entry.screen.id,
      name: entry.screen.name,
      type: 5,
      img: filename,
      sensor: [],
    };
  });

  const switchSec = Math.max(
    1,
    targetList[0]?.screen.durationSec || params.defaultSwitchTimeSec || 15
  );
  const monitorConfig = {
    setup: {
      switchTime: String(switchSec),
      refresh: Math.max(0.5, params.refreshSec ?? 1),
    },
    mianban: diyPanels.map((_p, i) => i + 1),
    diy: diyPanels,
  };

  fs.writeFileSync(ASTERCTL_MONITOR_JSON, JSON.stringify(monitorConfig, null, 2), 'utf8');

  if (!fs.existsSync(ASTERCTL_VALUES_PATH)) {
    fs.writeFileSync(ASTERCTL_VALUES_PATH, 'cpu_temperature = 0\ncpu_percent = 0\n', 'utf8');
  }
  if (!fs.existsSync(ASTERCTL_MAPPING_PATH)) {
    fs.writeFileSync(
      ASTERCTL_MAPPING_PATH,
      'cpu_temperature: cpu_temperature\ncpu_percent: cpu_percent\n',
      'utf8'
    );
  }

  return {monitorJsonPath: ASTERCTL_MONITOR_JSON, imagePaths};
}

export async function stopAsterctlProcess(): Promise<void> {
  const proc = activeChild;
  if (!proc) return;

  activeChild = null;
  if (proc.exitCode !== null || proc.killed) return;

  pushAsterctlLog('system', `Stopping asterctl PID ${proc.pid}...`);
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

export async function startOrRestartAsterctlDaemon(params: {
  requestedDevicePath?: string;
}): Promise<{pid: number; binaryPath: string; devicePath: string}> {
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    lastAsterctlError = gate.reason;
    setLastProtocolError(gate.reason);
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const bin = detectAsterctlBinary();
  if (!bin.available || !bin.binaryPath) {
    lastAsterctlError = bin.error || 'asterctl binary not available';
    setLastProtocolError(lastAsterctlError);
    throw new Error(lastAsterctlError);
  }

  const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
  if (!resolved.devicePath) {
    lastAsterctlError = resolved.error || 'Aoostar device (0416:90a1) not detected';
    setLastProtocolError(lastAsterctlError);
    throw new Error(lastAsterctlError);
  }

  await stopAsterctlProcess();

  const args = [
    '--device',
    resolved.devicePath,
    '--config-dir',
    ASTERCTL_CFG_DIR,
    '--config',
    'monitor.json',
    '--font-dir',
    ASTERCTL_FONT_DIR,
    '--sensor-path',
    ASTERCTL_VALUES_PATH,
    '--sensor-mapping',
    ASTERCTL_MAPPING_PATH,
  ];

  pushAsterctlLog('system', `Starting ${bin.binaryPath} ${args.join(' ')}`);
  recordSerialLog('INFO', 'ASTERCTL_START', 0);

  const child = spawn(bin.binaryPath, args, {
    cwd: ASTERCTL_ROOT,
    env: {...process.env, RUST_LOG: process.env.RUST_LOG || 'info'},
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeChild = child;
  lastAsterctlError = null;

  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      pushAsterctlLog('stdout', line);
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      pushAsterctlLog('stderr', line);
    }
  });

  // Wait 1.6s to confirm asterctl passes the 1-second DISPLAY_ON -> 'A' init check without exiting early
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve();
      }
    }, 1600);

    child.once('error', (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        lastAsterctlError = err.message;
        setLastProtocolError(err.message);
        pushAsterctlLog('system', `Failed to launch asterctl: ${err.message}`);
        reject(err);
      }
    });

    child.once('exit', (code, signal) => {
      lastExitCode = code;
      if (activeChild === child) activeChild = null;
      const errMsg = `asterctl exited unexpectedly (code=${code}, signal=${signal})`;
      pushAsterctlLog('system', errMsg);
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const tail = asterctlLogs
          .slice(0, 4)
          .map((l) => l.line)
          .join(' | ');
        const fullErr = tail ? `${errMsg}: ${tail}` : errMsg;
        lastAsterctlError = fullErr;
        setLastProtocolError(fullErr);
        recordSerialLog('ERROR', 'ASTERCTL_EXIT', 0, fullErr);
        reject(new Error(fullErr));
      }
    });
  });

  setLastProtocolError(null);
  return {
    pid: child.pid ?? 0,
    binaryPath: bin.binaryPath,
    devicePath: resolved.devicePath,
  };
}

/**
 * Generates an unmistakable 960x376 RGBA test pattern for explicit hardware verification.
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
  const bin = detectAsterctlBinary();
  if (!bin.available || !bin.binaryPath) {
    throw new Error(bin.error || 'asterctl binary not found');
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(bin.binaryPath!, args, {
      cwd: ASTERCTL_ROOT,
      env: {...process.env, RUST_LOG: process.env.RUST_LOG || 'info'},
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
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
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
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

export async function sendImageViaAsterctl(params: {
  rgbaBuffer: Uint8Array;
  requestedDevicePath?: string;
}): Promise<{devicePath: string; stdout: string; stderr: string}> {
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    setLastProtocolError(gate.reason);
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
  if (!resolved.devicePath) {
    const err = resolved.error || 'Aoostar device (0416:90a1) not found';
    setLastProtocolError(err);
    throw new Error(err);
  }

  // Stop daemon cleanly so only one process holds /dev/ttyACM0
  await stopAsterctlProcess();
  ensureAsterctlDirectories();

  const imgPath = path.join(ASTERCTL_CFG_DIR, 'oneshot_frame.png');
  fs.writeFileSync(imgPath, encodePngRgba(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT));

  recordSerialLog('INFO', `ASTERCTL_IMAGE_PUSH (${resolved.devicePath})`, imgPath.length);
  const output = await runOneShotAsterctlCommand(['--device', resolved.devicePath, '--image', imgPath]);
  setLastProtocolError(null);
  return {
    devicePath: resolved.devicePath,
    ...output,
  };
}

export async function testAsterctlIntegration(params: {
  requestedDevicePath?: string;
  testRealDevice?: boolean;
  confirmed?: boolean;
}) {
  const bin = detectAsterctlBinary();
  const perms = inspectSerialPermissions(params.requestedDevicePath);

  if (!bin.available || !bin.binaryPath) {
    return {
      ok: false,
      binaryFound: false,
      binaryPath: bin.binaryPath,
      version: bin.version,
      simulateOk: false,
      deviceReady: false,
      permissions: perms,
      realHardwareTested: false,
      message: bin.error || 'asterctl binary is not installed in this runtime',
    };
  }

  ensureAsterctlDirectories();
  const simPngPath = path.join(ASTERCTL_CFG_DIR, 'simulate_test.png');
  fs.writeFileSync(simPngPath, encodePngRgba(createCalibrationTestRgba(), DISPLAY_WIDTH, DISPLAY_HEIGHT));

  let simulateOk = false;
  let simOutput = '';
  try {
    const res = await runOneShotAsterctlCommand(['--simulate', '--image', simPngPath]);
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
  if (params.testRealDevice) {
    if (!params.confirmed) {
      throw new Error('Explicit user confirmation is required before testing the real USB device.');
    }
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      throw new Error(gate.reason || 'Serial writes disabled');
    }
    const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
    if (!resolved.devicePath) {
      throw new Error(resolved.error || 'Aoostar device (0416:90a1) not found');
    }
    await stopAsterctlProcess();
    const res = await runOneShotAsterctlCommand(['--device', resolved.devicePath, '--on']);
    realHardwareTested = true;
    realOutput = [res.stdout, res.stderr].filter(Boolean).join('\n');
  }

  const deviceReady = perms.exists && perms.readable && perms.writable && perms.isAoostarMatch;
  return {
    ok: simulateOk && (!params.testRealDevice || realHardwareTested),
    binaryFound: true,
    binaryPath: bin.binaryPath,
    version: bin.version,
    simulateOk,
    simulateOutput: simOutput,
    deviceReady,
    permissions: perms,
    realHardwareTested,
    realOutput,
    message: realHardwareTested
      ? `asterctl ${bin.version} verified binary + simulated + opened ${perms.devicePath} cleanly.`
      : deviceReady
        ? `asterctl ${bin.version} binary & simulate passed; ${perms.devicePath} (${perms.usbVidPid}) is R/W ready.`
        : `asterctl ${bin.version} binary & simulate passed; hardware device issue: ${perms.error || 'not connected'}.`,
  };
}
