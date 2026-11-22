import fs from 'node:fs';
import type {DetectedUsbDevice, LastFrameMeta} from '../types.ts';

const AOOSTAR_VID = '0416';
const AOOSTAR_PID = '90a1';

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
  headerHex: '5A A5 01 03 C0 01 78',
};

let lastRgb565Buffer: Buffer | null = null;

export function scanUsbSerialDevices(): DetectedUsbDevice[] {
  const devices: DetectedUsbDevice[] = [];
  try {
    const devFiles = fs.readdirSync('/dev').filter((f) => f.startsWith('ttyACM') || f.startsWith('ttyUSB'));
    for (const dev of devFiles) {
      const fullPath = `/dev/${dev}`;
      let vendorId = 'unknown';
      let productId = 'unknown';
      let name = dev;
      try {
        const sysPath = `/sys/class/tty/${dev}/device/../`;
        if (fs.existsSync(`${sysPath}idVendor`)) {
          vendorId = fs.readFileSync(`${sysPath}idVendor`, 'utf8').trim().toLowerCase();
        }
        if (fs.existsSync(`${sysPath}idProduct`)) {
          productId = fs.readFileSync(`${sysPath}idProduct`, 'utf8').trim().toLowerCase();
        }
        if (fs.existsSync(`${sysPath}product`)) {
          name = fs.readFileSync(`${sysPath}product`, 'utf8').trim();
        }
      } catch {
        // ignore sysfs read failure
      }
      let writable = false;
      try {
        fs.accessSync(fullPath, fs.constants.W_OK);
        writable = true;
      } catch {
        writable = false;
      }
      devices.push({
        path: fullPath,
        name,
        vendorId: `0x${vendorId}`,
        productId: `0x${productId}`,
        isAoostarMatch: vendorId === AOOSTAR_VID && productId === AOOSTAR_PID,
        writable,
      });
    }
  } catch {
    // ignore /dev read error
  }
  return devices;
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
 * following the reverse-engineered Aoostar USB UART display protocol (0x0416:0x90A1).
 */
export function encodeAndPushRgb565Frame(params: {
  rgbaBase64?: string;
  screenId: string;
  screenName: string;
  devicePath: string;
  brightness: number;
  width?: number;
  height?: number;
}): LastFrameMeta {
  const width = params.width ?? 960;
  const height = params.height ?? 376;
  const pixelCount = width * height;
  const rgb565 = Buffer.alloc(pixelCount * 2);

  if (params.rgbaBase64) {
    const rawRgba = Buffer.from(params.rgbaBase64, 'base64');
    const maxPixels = Math.min(pixelCount, Math.floor(rawRgba.length / 4));
    for (let i = 0; i < maxPixels; i++) {
      const r = rawRgba[i * 4];
      const g = rawRgba[i * 4 + 1];
      const b = rawRgba[i * 4 + 2];
      const val = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
      rgb565.writeUInt16LE(val, i * 2);
    }
  }

  // Build aoostar-rs compatible frame header: Magic (5A A5), Cmd (01 = full frame), Width BE, Height BE, Brightness
  const header = Buffer.alloc(9);
  header[0] = 0x5a;
  header[1] = 0xa5;
  header[2] = 0x01;
  header.writeUInt16BE(width, 3);
  header.writeUInt16BE(height, 5);
  header[7] = Math.max(0, Math.min(100, Math.round(params.brightness)));
  header[8] = 0x00;

  const crc = crc16Ccitt(rgb565);
  const crcHex = `0x${crc.toString(16).toUpperCase().padStart(4, '0')}`;
  const headerHex = Array.from(header)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

  let deliveryMode: LastFrameMeta['deliveryMode'] = 'virtual-buffer';
  if (params.devicePath && fs.existsSync(params.devicePath)) {
    try {
      const packet = Buffer.concat([header, rgb565]);
      const fd = fs.openSync(params.devicePath, 'w');
      try {
        fs.writeSync(fd, packet);
        deliveryMode = 'usb-serial';
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      deliveryMode = 'virtual-buffer';
    }
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
    devicePath: params.devicePath,
    deliveryMode,
    headerHex,
  };

  return lastFrameMeta;
}

export function getLastFrameMeta(): LastFrameMeta {
  return lastFrameMeta;
}

export function getLastFrameBuffer(): Buffer | null {
  return lastRgb565Buffer;
}
