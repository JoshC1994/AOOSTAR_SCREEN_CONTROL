import {execFile, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import type {DetectedUsbDevice} from '../../types.ts';
import {
  buildDataChunkPacket,
  buildFramePacketSequence,
  computeDiffChunkIndices,
  DATA_CHUNK_PACKET_SIZE,
  DISPLAY_HEIGHT,
  DISPLAY_OFF,
  DISPLAY_ON,
  DISPLAY_WIDTH,
  EXPECTED_RGB565_BYTES,
  EXPECTED_TOTAL_CHUNKS,
  formatHexPreview,
  HEADER_END,
  HEADER_START,
  IMG_CHUNK_SIZE,
  INIT_ACK_WAIT_MS,
  parseInitAckResponse,
  rgbaToRgb565Le,
  SERIAL_RETRY,
  UART_BAUDRATE,
  USB_UART_PID_HEX,
  USB_UART_VID_HEX,
} from './protocol.ts';

const execFileAsync = promisify(execFile);

export interface SerialLogEntry {
  id: number;
  timestamp: string;
  direction: 'TX' | 'RX' | 'DRY_RUN' | 'INFO' | 'ERROR';
  label: string;
  byteCount: number;
  hexPreview: string;
  error?: string;
}

export interface SerialPermissionsReport {
  devicePath: string | null;
  exists: boolean;
  readable: boolean;
  writable: boolean;
  modeOctal: string | null;
  usbVidPid: string | null;
  isAoostarMatch: boolean;
  error: string | null;
}

export interface SerialPortTransport {
  writeAll(data: Buffer): void;
  flush(): void;
  bytesToRead(): number;
  read(maxBytes: number): Buffer;
  sleepMs(ms: number): void;
  close(): void;
}

export interface AsyncSerialPortTransport {
  writeAll(data: Buffer): Promise<void>;
  flush(): Promise<void>;
  bytesToRead(): Promise<number>;
  read(maxBytes: number): Promise<Buffer>;
  drainRx(): Promise<void>;
  sleepMs(ms: number): Promise<void>;
  close(): Promise<void>;
}

const MAX_LOG_ENTRIES = 160;
const ASYNC_WRITE_BATCH_BYTES = 8192;
const FULL_SYNC_EVERY_N_FRAMES = 60;

let logSeq = 1;
const serialLogs: SerialLogEntry[] = [];
const dryRunLog: SerialLogEntry[] = [];

let emergencyStopped = false;
let configSerialWritesEnabled = false;
let lastProtocolError: string | null = null;
let lastPacketPreview: string | null = null;
let lastDryRunSummary: {
  ranAt: string;
  screenId: string;
  screenName: string;
  totalChunks: number;
  totalBytesOnWire: number;
  frameSha256Short: string;
} | null = null;

let activeTransport: {devicePath: string; transport: SerialPortTransport; initialized: boolean} | null = null;
let activeAsyncTransport: {
  devicePath: string;
  transport: AsyncSerialPortTransport;
  initialized: boolean;
} | null = null;

let lastSentRgb565: Buffer | null = null;
let lastBrightnessKey: number | null = null;
let framesSinceFullSync = 0;

let serialLockChain: Promise<void> = Promise.resolve();

export async function withSerialLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = serialLockChain;
  let release!: () => void;
  serialLockChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

const sleepArray = new Int32Array(new SharedArrayBuffer(4));
export function sleepSyncMs(ms: number): void {
  if (ms <= 0) return;
  try {
    Atomics.wait(sleepArray, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback wait
    }
  }
}

export function sleepAsyncMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isSerialWritesEnvLocked(): boolean {
  return process.env.AOOSTAR_LOCK_SERIAL_WRITES === 'true';
}

export function isSerialWritesEnvEnabled(): boolean {
  return process.env.AOOSTAR_ENABLE_SERIAL_WRITES === 'true';
}

export function setConfigSerialWritesEnabled(enabled: boolean): void {
  configSerialWritesEnabled = Boolean(enabled);
}

export function isConfigSerialWritesEnabled(): boolean {
  return configSerialWritesEnabled;
}

export function isSerialWritesActive(): boolean {
  if (isSerialWritesEnvEnabled()) return true;
  if (!isSerialWritesEnvLocked() && configSerialWritesEnabled) return true;
  return false;
}

export function isEmergencyStopped(): boolean {
  return emergencyStopped;
}

export function canPerformRealSerialWrite(): {allowed: boolean; reason: string | null} {
  if (emergencyStopped) {
    return {
      allowed: false,
      reason: 'Emergency stop is active. Clear the emergency stop latch on Diagnostics before writing to hardware.',
    };
  }
  if (!isSerialWritesActive()) {
    return {
      allowed: false,
      reason: isSerialWritesEnvLocked()
        ? 'Serial writes are locked off by AOOSTAR_LOCK_SERIAL_WRITES=true.'
        : 'Serial writes are disabled by safety policy (AOOSTAR_ENABLE_SERIAL_WRITES=false). Enable via env or unlock in Settings after Dry Run validation.',
    };
  }
  return {allowed: true, reason: null};
}

export function recordSerialLog(
  direction: SerialLogEntry['direction'],
  label: string,
  dataOrCount: Uint8Array | number,
  error?: string
): void {
  const byteCount = typeof dataOrCount === 'number' ? dataOrCount : dataOrCount.length;
  const hexPreview =
    typeof dataOrCount === 'number' ? '' : formatHexPreview(dataOrCount, 32);

  const entry: SerialLogEntry = {
    id: logSeq++,
    timestamp: new Date().toISOString(),
    direction,
    label,
    byteCount,
    hexPreview,
    error,
  };

  if (direction === 'TX' || direction === 'DRY_RUN') {
    lastPacketPreview = hexPreview ? `${label}: ${hexPreview}` : label;
  }
  if (error) {
    lastProtocolError = error;
  }

  if (direction === 'DRY_RUN') {
    dryRunLog.unshift(entry);
    if (dryRunLog.length > MAX_LOG_ENTRIES) dryRunLog.length = MAX_LOG_ENTRIES;
  } else {
    serialLogs.unshift(entry);
    if (serialLogs.length > MAX_LOG_ENTRIES) serialLogs.length = MAX_LOG_ENTRIES;
  }
}

export function getSerialDiagnosticsState() {
  return {
    serialWritesEnabled: isSerialWritesActive(),
    serialWritesEnvEnabled: isSerialWritesEnvEnabled(),
    serialWritesConfigEnabled: configSerialWritesEnabled,
    serialWritesEnvLocked: isSerialWritesEnvLocked(),
    emergencyStopped,
    lastProtocolError,
    lastPacketPreview,
    lastDryRunSummary,
    serialLogs: [...serialLogs],
    dryRunLog: [...dryRunLog],
  };
}

export function setLastProtocolError(msg: string | null): void {
  lastProtocolError = msg;
}

export function clearDryRunLog(): void {
  dryRunLog.length = 0;
}

export function resetFrameDiffCache(): void {
  lastSentRgb565 = null;
  lastBrightnessKey = null;
  framesSinceFullSync = 0;
}

export function closeActiveSerialTransport(): void {
  if (activeTransport) {
    try {
      activeTransport.transport.close();
    } catch {
      // ignore close error
    }
    activeTransport = null;
  }
  if (activeAsyncTransport) {
    const t = activeAsyncTransport.transport;
    activeAsyncTransport = null;
    void t.close().catch(() => {});
  }
  resetFrameDiffCache();
}

export async function closeActiveSerialTransportAsync(): Promise<void> {
  if (activeTransport) {
    try {
      activeTransport.transport.close();
    } catch {
      // ignore
    }
    activeTransport = null;
  }
  if (activeAsyncTransport) {
    const t = activeAsyncTransport.transport;
    activeAsyncTransport = null;
    try {
      await t.close();
    } catch {
      // ignore
    }
  }
  resetFrameDiffCache();
}

export function activateEmergencyStop(reason = 'Emergency stop triggered by operator'): void {
  emergencyStopped = true;
  closeActiveSerialTransport();
  recordSerialLog('ERROR', 'EMERGENCY_STOP', 0, reason);
  console.warn(`[aoostar-serial] ${reason}`);
}

export function clearEmergencyStop(): void {
  emergencyStopped = false;
  lastProtocolError = null;
  resetFrameDiffCache();
  recordSerialLog('INFO', 'EMERGENCY_STOP_CLEARED', 0);
}

function normalizeUsbId(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/^0x/, '');
  return cleaned ? cleaned.padStart(4, '0') : 'unknown';
}

export interface UsbTtyAttrs {
  vendorId: string;
  productId: string;
  name: string;
  source?: string;
}

function decodeLinuxDevNumber(rdev: number): {major: number; minor: number} | null {
  if (!Number.isFinite(rdev) || rdev <= 0) return null;
  const d = BigInt(Math.trunc(rdev));
  const major = Number(((d >> 8n) & 0xfffn) | ((d >> 32n) & ~0xfffn));
  const minor = Number((d & 0xffn) | ((d >> 12n) & ~0xffn));
  if (major <= 0 && minor <= 0) return null;
  return {major, minor};
}

function parseUsbUeventProduct(
  ueventText: string,
  dirName: string
): {vendorId: string; productId: string} | null {
  const isUsbNode =
    /^DEVTYPE=usb_(device|interface)$/m.test(ueventText) ||
    /^SUBSYSTEM=usb$/m.test(ueventText) ||
    /^INTERFACE=/m.test(ueventText) ||
    /^\d+-[\d.]+(?::[\d.]+)?$/.test(dirName);
  if (!isUsbNode) return null;

  const prodMatch = /^PRODUCT=([0-9a-fA-F]+)\/([0-9a-fA-F]+)(?:\/|$)/m.exec(ueventText);
  if (!prodMatch) return null;
  const vendorId = normalizeUsbId(prodMatch[1]);
  const productId = normalizeUsbId(prodMatch[2]);
  if (vendorId === 'unknown' || productId === 'unknown') return null;
  return {vendorId, productId};
}

function readUsbAttrsUpTree(
  startDir: string,
  sysRoot: string,
  defaultName: string
): UsbTtyAttrs | null {
  const devicesRoot = path.resolve(sysRoot, 'devices');
  const resolvedSysRoot = path.resolve(sysRoot);

  let cur: string;
  try {
    cur = fs.realpathSync(startDir);
  } catch {
    return null;
  }

  let fallbackIds: {vendorId: string; productId: string} | null = null;
  let detectedName = defaultName;

  for (let depth = 0; depth < 14; depth++) {
    try {
      const productPath = path.join(cur, 'product');
      if (fs.existsSync(productPath)) {
        const prod = fs.readFileSync(productPath, 'utf8').trim();
        if (prod) detectedName = prod;
      }

      const idVendorPath = path.join(cur, 'idVendor');
      const idProductPath = path.join(cur, 'idProduct');
      if (fs.existsSync(idVendorPath) && fs.existsSync(idProductPath)) {
        const vendorId = normalizeUsbId(fs.readFileSync(idVendorPath, 'utf8'));
        const productId = normalizeUsbId(fs.readFileSync(idProductPath, 'utf8'));
        if (vendorId !== 'unknown' && productId !== 'unknown') {
          return {vendorId, productId, name: detectedName, source: cur};
        }
      }

      if (!fallbackIds) {
        const ueventPath = path.join(cur, 'uevent');
        if (fs.existsSync(ueventPath)) {
          const parsed = parseUsbUeventProduct(
            fs.readFileSync(ueventPath, 'utf8'),
            path.basename(cur)
          );
          if (parsed) {
            fallbackIds = parsed;
          }
        }
      }
    } catch {
      // continue walking up sysfs hierarchy
    }

    if (cur === devicesRoot || cur === resolvedSysRoot) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (fallbackIds) {
    return {
      vendorId: fallbackIds.vendorId,
      productId: fallbackIds.productId,
      name: detectedName,
      source: 'uevent',
    };
  }

  return null;
}

export function readUsbAttrsForTty(
  devPath: string,
  options?: {sysRoot?: string; rdev?: number; devRealPath?: string}
): UsbTtyAttrs {
  const sysRoot = options?.sysRoot ?? '/sys';
  const requestedName = path.basename(devPath);
  let realPath = options?.devRealPath ?? devPath;
  if (!options?.devRealPath) {
    try {
      realPath = fs.realpathSync(devPath);
    } catch {
      realPath = devPath;
    }
  }
  const realName = path.basename(realPath);
  const ttyNames = new Set<string>([realName, requestedName]);

  const startDirs: string[] = [];
  const addStartDir = (candidate: string): string | null => {
    try {
      const resolved = fs.realpathSync(candidate);
      if (!startDirs.includes(resolved)) {
        startDirs.push(resolved);
      }
      return resolved;
    } catch {
      return null;
    }
  };

  // 1. Resolve via /sys/dev/char/<major>:<minor> so container remaps (e.g. --device=/dev/ttyACM1:/dev/ttyACM0) resolve accurately
  let rdev = options?.rdev;
  if (rdev === undefined) {
    try {
      rdev = fs.statSync(devPath).rdev;
    } catch {
      rdev = undefined;
    }
  }
  if (rdev !== undefined) {
    const devNum = decodeLinuxDevNumber(rdev);
    if (devNum) {
      const charBase = path.join(sysRoot, 'dev', 'char', `${devNum.major}:${devNum.minor}`);
      addStartDir(path.join(charBase, 'device'));
      const resolvedChar = addStartDir(charBase);
      if (resolvedChar) {
        ttyNames.add(path.basename(resolvedChar));
      }
    }
  }

  // 2. Resolve via /sys/class/tty/<name>/device (must call realpathSync before walking up parents!)
  for (const name of ttyNames) {
    const ttyBase = path.join(sysRoot, 'class', 'tty', name);
    addStartDir(path.join(ttyBase, 'device'));
    addStartDir(ttyBase);
  }

  for (const startDir of startDirs) {
    const attrs = readUsbAttrsUpTree(startDir, sysRoot, realName);
    if (attrs) return attrs;
  }

  // 3. Fallback: scan /sys/bus/usb/devices/*/tty/<name> or /sys/bus/usb/devices/*/<name>
  const usbDevicesRoot = path.join(sysRoot, 'bus', 'usb', 'devices');
  try {
    const entries = fs.readdirSync(usbDevicesRoot);
    for (const entry of entries) {
      const entryDir = path.join(usbDevicesRoot, entry);
      for (const name of ttyNames) {
        if (
          fs.existsSync(path.join(entryDir, 'tty', name)) ||
          fs.existsSync(path.join(entryDir, name))
        ) {
          const attrs = readUsbAttrsUpTree(entryDir, sysRoot, realName);
          if (attrs) return attrs;
        }
      }
    }
  } catch {
    // ignore /sys/bus/usb/devices read failure
  }

  return {vendorId: 'unknown', productId: 'unknown', name: realName};
}

function isAllowedTestPtyPath(candidatePath: string): boolean {
  const ptyOverride = (process.env.AOOSTAR_TEST_PTY_PATH || '').trim();
  if (!ptyOverride) return false;
  try {
    const reqReal = fs.realpathSync(candidatePath);
    const ptyReal = fs.realpathSync(ptyOverride);
    return reqReal === ptyReal && /^\/dev\/pts\/\d+$/.test(reqReal);
  } catch {
    return false;
  }
}

function isAllowedSerialDevicePath(candidatePath: string): boolean {
  if (!candidatePath.startsWith('/dev/')) return false;
  if (isAllowedTestPtyPath(candidatePath)) return true;
  if (candidatePath === '/dev/aoostar_lcd') return true;
  if (/^\/dev\/tty(ACM|USB)\d+$/.test(candidatePath)) return true;
  if (candidatePath.startsWith('/dev/serial/by-id/')) {
    try {
      const resolved = fs.realpathSync(candidatePath);
      return /^\/dev\/tty(ACM|USB)\d+$/.test(resolved);
    } catch {
      return false;
    }
  }
  return false;
}

export function scanUsbSerialDevices(): DetectedUsbDevice[] {
  const devices: DetectedUsbDevice[] = [];
  const seenRealPaths = new Set<string>();

  const candidates: string[] = [];
  if (fs.existsSync('/dev/aoostar_lcd')) {
    candidates.push('/dev/aoostar_lcd');
  }

  try {
    const devFiles = fs
      .readdirSync('/dev')
      .filter((f) => f.startsWith('ttyACM') || f.startsWith('ttyUSB'))
      .sort();
    for (const f of devFiles) {
      candidates.push(`/dev/${f}`);
    }
  } catch {
    // ignore /dev read failure
  }

  for (const fullPath of candidates) {
    let realPath = fullPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      // keep fullPath
    }
    if (seenRealPaths.has(realPath) && fullPath !== '/dev/aoostar_lcd') continue;
    seenRealPaths.add(realPath);

    const attrs = readUsbAttrsForTty(fullPath);
    let writable = false;
    try {
      fs.accessSync(fullPath, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    devices.push({
      path: fullPath,
      name: attrs.name,
      vendorId: attrs.vendorId === 'unknown' ? 'unknown' : `0x${attrs.vendorId}`,
      productId: attrs.productId === 'unknown' ? 'unknown' : `0x${attrs.productId}`,
      isAoostarMatch: attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX,
      writable,
    });
  }

  return devices;
}

/**
 * Strictly resolves the Aoostar LCD device (VID 0x0416, PID 0x90a1).
 * Fail-closed: rejects unknown sysfs USB IDs unless explicit forceUnverifiedDevice+confirmUnverifiedDevice
 * is passed OR an approved Linux PTY path via AOOSTAR_TEST_PTY_PATH is targeted.
 */
export function resolveStrictAoostarDevice(
  requestedPath?: string,
  options?: {forceUnverifiedDevice?: boolean; confirmUnverifiedDevice?: boolean; sysRoot?: string}
): {
  devicePath: string | null;
  match: DetectedUsbDevice | null;
  error: string | null;
} {
  const trimmed = (requestedPath || '').trim();
  const forceAllowed = Boolean(options?.forceUnverifiedDevice && options?.confirmUnverifiedDevice);

  if (trimmed) {
    if (!isAllowedSerialDevicePath(trimmed)) {
      return {
        devicePath: null,
        match: null,
        error: `Rejected serial device path "${trimmed}": only /dev/ttyACM*, /dev/ttyUSB*, /dev/aoostar_lcd, or /dev/serial/by-id/* are allowed.`,
      };
    }

    if (isAllowedTestPtyPath(trimmed)) {
      let writable = false;
      try {
        fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
      return {
        devicePath: trimmed,
        match: {
          path: trimmed,
          name: 'PTY Hardware Emulator',
          vendorId: `0x${USB_UART_VID_HEX}`,
          productId: `0x${USB_UART_PID_HEX}`,
          isAoostarMatch: true,
          writable,
        },
        error: null,
      };
    }

    if (!fs.existsSync(trimmed)) {
      return {
        devicePath: null,
        match: null,
        error: `Serial device ${trimmed} does not exist`,
      };
    }

    const attrs = readUsbAttrsForTty(trimmed, options?.sysRoot ? {sysRoot: options.sysRoot} : undefined);
    const isMatch = attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX;

    if (!isMatch && !forceAllowed) {
      const gotId =
        attrs.vendorId === 'unknown' || attrs.productId === 'unknown'
          ? 'unknown USB VID/PID'
          : `0x${attrs.vendorId}:0x${attrs.productId}`;
      const sysRootCheck = options?.sysRoot ?? '/sys';
      const sysfsHint =
        gotId === 'unknown USB VID/PID' &&
        !fs.existsSync(path.join(sysRootCheck, 'class', 'tty')) &&
        !fs.existsSync(path.join(sysRootCheck, 'dev', 'char'))
          ? ' (sysfs tty/dev metadata unavailable in container; ensure /sys is accessible)'
          : '';
      return {
        devicePath: null,
        match: null,
        error: `Device ${trimmed} failed strict VID/PID validation (${gotId}; expected 0x${USB_UART_VID_HEX}:0x${USB_UART_PID_HEX})${sysfsHint}.`,
      };
    }

    let writable = false;
    try {
      fs.accessSync(trimmed, fs.constants.R_OK | fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }

    return {
      devicePath: trimmed,
      match: {
        path: trimmed,
        name: attrs.name,
        vendorId: attrs.vendorId === 'unknown' ? 'unknown' : `0x${attrs.vendorId}`,
        productId: attrs.productId === 'unknown' ? 'unknown' : `0x${attrs.productId}`,
        isAoostarMatch: isMatch,
        writable,
      },
      error: null,
    };
  }

  const ptyOverride = (process.env.AOOSTAR_TEST_PTY_PATH || '').trim();
  if (ptyOverride && isAllowedTestPtyPath(ptyOverride)) {
    return resolveStrictAoostarDevice(ptyOverride);
  }

  const devices = scanUsbSerialDevices();
  const exact = devices.find((d) => d.isAoostarMatch);
  if (exact) {
    return {devicePath: exact.path, match: exact, error: null};
  }

  return {
    devicePath: null,
    match: null,
    error: `Aoostar USB serial device (VID 0x${USB_UART_VID_HEX}, PID 0x${USB_UART_PID_HEX}) not found`,
  };
}

export function inspectSerialPermissions(preferredPath?: string): SerialPermissionsReport {
  const devices = scanUsbSerialDevices();
  const exact = devices.find((d) => d.isAoostarMatch);
  const candidatePath =
    exact?.path ||
    (preferredPath && fs.existsSync(preferredPath) ? preferredPath : null) ||
    (fs.existsSync('/dev/ttyACM0') ? '/dev/ttyACM0' : null);

  if (!candidatePath || !fs.existsSync(candidatePath)) {
    return {
      devicePath: preferredPath || '/dev/ttyACM0',
      exists: false,
      readable: false,
      writable: false,
      modeOctal: null,
      usbVidPid: null,
      isAoostarMatch: false,
      error: `Device ${preferredPath || '/dev/ttyACM0'} not present`,
    };
  }

  let readable = false;
  let writable = false;
  let modeOctal: string | null = null;
  let permError: string | null = null;

  try {
    const stat = fs.statSync(candidatePath);
    modeOctal = `0${(stat.mode & 0o777).toString(8)}`;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }

  try {
    fs.accessSync(candidatePath, fs.constants.R_OK);
    readable = true;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }

  try {
    fs.accessSync(candidatePath, fs.constants.W_OK);
    writable = true;
  } catch (err) {
    permError = err instanceof Error ? err.message : String(err);
  }

  const attrs = readUsbAttrsForTty(candidatePath);
  const vidPid =
    attrs.vendorId !== 'unknown' && attrs.productId !== 'unknown'
      ? `0x${attrs.vendorId}:0x${attrs.productId}`
      : null;
  const isAoostarMatch =
    (attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX) ||
    isAllowedTestPtyPath(candidatePath);

  return {
    devicePath: candidatePath,
    exists: true,
    readable,
    writable,
    modeOctal,
    usbVidPid: vidPid,
    isAoostarMatch,
    error: !readable || !writable ? permError || 'Missing R/W permissions on serial device' : null,
  };
}

function buildSttyArgs(devicePath: string): string[] {
  return [
    '-F',
    devicePath,
    String(UART_BAUDRATE),
    'cs8',
    '-cstopb',
    '-parenb',
    'clocal',
    'cread',
    '-crtscts',
    '-hupcl',
    'raw',
    '-echo',
    '-echoe',
    '-echok',
    '-onlcr',
    '-icrnl',
    '-ixon',
    '-ixoff',
    '-opost',
  ];
}

function assertSerialDeviceRwAccess(realPath: string): void {
  try {
    fs.accessSync(realPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (err) {
    let detail = '';
    try {
      const st = fs.statSync(realPath);
      const modeOctal = `0${(st.mode & 0o777).toString(8)}`;
      const procUid = typeof process.getuid === 'function' ? process.getuid() : '?';
      const procGid = typeof process.getgid === 'function' ? process.getgid() : '?';
      const procGroups = typeof process.getgroups === 'function' ? process.getgroups().join(',') : '';
      detail = ` (device owner=${st.uid}:${st.gid} mode=${modeOctal}; process uid=${procUid} gid=${procGid} groups=[${procGroups}])`;
    } catch {
      // ignore stat failure
    }
    const baseMsg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Permission denied accessing ${realPath}${detail}. Ensure the container runs via docker-entrypoint.sh or passes --group-add=<host_device_gid>. (${baseMsg})`
    );
  }
}

export class LinuxSerialFdTransport implements SerialPortTransport {
  private fd: number | null;
  private readonly devicePath: string;
  private pendingReadBuf: Buffer = Buffer.alloc(0);

  constructor(devicePath: string) {
    this.devicePath = fs.realpathSync(devicePath);
    assertSerialDeviceRwAccess(this.devicePath);

    try {
      execFileSync('stty', buildSttyArgs(this.devicePath), {stdio: 'pipe', timeout: 2000});
    } catch (err) {
      if (!isAllowedTestPtyPath(this.devicePath)) {
        throw err;
      }
      // On some kernels PTY slaves reject high speed changes; apply raw mode cleanly
      execFileSync('stty', ['-F', this.devicePath, 'raw', '-echo', 'cs8', '-parenb', '-cstopb'], {
        stdio: 'pipe',
        timeout: 2000,
      });
    }

    const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY | (fs.constants.O_NONBLOCK ?? 0);
    this.fd = fs.openSync(this.devicePath, flags);
  }

  writeAll(data: Buffer): void {
    if (this.fd === null) throw new Error('Serial port is closed');
    let offset = 0;
    const deadline = Date.now() + 2000;
    while (offset < data.length) {
      try {
        const written = fs.writeSync(this.fd, data, offset, data.length - offset);
        if (written > 0) {
          offset += written;
        } else {
          if (Date.now() > deadline) {
            throw new Error(`Serial write timed out after ${offset}/${data.length} bytes`);
          }
          sleepSyncMs(1);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK' || code === 'EINTR') {
          if (Date.now() > deadline) {
            throw new Error(`Serial write timed out (${code}) after ${offset}/${data.length} bytes`);
          }
          sleepSyncMs(1);
          continue;
        }
        throw err;
      }
    }
  }

  flush(): void {
    if (this.fd === null) throw new Error('Serial port is closed');
    try {
      fs.fsyncSync(this.fd);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EINVAL' && code !== 'ENOTSUP') {
        throw err;
      }
    }
  }

  private pollIncoming(): void {
    if (this.fd === null) return;
    const scratch = Buffer.alloc(256);
    while (true) {
      try {
        const n = fs.readSync(this.fd, scratch, 0, scratch.length, null);
        if (n <= 0) break;
        this.pendingReadBuf = Buffer.concat([this.pendingReadBuf, scratch.subarray(0, n)]);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') break;
        if (code === 'EINTR') continue;
        throw err;
      }
    }
  }

  bytesToRead(): number {
    this.pollIncoming();
    return this.pendingReadBuf.length;
  }

  read(maxBytes: number): Buffer {
    this.pollIncoming();
    const n = Math.min(maxBytes, this.pendingReadBuf.length);
    const out = this.pendingReadBuf.subarray(0, n);
    this.pendingReadBuf = this.pendingReadBuf.subarray(n);
    return Buffer.from(out);
  }

  sleepMs(ms: number): void {
    sleepSyncMs(ms);
  }

  close(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // ignore
      }
      this.fd = null;
    }
  }
}

export class LinuxAsyncSerialTransport implements AsyncSerialPortTransport {
  private handle: fsp.FileHandle | null = null;
  private readonly devicePath: string;
  private pendingReadBuf: Buffer = Buffer.alloc(0);
  private datasyncUnsupported = false;

  private constructor(devicePath: string, handle: fsp.FileHandle) {
    this.devicePath = devicePath;
    this.handle = handle;
  }

  static async open(devicePath: string): Promise<LinuxAsyncSerialTransport> {
    const realPath = await fsp.realpath(devicePath);
    assertSerialDeviceRwAccess(realPath);
    try {
      await execFileAsync('stty', buildSttyArgs(realPath), {timeout: 2000});
    } catch (err) {
      if (!isAllowedTestPtyPath(realPath)) {
        throw err;
      }
      await execFileAsync('stty', ['-F', realPath, 'raw', '-echo', 'cs8', '-parenb', '-cstopb'], {
        timeout: 2000,
      });
    }
    const flags = fs.constants.O_RDWR | fs.constants.O_NOCTTY | (fs.constants.O_NONBLOCK ?? 0);
    const handle = await fsp.open(realPath, flags);
    const transport = new LinuxAsyncSerialTransport(realPath, handle);
    await transport.drainRx();
    return transport;
  }

  async writeAll(data: Buffer): Promise<void> {
    if (!this.handle) throw new Error('Async serial port is closed');
    let offset = 0;
    const deadline = Date.now() + 8000;
    while (offset < data.length) {
      const sliceLen = Math.min(ASYNC_WRITE_BATCH_BYTES, data.length - offset);
      try {
        const res = await this.handle.write(data, offset, sliceLen, null);
        if (res.bytesWritten > 0) {
          offset += res.bytesWritten;
        } else {
          if (Date.now() > deadline) {
            throw new Error(`Async serial write timed out after ${offset}/${data.length} bytes`);
          }
          await sleepAsyncMs(1);
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK' || code === 'EINTR') {
          if (Date.now() > deadline) {
            throw new Error(`Async serial write timed out (${code}) after ${offset}/${data.length} bytes`);
          }
          await sleepAsyncMs(1);
          continue;
        }
        throw err;
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.handle) throw new Error('Async serial port is closed');
    if (this.datasyncUnsupported) return;
    try {
      await this.handle.datasync();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EINVAL' || code === 'ENOTSUP') {
        this.datasyncUnsupported = true;
        return;
      }
      throw err;
    }
  }

  private async pollIncoming(): Promise<void> {
    if (!this.handle) return;
    const scratch = Buffer.alloc(512);
    while (true) {
      try {
        const {bytesRead} = await this.handle.read(scratch, 0, scratch.length, null);
        if (bytesRead <= 0) break;
        this.pendingReadBuf = Buffer.concat([this.pendingReadBuf, scratch.subarray(0, bytesRead)]);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EAGAIN' || code === 'EWOULDBLOCK') break;
        if (code === 'EINTR') continue;
        throw err;
      }
    }
  }

  async drainRx(): Promise<void> {
    await this.pollIncoming();
    if (this.pendingReadBuf.length > 0) {
      this.pendingReadBuf = Buffer.alloc(0);
    }
  }

  async bytesToRead(): Promise<number> {
    await this.pollIncoming();
    return this.pendingReadBuf.length;
  }

  async read(maxBytes: number): Promise<Buffer> {
    await this.pollIncoming();
    const n = Math.min(maxBytes, this.pendingReadBuf.length);
    const out = this.pendingReadBuf.subarray(0, n);
    this.pendingReadBuf = this.pendingReadBuf.subarray(n);
    return Buffer.from(out);
  }

  async sleepMs(ms: number): Promise<void> {
    await sleepAsyncMs(ms);
  }

  async close(): Promise<void> {
    if (this.handle) {
      const h = this.handle;
      this.handle = null;
      await h.close().catch(() => {});
    }
  }
}

/**
 * Exact `AooScreen::send` retry loop from crates/asterctl-lcd/src/aoo_screen.rs (SERIAL_RETRY = 3).
 */
export function writePacketWithRetry(
  transport: SerialPortTransport,
  packet: Buffer,
  label: string,
  logPacket = true
): void {
  let retry = 0;
  while (true) {
    try {
      transport.writeAll(packet);
      transport.flush();
      if (logPacket) {
        recordSerialLog('TX', label, packet);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retry < SERIAL_RETRY) {
        retry += 1;
        recordSerialLog('INFO', `${label}_RETRY_${retry}`, packet.length, msg);
        continue;
      }
      recordSerialLog('ERROR', `${label}_FAILED`, packet.length, msg);
      throw err;
    }
  }
}

export async function writePacketWithRetryAsync(
  transport: AsyncSerialPortTransport,
  packet: Buffer,
  label: string,
  logPacket = true
): Promise<void> {
  let retry = 0;
  while (true) {
    try {
      await transport.writeAll(packet);
      await transport.flush();
      if (logPacket) {
        recordSerialLog('TX', label, packet);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (retry < SERIAL_RETRY) {
        retry += 1;
        recordSerialLog('INFO', `${label}_RETRY_${retry}`, packet.length, msg);
        await sleepAsyncMs(10);
        continue;
      }
      recordSerialLog('ERROR', `${label}_FAILED`, packet.length, msg);
      throw err;
    }
  }
}

/**
 * Exact `AooScreen::init` sequence from crates/asterctl-lcd/src/aoo_screen.rs:
 *   1. Write DISPLAY_ON (AA 55 AA 55 0B 00 00 00)
 *   2. Sleep 1000ms
 *   3. Check bytes_to_read() > 0 (fail if 0)
 *   4. Read bytes and verify b'A' (0x41) is present (fail otherwise)
 */
export function sendDisplayOnHandshake(
  transport: SerialPortTransport,
  options?: {noInitCheck?: boolean}
): {ackOk: boolean; ackBytesHex: string} {
  // Drain any stale RX bytes before sending DISPLAY_ON so old bytes never masquerade as ACK
  const staleCount = transport.bytesToRead();
  if (staleCount > 0) {
    transport.read(staleCount);
  }
  writePacketWithRetry(transport, DISPLAY_ON, 'DISPLAY_ON', true);

  if (options?.noInitCheck) {
    recordSerialLog('INFO', 'DISPLAY_ON_NO_INIT_CHECK', 0);
    return {ackOk: true, ackBytesHex: 'SKIPPED (no-init-check)'};
  }

  transport.sleepMs(INIT_ACK_WAIT_MS);
  const available = transport.bytesToRead();
  if (available === 0) {
    const errMsg = 'Initialization failed, no response received after 1000ms (expected "A" / 0x41)';
    recordSerialLog('ERROR', 'INIT_ACK_TIMEOUT', 0, errMsg);
    throw new Error(errMsg);
  }

  const rxBuf = transport.read(available);
  const ack = parseInitAckResponse(rxBuf);
  recordSerialLog('RX', 'INIT_ACK', rxBuf, ack.errorMessage ?? undefined);

  if (!ack.ok) {
    throw new Error(ack.errorMessage || 'Initialization failed, invalid ACK response');
  }

  return {ackOk: true, ackBytesHex: ack.hexPreview};
}

export async function sendDisplayOnHandshakeAsync(
  transport: AsyncSerialPortTransport,
  options?: {noInitCheck?: boolean}
): Promise<{ackOk: boolean; ackBytesHex: string}> {
  await transport.drainRx();
  await writePacketWithRetryAsync(transport, DISPLAY_ON, 'DISPLAY_ON', true);

  if (options?.noInitCheck) {
    recordSerialLog('INFO', 'DISPLAY_ON_NO_INIT_CHECK', 0);
    return {ackOk: true, ackBytesHex: 'SKIPPED (no-init-check)'};
  }

  await transport.sleepMs(INIT_ACK_WAIT_MS);
  const available = await transport.bytesToRead();
  if (available === 0) {
    const errMsg = 'Initialization failed, no response received after 1000ms (expected "A" / 0x41)';
    recordSerialLog('ERROR', 'INIT_ACK_TIMEOUT', 0, errMsg);
    throw new Error(errMsg);
  }

  const rxBuf = await transport.read(available);
  const ack = parseInitAckResponse(rxBuf);
  recordSerialLog('RX', 'INIT_ACK', rxBuf, ack.errorMessage ?? undefined);

  if (!ack.ok) {
    throw new Error(ack.errorMessage || 'Initialization failed, invalid ACK response');
  }

  return {ackOk: true, ackBytesHex: ack.hexPreview};
}

export function sendDisplayOffCommand(transport: SerialPortTransport): void {
  writePacketWithRetry(transport, DISPLAY_OFF, 'DISPLAY_OFF', true);
}

/**
 * Exact `AooScreen::send_image` sequence (sync transport, kept for unit/integration parity tests).
 */
export function pushFrameViaSerialTransport(params: {
  transport: SerialPortTransport;
  rgb565Le: Buffer;
  initializeDisplay?: boolean;
}): {
  chunksSent: number;
  totalChunks: number;
  totalBytesOnWire: number;
  ackBytesHex: string | null;
  frameSha256Short: string;
} {
  let ackBytesHex: string | null = null;
  if (params.initializeDisplay !== false) {
    const init = sendDisplayOnHandshake(params.transport);
    ackBytesHex = init.ackBytesHex;
  }

  const seq = buildFramePacketSequence(params.rgb565Le);
  writePacketWithRetry(params.transport, seq.headerStart, 'HEADER_START', true);

  for (let i = 0; i < seq.chunks.length; i++) {
    const shouldLogChunk = i === 0 || i === seq.chunks.length - 1;
    writePacketWithRetry(
      params.transport,
      seq.chunks[i],
      `DATA_CHUNK[${i}/${seq.chunks.length}]`,
      shouldLogChunk
    );
  }

  writePacketWithRetry(params.transport, seq.headerEnd, 'HEADER_END', true);
  recordSerialLog('INFO', 'FRAME_COMPLETE', seq.totalBytesOnWire, undefined);

  return {
    chunksSent: seq.chunks.length,
    totalChunks: seq.chunks.length,
    totalBytesOnWire: seq.totalBytesOnWire,
    ackBytesHex,
    frameSha256Short: seq.frameSha256Short,
  };
}

/**
 * Primary async diff-cached frame writer:
 * Sends DISPLAY_ON + ACK check if needed, diffs against `prevRgb565` (forced full sync every 60 frames
 * or when `forceFullRefresh=true`), writes ONE 59-byte command per USB write() syscall (the Synwit
 * 0416:90a1 CDC-ACM firmware drops commands that do not start on a 64B USB packet boundary), and
 * yields `unchangedSkipped: true` when 0 chunks changed.
 */
export async function pushFrameViaAsyncTransport(params: {
  transport: AsyncSerialPortTransport;
  rgb565Le: Buffer;
  prevRgb565: Buffer | null;
  initializeDisplay?: boolean;
  forceFullRefresh?: boolean;
}): Promise<{
  chunksSent: number;
  totalChunks: number;
  totalBytesOnWire: number;
  ackBytesHex: string | null;
  frameSha256Short: string;
  unchangedSkipped: boolean;
  fullSync: boolean;
}> {
  let ackBytesHex: string | null = null;
  if (params.initializeDisplay) {
    const init = await sendDisplayOnHandshakeAsync(params.transport);
    ackBytesHex = init.ackBytesHex;
  }

  const forceFull = Boolean(params.forceFullRefresh || params.initializeDisplay || !params.prevRgb565);
  const diff = computeDiffChunkIndices(params.prevRgb565, params.rgb565Le, forceFull);
  const changedCount = diff.changedIndices.length;

  if (changedCount === 0) {
    recordSerialLog('INFO', 'FRAME_UNCHANGED_SKIPPED', 0);
    return {
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      totalBytesOnWire: 0,
      ackBytesHex,
      frameSha256Short: diff.frameSha256Short,
      unchangedSkipped: true,
      fullSync: false,
    };
  }

  const totalBytesOnWire =
    HEADER_START.length + changedCount * DATA_CHUNK_PACKET_SIZE + HEADER_END.length;

  await writePacketWithRetryAsync(params.transport, Buffer.from(HEADER_START), 'HEADER_START', true);

  // Send strictly one 59-byte 0x08 chunk packet per write() call so every command starts at a USB bulk packet boundary.
  const YIELD_EVERY_PACKETS = 128;
  for (let i = 0; i < changedCount; i++) {
    const chunkIdx = diff.changedIndices[i];
    const byteOffset = chunkIdx * IMG_CHUNK_SIZE;
    const pkt = buildDataChunkPacket(
      byteOffset,
      params.rgb565Le.subarray(byteOffset, byteOffset + IMG_CHUNK_SIZE)
    );
    const logChunk = i === 0 || i === changedCount - 1;
    const label = diff.fullSync
      ? `DATA_CHUNK[${chunkIdx}/${EXPECTED_TOTAL_CHUNKS}]`
      : `DIFF_CHUNK[${i + 1}/${changedCount} @${chunkIdx}/${EXPECTED_TOTAL_CHUNKS}]`;
    await writePacketWithRetryAsync(params.transport, pkt, label, logChunk);
    if (changedCount > YIELD_EVERY_PACKETS && (i & 127) === 127) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  await writePacketWithRetryAsync(params.transport, Buffer.from(HEADER_END), 'HEADER_END', true);
  await params.transport.drainRx();
  recordSerialLog(
    'INFO',
    diff.fullSync ? 'FRAME_COMPLETE_FULL' : `FRAME_COMPLETE_DIFF (${changedCount}/${EXPECTED_TOTAL_CHUNKS})`,
    totalBytesOnWire
  );

  return {
    chunksSent: changedCount,
    totalChunks: EXPECTED_TOTAL_CHUNKS,
    totalBytesOnWire,
    ackBytesHex,
    frameSha256Short: diff.frameSha256Short,
    unchangedSkipped: false,
    fullSync: diff.fullSync,
  };
}

export function runDryRunFrame(params: {
  rgbaBuffer: Uint8Array;
  screenId: string;
  screenName: string;
  width?: number;
  height?: number;
}) {
  const width = params.width ?? DISPLAY_WIDTH;
  const height = params.height ?? DISPLAY_HEIGHT;
  const rgb565Le = rgbaToRgb565Le(params.rgbaBuffer, width, height);
  const seq = buildFramePacketSequence(rgb565Le);

  recordSerialLog('DRY_RUN', 'DISPLAY_ON (simulated TX)', DISPLAY_ON);
  recordSerialLog('DRY_RUN', 'HEADER_START (simulated TX)', seq.headerStart);
  if (seq.chunks.length > 0) {
    recordSerialLog('DRY_RUN', `DATA_CHUNK[0/${seq.chunks.length}] (simulated TX)`, seq.chunks[0]);
  }
  if (seq.chunks.length > 1) {
    recordSerialLog('DRY_RUN', `DATA_CHUNK[1/${seq.chunks.length}] (simulated TX)`, seq.chunks[1]);
  }
  if (seq.chunks.length > 2) {
    const lastIdx = seq.chunks.length - 1;
    recordSerialLog(
      'DRY_RUN',
      `DATA_CHUNK[${lastIdx}/${seq.chunks.length}] (simulated TX)`,
      seq.chunks[lastIdx]
    );
  }
  recordSerialLog('DRY_RUN', 'HEADER_END (simulated TX)', seq.headerEnd);

  lastDryRunSummary = {
    ranAt: new Date().toISOString(),
    screenId: params.screenId,
    screenName: params.screenName,
    totalChunks: seq.chunks.length,
    totalBytesOnWire: seq.totalBytesOnWire,
    frameSha256Short: seq.frameSha256Short,
  };

  return {
    ok: true,
    dryRun: true,
    wroteToDevice: false,
    width,
    height,
    rgb565Bytes: rgb565Le.length,
    expectedRgb565Bytes: EXPECTED_RGB565_BYTES,
    totalChunks: seq.chunks.length,
    expectedTotalChunks: EXPECTED_TOTAL_CHUNKS,
    totalBytesOnWire: seq.totalBytesOnWire,
    crcAlgorithm: 'none',
    frameSha256Short: seq.frameSha256Short,
    headerStartHex: formatHexPreview(seq.headerStart, 16),
    displayOnHex: formatHexPreview(DISPLAY_ON, 8),
    headerEndHex: formatHexPreview(seq.headerEnd, 8),
    firstChunkHex: formatHexPreview(seq.chunks[0], 59),
    lastChunkHex: formatHexPreview(seq.chunks[seq.chunks.length - 1], 59),
    logEntries: dryRunLog.slice(0, 12),
  };
}

export function pushFrameOverRealSerial(params: {
  rgbaBuffer: Uint8Array;
  requestedDevicePath?: string;
  forceDisplayOn?: boolean;
}) {
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    setLastProtocolError(gate.reason);
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
  if (!resolved.devicePath) {
    const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
    setLastProtocolError(err);
    recordSerialLog('ERROR', 'DEVICE_RESOLVE_FAILED', 0, err);
    throw new Error(err);
  }

  const rgb565Le = rgbaToRgb565Le(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  let transport: LinuxSerialFdTransport | null = null;
  let initializeDisplay = Boolean(params.forceDisplayOn);

  try {
    if (!activeTransport || activeTransport.devicePath !== resolved.devicePath) {
      closeActiveSerialTransport();
      transport = new LinuxSerialFdTransport(resolved.devicePath);
      activeTransport = {
        devicePath: resolved.devicePath,
        transport,
        initialized: false,
      };
      initializeDisplay = true;
    } else {
      transport = activeTransport.transport as LinuxSerialFdTransport;
      if (!activeTransport.initialized) initializeDisplay = true;
    }

    const res = pushFrameViaSerialTransport({
      transport,
      rgb565Le,
      initializeDisplay,
    });

    activeTransport.initialized = true;
    lastSentRgb565 = rgb565Le;
    setLastProtocolError(null);
    return {
      devicePath: resolved.devicePath,
      usbVidPid: resolved.match ? `${resolved.match.vendorId}:${resolved.match.productId}` : '0x0416:0x90a1',
      ...res,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastProtocolError(msg);
    closeActiveSerialTransport();
    throw err;
  }
}

export async function pushFrameOverRealSerialAsync(params: {
  rgbaBuffer: Uint8Array;
  requestedDevicePath?: string;
  forceDisplayOn?: boolean;
  forceFullRefresh?: boolean;
  brightnessKey?: number;
}) {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || 'Serial writes blocked');
    }

    const resolved = resolveStrictAoostarDevice(params.requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
      setLastProtocolError(err);
      recordSerialLog('ERROR', 'DEVICE_RESOLVE_FAILED', 0, err);
      throw new Error(err);
    }

    const rgb565Le = rgbaToRgb565Le(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
    await new Promise<void>((resolve) => setImmediate(resolve));
    let initializeDisplay = Boolean(params.forceDisplayOn);

    try {
      if (!activeAsyncTransport || activeAsyncTransport.devicePath !== resolved.devicePath) {
        await closeActiveSerialTransportAsync();
        const opened = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        activeAsyncTransport = {
          devicePath: resolved.devicePath,
          transport: opened,
          initialized: false,
        };
        initializeDisplay = true;
      } else if (!activeAsyncTransport.initialized) {
        initializeDisplay = true;
      }

      const brightnessChanged =
        params.brightnessKey !== undefined &&
        lastBrightnessKey !== null &&
        params.brightnessKey !== lastBrightnessKey;
      const periodicFull = framesSinceFullSync >= FULL_SYNC_EVERY_N_FRAMES;
      const forceFull = Boolean(
        params.forceFullRefresh || brightnessChanged || periodicFull || initializeDisplay
      );

      const res = await pushFrameViaAsyncTransport({
        transport: activeAsyncTransport.transport,
        rgb565Le,
        prevRgb565: forceFull ? null : lastSentRgb565,
        initializeDisplay,
        forceFullRefresh: forceFull,
      });

      activeAsyncTransport.initialized = true;
      lastSentRgb565 = rgb565Le;
      if (params.brightnessKey !== undefined) {
        lastBrightnessKey = params.brightnessKey;
      }
      framesSinceFullSync = res.fullSync ? 0 : framesSinceFullSync + 1;
      setLastProtocolError(null);

      return {
        devicePath: resolved.devicePath,
        usbVidPid: resolved.match
          ? `${resolved.match.vendorId}:${resolved.match.productId}`
          : '0x0416:0x90a1',
        ...res,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    }
  });
}

export function runSafeDisplayOnOverSerial(requestedDevicePath?: string): {
  devicePath: string;
  ackOk: boolean;
  ackBytesHex: string;
} {
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    setLastProtocolError(gate.reason);
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const resolved = resolveStrictAoostarDevice(requestedDevicePath);
  if (!resolved.devicePath) {
    const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
    setLastProtocolError(err);
    recordSerialLog('ERROR', 'SAFE_TEST_DEVICE_MISSING', 0, err);
    throw new Error(err);
  }

  let transport: LinuxSerialFdTransport | null = null;
  try {
    closeActiveSerialTransport();
    transport = new LinuxSerialFdTransport(resolved.devicePath);
    const ack = sendDisplayOnHandshake(transport);
    transport.close();
    setLastProtocolError(null);
    return {
      devicePath: resolved.devicePath,
      ackOk: ack.ackOk,
      ackBytesHex: ack.ackBytesHex,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastProtocolError(msg);
    if (transport) {
      try {
        transport.close();
      } catch {
        // ignore
      }
    }
    throw err;
  }
}

export async function runSafeDisplayOnOverSerialAsync(requestedDevicePath?: string): Promise<{
  devicePath: string;
  ackOk: boolean;
  ackBytesHex: string;
}> {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || 'Serial writes blocked');
    }

    const resolved = resolveStrictAoostarDevice(requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
      setLastProtocolError(err);
      recordSerialLog('ERROR', 'SAFE_TEST_DEVICE_MISSING', 0, err);
      throw new Error(err);
    }

    try {
      if (!activeAsyncTransport || activeAsyncTransport.devicePath !== resolved.devicePath) {
        await closeActiveSerialTransportAsync();
        const opened = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        activeAsyncTransport = {
          devicePath: resolved.devicePath,
          transport: opened,
          initialized: false,
        };
      }
      const ack = await sendDisplayOnHandshakeAsync(activeAsyncTransport.transport);
      activeAsyncTransport.initialized = true;
      setLastProtocolError(null);
      return {
        devicePath: resolved.devicePath,
        ackOk: ack.ackOk,
        ackBytesHex: ack.ackBytesHex,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    }
  });
}

export function sendDisplayOffOverSerial(requestedDevicePath?: string): {devicePath: string} {
  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    setLastProtocolError(gate.reason);
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const resolved = resolveStrictAoostarDevice(requestedDevicePath);
  if (!resolved.devicePath) {
    const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
    setLastProtocolError(err);
    throw new Error(err);
  }

  const transport = new LinuxSerialFdTransport(resolved.devicePath);
  try {
    sendDisplayOffCommand(transport);
    if (activeTransport && activeTransport.devicePath === resolved.devicePath) {
      activeTransport.initialized = false;
    }
    resetFrameDiffCache();
    setLastProtocolError(null);
    return {devicePath: resolved.devicePath};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastProtocolError(msg);
    closeActiveSerialTransport();
    throw err;
  } finally {
    transport.close();
  }
}

export async function sendDisplayOffOverSerialAsync(
  requestedDevicePath?: string
): Promise<{devicePath: string}> {
  return await withSerialLock(async () => {
    const gate = canPerformRealSerialWrite();
    if (!gate.allowed) {
      setLastProtocolError(gate.reason);
      throw new Error(gate.reason || 'Serial writes blocked');
    }

    const resolved = resolveStrictAoostarDevice(requestedDevicePath);
    if (!resolved.devicePath) {
      const err = resolved.error || 'Aoostar USB device (0416:90a1) not found';
      setLastProtocolError(err);
      throw new Error(err);
    }

    let transient: AsyncSerialPortTransport | null = null;
    try {
      let target: AsyncSerialPortTransport;
      if (activeAsyncTransport && activeAsyncTransport.devicePath === resolved.devicePath) {
        target = activeAsyncTransport.transport;
        activeAsyncTransport.initialized = false;
      } else {
        transient = await LinuxAsyncSerialTransport.open(resolved.devicePath);
        target = transient;
      }
      await writePacketWithRetryAsync(target, DISPLAY_OFF, 'DISPLAY_OFF', true);
      resetFrameDiffCache();
      setLastProtocolError(null);
      return {devicePath: resolved.devicePath};
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastProtocolError(msg);
      await closeActiveSerialTransportAsync();
      throw err;
    } finally {
      if (transient) {
        await transient.close().catch(() => {});
      }
    }
  });
}
