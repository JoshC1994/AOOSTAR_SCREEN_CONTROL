import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type {DetectedUsbDevice} from '../../types.ts';
import {
  buildFramePacketSequence,
  DISPLAY_HEIGHT,
  DISPLAY_OFF,
  DISPLAY_ON,
  DISPLAY_WIDTH,
  EXPECTED_RGB565_BYTES,
  EXPECTED_TOTAL_CHUNKS,
  formatHexPreview,
  INIT_ACK_WAIT_MS,
  parseInitAckResponse,
  rgbaToRgb565Le,
  SERIAL_RETRY,
  UART_BAUDRATE,
  USB_UART_PID_HEX,
  USB_UART_VID_HEX,
} from './protocol.ts';

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

const MAX_LOG_ENTRIES = 160;
let logSeq = 1;
const serialLogs: SerialLogEntry[] = [];
const dryRunLog: SerialLogEntry[] = [];

let emergencyStopped = false;
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

export function isSerialWritesEnvEnabled(): boolean {
  return process.env.AOOSTAR_ENABLE_SERIAL_WRITES === 'true';
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
  if (!isSerialWritesEnvEnabled()) {
    return {
      allowed: false,
      reason:
        'Serial writes are disabled by safety policy (AOOSTAR_ENABLE_SERIAL_WRITES=false). Enable AOOSTAR_ENABLE_SERIAL_WRITES=true only after protocol validation.',
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
    serialWritesEnabled: isSerialWritesEnvEnabled(),
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

export function closeActiveSerialTransport(): void {
  if (activeTransport) {
    try {
      activeTransport.transport.close();
    } catch {
      // ignore close error
    }
    activeTransport = null;
  }
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
  recordSerialLog('INFO', 'EMERGENCY_STOP_CLEARED', 0);
}

function normalizeUsbId(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/^0x/, '');
  return cleaned ? cleaned.padStart(4, '0') : 'unknown';
}

function readUsbAttrsForTty(devPath: string): {vendorId: string; productId: string; name: string} {
  let realName = path.basename(devPath);
  try {
    realName = path.basename(fs.realpathSync(devPath));
  } catch {
    // keep basename
  }

  let vendorId = 'unknown';
  let productId = 'unknown';
  let name = realName;

  const candidateDirs = [
    `/sys/class/tty/${realName}/device/..`,
    `/sys/class/tty/${realName}/device/../..`,
  ];

  for (const dir of candidateDirs) {
    try {
      if (fs.existsSync(path.join(dir, 'idVendor'))) {
        vendorId = normalizeUsbId(fs.readFileSync(path.join(dir, 'idVendor'), 'utf8'));
      }
      if (fs.existsSync(path.join(dir, 'idProduct'))) {
        productId = normalizeUsbId(fs.readFileSync(path.join(dir, 'idProduct'), 'utf8'));
      }
      if (fs.existsSync(path.join(dir, 'product'))) {
        name = fs.readFileSync(path.join(dir, 'product'), 'utf8').trim();
      }
      if (vendorId !== 'unknown' && productId !== 'unknown') break;
    } catch {
      // ignore sysfs read failure
    }
  }

  return {vendorId, productId, name};
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
 * Never silently falls back to an unrelated ttyACM/ttyUSB device.
 */
export function resolveStrictAoostarDevice(requestedPath?: string): {
  devicePath: string | null;
  match: DetectedUsbDevice | null;
  error: string | null;
} {
  const devices = scanUsbSerialDevices();
  const trimmed = (requestedPath || '').trim();

  if (trimmed) {
    const found = devices.find((d) => d.path === trimmed);
    if (found) {
      if (
        found.vendorId !== 'unknown' &&
        found.productId !== 'unknown' &&
        !found.isAoostarMatch
      ) {
        return {
          devicePath: null,
          match: found,
          error: `Device ${trimmed} has USB ID ${found.vendorId}:${found.productId}, expected 0x0416:0x90a1`,
        };
      }
      return {devicePath: found.path, match: found, error: null};
    }
    if (fs.existsSync(trimmed)) {
      const attrs = readUsbAttrsForTty(trimmed);
      const isMatch = attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX;
      if (attrs.vendorId !== 'unknown' && !isMatch) {
        return {
          devicePath: null,
          match: null,
          error: `Device ${trimmed} has USB ID 0x${attrs.vendorId}:0x${attrs.productId}, expected 0x0416:0x90a1`,
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
  }

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
  const isAoostarMatch = attrs.vendorId === USB_UART_VID_HEX && attrs.productId === USB_UART_PID_HEX;

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

export class LinuxSerialFdTransport implements SerialPortTransport {
  private fd: number | null;
  private readonly devicePath: string;
  private pendingReadBuf: Buffer = Buffer.alloc(0);

  constructor(devicePath: string) {
    this.devicePath = fs.realpathSync(devicePath);

    // Strictly configure 1,500,000 8N1 raw mode via stty; never silently drop baud rate
    execFileSync(
      'stty',
      [
        '-F',
        this.devicePath,
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
      ],
      {stdio: 'pipe', timeout: 2000}
    );

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
      // TTY file descriptors return EINVAL on fsync; kernel UART TX buffer still drains via tty driver
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

export function sendDisplayOffCommand(transport: SerialPortTransport): void {
  writePacketWithRetry(transport, DISPLAY_OFF, 'DISPLAY_OFF', true);
}

/**
 * Exact `AooScreen::send_image` sequence from crates/asterctl-lcd/src/aoo_screen.rs:
 * Sends DISPLAY_ON + ACK check (if not yet initialized), HEADER_START, all 15,360 chunks
 * in strict ascending offset order (no diff skipping, no pixel scaling, no CRC), and HEADER_END.
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
  recordSerialLog(
    'INFO',
    'FRAME_COMPLETE',
    seq.totalBytesOnWire,
    undefined
  );

  return {
    chunksSent: seq.chunks.length,
    totalChunks: seq.chunks.length,
    totalBytesOnWire: seq.totalBytesOnWire,
    ackBytesHex,
    frameSha256Short: seq.frameSha256Short,
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
