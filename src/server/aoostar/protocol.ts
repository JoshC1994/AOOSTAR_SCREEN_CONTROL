import crypto from 'node:crypto';
import zlib from 'node:zlib';

/**
 * Exact USB-UART protocol constants from zehnm/aoostar-rs:
 * - crates/asterctl-lcd/src/aoo_screen.rs
 * - crates/asterctl-lcd/src/lib.rs
 * - docs/lcd_protocol.md
 */
export const DISPLAY_WIDTH = 960;
export const DISPLAY_HEIGHT = 376;
export const USB_UART_VID = 0x0416;
export const USB_UART_PID = 0x90a1;
export const USB_UART_VID_HEX = '0416';
export const USB_UART_PID_HEX = '90a1';
export const UART_BAUDRATE = 1_500_000;
export const IMG_CHUNK_SIZE = 47;
export const SERIAL_RETRY = 3;
export const INIT_ACK_WAIT_MS = 1000;
export const INIT_ACK_BYTE = 0x41; // ASCII 'A'

export const EXPECTED_PIXEL_COUNT = DISPLAY_WIDTH * DISPLAY_HEIGHT; // 360,960
export const EXPECTED_RGB565_BYTES = EXPECTED_PIXEL_COUNT * 2; // 721,920
export const EXPECTED_TOTAL_CHUNKS = EXPECTED_RGB565_BYTES / IMG_CHUNK_SIZE; // 15,360 exact chunks
export const DATA_CHUNK_PACKET_SIZE = 8 + 4 + IMG_CHUNK_SIZE; // 59 bytes

/**
 * Proven by inspection of zehnm/aoostar-rs (crates/asterctl-lcd/src/aoo_screen.rs & docs/lcd_protocol.md):
 * The Aoostar LCD protocol does NOT append or embed any CRC checksum bytes.
 */
export const CRC_ALGORITHM = 'none' as const;

export const DISPLAY_OFF = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0a, 0x00, 0x00, 0x00]);
export const DISPLAY_ON = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0b, 0x00, 0x00, 0x00]);
export const HEADER_START = Buffer.from([
  0xaa, 0x55, 0xaa, 0x55, 0x05, 0x00, 0x00, 0x00, 0x04, 0x00, 0x0f, 0x2f, 0x00, 0x04, 0x0b, 0x00,
]);
export const HEADER_END = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x06, 0x00, 0x00, 0x00]);
export const CHUNK_HEADER = Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x08, 0x00, 0x00, 0x00]);

export function formatHexPreview(buf: Uint8Array, maxBytes = 32): string {
  const slice = buf.subarray(0, Math.min(buf.length, maxBytes));
  const hex = Array.from(slice)
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');
  return buf.length > maxBytes ? `${hex} ... (+${buf.length - maxBytes}B)` : hex;
}

/**
 * Exact pixel conversion from crates/asterctl-lcd/src/lib.rs (`ToRgb565::convert_rgb`):
 *   ((r & 248) as u16) << 8 | ((g & 252) as u16) << 3 | ((b as u16) >> 3)
 * Note: aoostar-rs does NOT scale pixels for brightness.
 */
export function rgb888ToRgb565(r: number, g: number, b: number): number {
  return (((r & 0xf8) << 8) | ((g & 0xfc) << 3) | ((b & 0xff) >> 3)) & 0xffff;
}

/**
 * Exact frame conversion from crates/asterctl-lcd/src/lib.rs (`ToRgb565::to_rgb565_le`):
 * Row-major order, 16-bit RGB565 stored in little-endian (`put_u16_le`).
 */
export function rgbaToRgb565Le(
  rgbaBuffer: Uint8Array,
  width = DISPLAY_WIDTH,
  height = DISPLAY_HEIGHT
): Buffer {
  const pixelCount = width * height;
  if (rgbaBuffer.length < pixelCount * 4) {
    throw new Error(
      `Invalid RGBA buffer length: expected at least ${pixelCount * 4} bytes for ${width}x${height}, got ${rgbaBuffer.length}`
    );
  }
  const out = Buffer.allocUnsafe(pixelCount * 2);
  for (let i = 0; i < pixelCount; i++) {
    const srcIdx = i * 4;
    const val = rgb888ToRgb565(rgbaBuffer[srcIdx], rgbaBuffer[srcIdx + 1], rgbaBuffer[srcIdx + 2]);
    out.writeUInt16LE(val, i * 2);
  }
  return out;
}

/**
 * Software brightness dimming applied to an RGBA frame BEFORE RGB565 LE conversion.
 * When brightnessPercent >= 100, returns a byte-identical copy of the input RGBA buffer.
 */
export function applyBrightnessScaleRgba(
  rgbaBuffer: Uint8Array,
  brightnessPercent: number,
  width = DISPLAY_WIDTH,
  height = DISPLAY_HEIGHT
): Buffer {
  const expected = width * height * 4;
  if (rgbaBuffer.length < expected) {
    throw new Error(
      `Invalid RGBA buffer length: expected at least ${expected} bytes, got ${rgbaBuffer.length}`
    );
  }
  const pct = Number.isFinite(brightnessPercent) ? Math.max(0, Math.min(100, brightnessPercent)) : 100;
  if (pct >= 100) {
    return Buffer.from(rgbaBuffer.subarray(0, expected));
  }
  const scale = pct / 100;
  const out = Buffer.allocUnsafe(expected);
  for (let i = 0; i < expected; i += 4) {
    out[i] = Math.round(rgbaBuffer[i] * scale);
    out[i + 1] = Math.round(rgbaBuffer[i + 1] * scale);
    out[i + 2] = Math.round(rgbaBuffer[i + 2] * scale);
    out[i + 3] = rgbaBuffer[i + 3];
  }
  return out;
}

/**
 * Exact chunk packet construction from crates/asterctl-lcd/src/aoo_screen.rs (`AooScreen::send_image`):
 *   HEADER (8 bytes) + offset (u32 LE, 4 bytes) + rgb565 chunk (47 bytes) = 59 bytes.
 * No CRC bytes are appended or inserted.
 */
export function buildDataChunkPacket(byteOffset: number, chunkPayload: Uint8Array): Buffer {
  if (!Number.isInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`Invalid chunk byte offset: ${byteOffset}`);
  }
  if (chunkPayload.length === 0 || chunkPayload.length > IMG_CHUNK_SIZE) {
    throw new Error(
      `Invalid chunk payload length: expected 1..${IMG_CHUNK_SIZE}, got ${chunkPayload.length}`
    );
  }
  const packet = Buffer.allocUnsafe(8 + 4 + chunkPayload.length);
  CHUNK_HEADER.copy(packet, 0);
  packet.writeUInt32LE(byteOffset >>> 0, 8);
  Buffer.from(chunkPayload.buffer, chunkPayload.byteOffset, chunkPayload.byteLength).copy(packet, 12);
  return packet;
}

export interface EncodedFramePackets {
  headerStart: Buffer;
  chunks: Buffer[];
  headerEnd: Buffer;
  totalBytesOnWire: number;
  frameSha256Short: string;
}

/**
 * Builds the exact sequential frame packet stream defined in `AooScreen::send_image`:
 *   HEADER_START -> 15,360 sequential data chunks (47B each) -> HEADER_END
 */
export function buildFramePacketSequence(rgb565Le: Uint8Array): EncodedFramePackets {
  if (rgb565Le.length !== EXPECTED_RGB565_BYTES) {
    throw new Error(
      `Invalid RGB565 frame length: expected ${EXPECTED_RGB565_BYTES} bytes (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x2), got ${rgb565Le.length}`
    );
  }

  const chunks: Buffer[] = [];
  let totalBytesOnWire = HEADER_START.length + HEADER_END.length;

  for (let offset = 0; offset < rgb565Le.length; offset += IMG_CHUNK_SIZE) {
    const slice = rgb565Le.subarray(offset, Math.min(rgb565Le.length, offset + IMG_CHUNK_SIZE));
    const packet = buildDataChunkPacket(offset, slice);
    chunks.push(packet);
    totalBytesOnWire += packet.length;
  }

  const frameSha256Short = crypto
    .createHash('sha256')
    .update(rgb565Le)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  return {
    headerStart: Buffer.from(HEADER_START),
    chunks,
    headerEnd: Buffer.from(HEADER_END),
    totalBytesOnWire,
    frameSha256Short,
  };
}

export interface DiffEncodedFramePackets extends EncodedFramePackets {
  changedChunkIndices: number[];
  changedChunkCount: number;
  totalChunks: number;
  fullSync: boolean;
}

/**
 * Computes changed 47-byte chunk indices against `prevRgb565` without allocating per-packet Buffers.
 */
export function computeDiffChunkIndices(
  prevRgb565: Uint8Array | null,
  nextRgb565: Uint8Array,
  forceFull = false
): {changedIndices: number[]; fullSync: boolean; frameSha256Short: string} {
  if (nextRgb565.length !== EXPECTED_RGB565_BYTES) {
    throw new Error(
      `Invalid RGB565 frame length: expected ${EXPECTED_RGB565_BYTES} bytes (${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x2), got ${nextRgb565.length}`
    );
  }
  const hasValidPrev = Boolean(prevRgb565 && prevRgb565.length === EXPECTED_RGB565_BYTES);
  const fullSync = forceFull || !hasValidPrev;

  const changedIndices: number[] = [];
  if (fullSync) {
    for (let idx = 0; idx < EXPECTED_TOTAL_CHUNKS; idx++) {
      changedIndices.push(idx);
    }
  } else if (prevRgb565) {
    for (let idx = 0; idx < EXPECTED_TOTAL_CHUNKS; idx++) {
      const offset = idx * IMG_CHUNK_SIZE;
      for (let j = 0; j < IMG_CHUNK_SIZE; j++) {
        if (prevRgb565[offset + j] !== nextRgb565[offset + j]) {
          changedIndices.push(idx);
          break;
        }
      }
    }
  }

  const frameSha256Short = crypto
    .createHash('sha256')
    .update(nextRgb565)
    .digest('hex')
    .slice(0, 12)
    .toUpperCase();

  return {changedIndices, fullSync, frameSha256Short};
}

/**
 * Packs a slice of chunk indices directly into a single contiguous wire buffer (N * 59 bytes).
 */
export function buildChunkPacketBatch(
  rgb565Le: Uint8Array,
  chunkIndices: number[],
  startIdx: number,
  endIdx: number
): Buffer {
  const count = Math.max(0, endIdx - startIdx);
  const batch = Buffer.allocUnsafe(count * DATA_CHUNK_PACKET_SIZE);
  const src = Buffer.from(rgb565Le.buffer, rgb565Le.byteOffset, rgb565Le.byteLength);

  for (let i = 0; i < count; i++) {
    const chunkIdx = chunkIndices[startIdx + i];
    const byteOffset = chunkIdx * IMG_CHUNK_SIZE;
    const dst = i * DATA_CHUNK_PACKET_SIZE;
    CHUNK_HEADER.copy(batch, dst);
    batch.writeUInt32LE(byteOffset >>> 0, dst + 8);
    src.copy(batch, dst + 12, byteOffset, byteOffset + IMG_CHUNK_SIZE);
  }
  return batch;
}

/**
 * Computes changed 47-byte RGB565 chunks against `prevRgb565` (as implemented in `aoostar-rs` frame diff cache).
 * Wraps changed chunks in `HEADER_START` ... `HEADER_END`, or returns 0 chunks when frames are identical.
 */
export function buildDiffFramePacketSequence(
  prevRgb565: Uint8Array | null,
  nextRgb565: Uint8Array,
  forceFull = false
): DiffEncodedFramePackets {
  const {changedIndices, fullSync, frameSha256Short} = computeDiffChunkIndices(
    prevRgb565,
    nextRgb565,
    forceFull
  );

  const chunks: Buffer[] = new Array(changedIndices.length);
  for (let i = 0; i < changedIndices.length; i++) {
    const offset = changedIndices[i] * IMG_CHUNK_SIZE;
    const slice = nextRgb565.subarray(offset, offset + IMG_CHUNK_SIZE);
    chunks[i] = buildDataChunkPacket(offset, slice);
  }

  const totalBytesOnWire =
    chunks.length === 0 ? 0 : HEADER_START.length + chunks.length * DATA_CHUNK_PACKET_SIZE + HEADER_END.length;

  return {
    headerStart: Buffer.from(HEADER_START),
    chunks,
    headerEnd: Buffer.from(HEADER_END),
    changedChunkIndices: changedIndices,
    changedChunkCount: chunks.length,
    totalChunks: EXPECTED_TOTAL_CHUNKS,
    totalBytesOnWire,
    frameSha256Short,
    fullSync,
  };
}

/**
 * Exact ACK validation from crates/asterctl-lcd/src/aoo_screen.rs (`AooScreen::init` lines 141-154):
 * - Fails if 0 bytes available
 * - Fails if response buffer does not contain `b'A'` (0x41)
 */
export function parseInitAckResponse(responseBuf: Uint8Array): {
  ok: boolean;
  bytesRead: number;
  containsAckByte: boolean;
  hexPreview: string;
  errorMessage: string | null;
} {
  const bytesRead = responseBuf.length;
  if (bytesRead === 0) {
    return {
      ok: false,
      bytesRead: 0,
      containsAckByte: false,
      hexPreview: '',
      errorMessage: 'Initialization failed, no response received (expected ASCII "A" / 0x41)',
    };
  }

  let containsAckByte = false;
  for (let i = 0; i < responseBuf.length; i++) {
    if (responseBuf[i] === INIT_ACK_BYTE) {
      containsAckByte = true;
      break;
    }
  }

  const hexPreview = formatHexPreview(responseBuf, 32);
  if (!containsAckByte) {
    const textPreview = Buffer.from(responseBuf).toString('utf8').replace(/[^\x20-\x7E]/g, '?');
    return {
      ok: false,
      bytesRead,
      containsAckByte: false,
      hexPreview,
      errorMessage: `Initialization failed, received unexpected bytes [${hexPreview}] ("${textPreview}")`,
    };
  }

  return {
    ok: true,
    bytesRead,
    containsAckByte: true,
    hexPreview,
    errorMessage: null,
  };
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function pngCrc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeUInt32BE(pngCrc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Pure TypeScript PNG encoder using Node built-in `zlib.deflateSync` so rendered 960x376
 * Studio screens can be passed directly to `asterctl` without native image library dependencies.
 */
export function encodePngRgba(
  rgba: Uint8Array,
  width = DISPLAY_WIDTH,
  height = DISPLAY_HEIGHT
): Buffer {
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`PNG encode expected at least ${expected} RGBA bytes, got ${rgba.length}`);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const rawScanlines = Buffer.allocUnsafe(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const dstStart = y * (stride + 1);
    rawScanlines[dstStart] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(rawScanlines, dstStart + 1);
  }

  const compressed = zlib.deflateSync(rawScanlines, {level: 3});
  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}
