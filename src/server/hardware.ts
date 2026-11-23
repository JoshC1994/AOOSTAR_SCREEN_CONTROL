import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import type {DetectedUsbDevice, LastFrameMeta} from '../types.ts';

const AOOSTAR_VID = '0416';
const AOOSTAR_PID = '90a1';
const UART_BAUDRATE = 1_500_000;
const IMG_CHUNK_SIZE = 47;

// Exact zehnm/aoostar-rs (crates/asterctl-lcd/src/aoo_screen.rs) binary commands
const DISPLAY_OFF = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0a, 0x00, 0x00, 0x00]);
const DISPLAY_ON = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0b, 0x00, 0x00, 0x00]);
const HEADER_START = Buffer.from([
  0xaa, 0x55, 0xaa, 0x55, 0x05, 0x00, 0x00, 0x00, 0x04, 0x00, 0x0f, 0x2f, 0x00, 0x04, 0x0b, 0x00,
]);
const HEADER_END = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x06, 0x00, 0x00, 0x00]);
const CHUNK_HEADER = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x08, 0x00, 0x00, 0x00]);

const HEADER_START_HEX = Array.from(HEADER_START)
  .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
  .join(' ');

let lastFrameMeta: LastFrameMeta = {
  pushedAt: null,
  screenId: null,
  screenName: null,
  width: 960,
  height: 376,
  byteLength: 960 * 376 * 2,
  crc16Hex: '0x0000',
  devicePath: '/dev/ttyACM0',
  deliveryMode: 'virtual-buffer',
  headerHex: HEADER_START_HEX,
  chunksSent: 0,
  totalChunks: (960 * 376 * 2) / IMG_CHUNK_SIZE,
  initAck: false,
  powerState: 'on',
  lastError: null,
};

let lastRgb565Buffer: Buffer | null = null;
let prevSentRgb565: Buffer | null = null;

interface SerialSession {
  devicePath: string;
  resolvedPath: string;
  fd: number;
  initialized: boolean;
  initAck: boolean;
  powerState: 'on' | 'off';
}

let activeSerial: SerialSession | null = null;

const sleepArray = new Int32Array(new SharedArrayBuffer(4));
function sleepSyncMs(ms: number) {
  try {
    Atomics.wait(sleepArray, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback busy wait
    }
  }
}

function closeSerialSession() {
  if (activeSerial) {
    try {
      fs.closeSync(activeSerial.fd);
    } catch {
      // ignore close error
    }
    activeSerial = null;
  }
  prevSentRgb565 = null;
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
    // ignore /dev read error
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
      try {
        fs.accessSync(fullPath, fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
    }

    devices.push({
      path: fullPath,
      name: attrs.name,
      vendorId: attrs.vendorId === 'unknown' ? 'unknown' : `0x${attrs.vendorId}`,
      productId: attrs.productId === 'unknown' ? 'unknown' : `0x${attrs.productId}`,
      isAoostarMatch: attrs.vendorId === AOOSTAR_VID && attrs.productId === AOOSTAR_PID,
      writable,
    });
  }

  return devices;
}

function resolveTargetDevice(requestedPath: string): string | null {
  const trimmed = (requestedPath || '').trim();
  if (trimmed && fs.existsSync(trimmed)) {
    return trimmed;
  }
  const detected = scanUsbSerialDevices();
  const exact = detected.find((d) => d.isAoostarMatch);
  if (exact) return exact.path;
  const acm = detected.find((d) => d.path.includes('ttyACM'));
  if (acm) return acm.path;
  return null;
}

function configureRawSerialPort(devPath: string) {
  const baseFlags = [
    '-F',
    devPath,
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
  try {
    execFileSync('stty', baseFlags, {stdio: 'ignore', timeout: 1500});
    return;
  } catch {
    // BusyBox / minimal stty fallback without explicit 1500000 if rejected
  }
  try {
    execFileSync(
      'stty',
      ['-F', devPath, 'clocal', 'cread', '-crtscts', '-hupcl', 'raw', '-echo', '-onlcr', '-icrnl', '-ixon', '-ixoff', '-opost'],
      {
        stdio: 'ignore',
        timeout: 1500,
      }
    );
  } catch {
    // proceed; USB CDC ignores baud on some kernels
  }
}

function writeAllSync(fd: number, buf: Buffer, timeoutMs = 4000): void {
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (offset < buf.length) {
    try {
      const written = fs.writeSync(fd, buf, offset, buf.length - offset);
      if (written > 0) {
        offset += written;
      } else {
        if (Date.now() > deadline) {
          throw new Error('Serial write timed out (0 bytes written)');
        }
        sleepSyncMs(2);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EAGAIN' || code === 'EWOULDBLOCK' || code === 'EINTR') {
        if (Date.now() > deadline) {
          throw new Error(`Serial write timed out (${code}) after ${offset}/${buf.length} bytes`);
        }
        sleepSyncMs(2);
        continue;
      }
      throw err;
    }
  }
}

function readAvailableAck(fd: number, waitMs = 350): boolean {
  const scratch = Buffer.alloc(64);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    try {
      const n = fs.readSync(fd, scratch, 0, scratch.length, null);
      if (n > 0) {
        for (let i = 0; i < n; i++) {
          if (scratch[i] === 0x41) return true; // ASCII 'A'
        }
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EAGAIN' && code !== 'EWOULDBLOCK' && code !== 'EINTR') {
        break;
      }
    }
    sleepSyncMs(25);
  }
  return false;
}

function ensureSerialSession(targetPath: string): SerialSession {
  let resolvedPath = targetPath;
  try {
    resolvedPath = fs.realpathSync(targetPath);
  } catch {
    // keep targetPath
  }

  if (activeSerial && activeSerial.resolvedPath === resolvedPath) {
    return activeSerial;
  }

  closeSerialSession();
  configureRawSerialPort(resolvedPath);

  const flags =
    fs.constants.O_RDWR |
    fs.constants.O_NOCTTY |
    (fs.constants.O_NONBLOCK ?? 0);
  const fd = fs.openSync(resolvedPath, flags);

  const session: SerialSession = {
    devicePath: targetPath,
    resolvedPath,
    fd,
    initialized: false,
    initAck: false,
    powerState: 'off',
  };
  activeSerial = session;
  return session;
}

function sendDisplayOn(session: SerialSession) {
  writeAllSync(session.fd, DISPLAY_ON, 1500);
  const ack = readAvailableAck(session.fd, session.initialized ? 80 : 400);
  session.initialized = true;
  session.initAck = session.initAck || ack;
  session.powerState = 'on';
}

function sendDisplayOff(session: SerialSession) {
  writeAllSync(session.fd, DISPLAY_OFF, 1500);
  readAvailableAck(session.fd, 80);
  session.powerState = 'off';
}

function crc16Ccitt(buf: Buffer): number {
  let crc = 0xffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc;
}

/**
 * Converts a raw 960x376 RGBA pixel buffer (base64) into an RGB565 frame packet
 * following the exact zehnm/aoostar-rs (asterctl-lcd) USB-UART protocol (0x0416:0x90A1):
 *   - DISPLAY_ON:   AA 55 AA 55 0B 00 00 00
 *   - HEADER_START: AA 55 AA 55 05 00 00 00 04 00 0F 2F 00 04 0B 00
 *   - DATA_CHUNK:   AA 55 AA 55 08 00 00 00 + offset(u32 LE) + 47 bytes RGB565 LE
 *   - HEADER_END:   AA 55 AA 55 06 00 00 00
 */
export function encodeAndPushRgb565Frame(params: {
  rgbaBase64?: string;
  screenId: string;
  screenName: string;
  devicePath: string;
  brightness: number;
  width?: number;
  height?: number;
  forceFull?: boolean;
}): LastFrameMeta {
  const width = params.width ?? 960;
  const height = params.height ?? 376;
  const pixelCount = width * height;
  const rgb565 = Buffer.alloc(pixelCount * 2);
  const brightnessClamped = Math.max(0, Math.min(100, Math.round(params.brightness)));
  const brightnessScale = brightnessClamped / 100;

  if (params.rgbaBase64) {
    const rawRgba = Buffer.from(params.rgbaBase64, 'base64');
    const maxPixels = Math.min(pixelCount, Math.floor(rawRgba.length / 4));
    for (let i = 0; i < maxPixels; i++) {
      const r = Math.round(rawRgba[i * 4] * brightnessScale);
      const g = Math.round(rawRgba[i * 4 + 1] * brightnessScale);
      const b = Math.round(rawRgba[i * 4 + 2] * brightnessScale);
      const val = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
      rgb565.writeUInt16LE(val, i * 2);
    }
  }

  const crc = crc16Ccitt(rgb565);
  const crcHex = `0x${crc.toString(16).toUpperCase().padStart(4, '0')}`;
  const totalChunks = Math.ceil(rgb565.length / IMG_CHUNK_SIZE);
  const resolvedDevice = resolveTargetDevice(params.devicePath);

  let deliveryMode: LastFrameMeta['deliveryMode'] = 'virtual-buffer';
  let chunksSent = 0;
  let initAck = false;
  let powerState: 'on' | 'off' = brightnessClamped <= 0 ? 'off' : 'on';
  let lastError: string | null = null;

  if (resolvedDevice) {
    try {
      const session = ensureSerialSession(resolvedDevice);

      if (brightnessClamped <= 0) {
        if (session.powerState !== 'off' || !session.initialized) {
          sendDisplayOff(session);
        }
        deliveryMode = 'usb-serial';
        initAck = session.initAck;
        powerState = 'off';
      } else {
        const wakingUp = !session.initialized || session.powerState === 'off';
        if (wakingUp) {
          sendDisplayOn(session);
          prevSentRgb565 = null;
        }

        const useDiffCache =
          !params.forceFull &&
          !wakingUp &&
          prevSentRgb565 !== null &&
          prevSentRgb565.length === rgb565.length;

        // Send HEADER_START
        writeAllSync(session.fd, HEADER_START, 2000);

        // Send changed 47-byte RGB565 chunks in <= 2KB batches for clean USB CDC transfer
        const PACKET_SIZE = 8 + 4 + IMG_CHUNK_SIZE; // 59 bytes
        const BATCH_PACKETS = 32; // 32 * 59 = 1888 bytes
        const batchBuf = Buffer.allocUnsafe(PACKET_SIZE * BATCH_PACKETS);
        let batchCount = 0;

        for (let offset = 0; offset < rgb565.length; offset += IMG_CHUNK_SIZE) {
          const end = Math.min(rgb565.length, offset + IMG_CHUNK_SIZE);
          const chunk = rgb565.subarray(offset, end);

          if (useDiffCache && prevSentRgb565 && prevSentRgb565.subarray(offset, end).equals(chunk)) {
            continue;
          }

          const base = batchCount * PACKET_SIZE;
          CHUNK_HEADER.copy(batchBuf, base);
          batchBuf.writeUInt32LE(offset, base + 8);
          if (chunk.length < IMG_CHUNK_SIZE) {
            batchBuf.fill(0, base + 12, base + PACKET_SIZE);
          }
          chunk.copy(batchBuf, base + 12);
          batchCount++;
          chunksSent++;

          if (batchCount === BATCH_PACKETS) {
            writeAllSync(session.fd, batchBuf.subarray(0, batchCount * PACKET_SIZE), 4000);
            batchCount = 0;
          }
        }

        if (batchCount > 0) {
          writeAllSync(session.fd, batchBuf.subarray(0, batchCount * PACKET_SIZE), 4000);
        }

        // Send HEADER_END
        writeAllSync(session.fd, HEADER_END, 2000);
        readAvailableAck(session.fd, 30);

        prevSentRgb565 = Buffer.from(rgb565);
        deliveryMode = 'usb-serial';
        initAck = session.initAck;
        powerState = 'on';
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      closeSerialSession();
      deliveryMode = 'virtual-buffer';
    }
  } else {
    lastError = `USB serial device not found (${params.devicePath || '/dev/ttyACM0'})`;
  }

  lastRgb565Buffer = rgb565;
  lastFrameMeta = {
    pushedAt: new Date().toISOString(),
    screenId: params.screenId,
    screenName: params.screenName,
    width,
    height,
    byteLength: rgb565.length,
    crc16Hex: crcHex,
    devicePath: resolvedDevice || params.devicePath,
    deliveryMode,
    headerHex: HEADER_START_HEX,
    chunksSent,
    totalChunks,
    initAck,
    powerState,
    lastError,
  };

  return lastFrameMeta;
}

export function getLastFrameMeta(): LastFrameMeta {
  return lastFrameMeta;
}

export function getLastFrameBuffer(): Buffer | null {
  return lastRgb565Buffer;
}
