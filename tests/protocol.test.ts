import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDataChunkPacket,
  buildFramePacketSequence,
  CHUNK_HEADER,
  CRC_ALGORITHM,
  DATA_CHUNK_PACKET_SIZE,
  DISPLAY_HEIGHT,
  DISPLAY_OFF,
  DISPLAY_ON,
  DISPLAY_WIDTH,
  encodePngRgba,
  EXPECTED_RGB565_BYTES,
  EXPECTED_TOTAL_CHUNKS,
  HEADER_END,
  HEADER_START,
  IMG_CHUNK_SIZE,
  parseInitAckResponse,
  rgb888ToRgb565,
  rgbaToRgb565Le,
  UART_BAUDRATE,
  USB_UART_PID,
  USB_UART_VID,
} from '../src/server/aoostar/protocol.ts';
import {
  activateEmergencyStop,
  canPerformRealSerialWrite,
  clearDryRunLog,
  clearEmergencyStop,
  getSerialDiagnosticsState,
  runDryRunFrame,
} from '../src/server/aoostar/serial.ts';

test('aoostar-rs constants match crates/asterctl-lcd/src/aoo_screen.rs exactly', () => {
  assert.equal(DISPLAY_WIDTH, 960);
  assert.equal(DISPLAY_HEIGHT, 376);
  assert.equal(USB_UART_VID, 0x0416);
  assert.equal(USB_UART_PID, 0x90a1);
  assert.equal(UART_BAUDRATE, 1_500_000);
  assert.equal(IMG_CHUNK_SIZE, 47);
  assert.equal(EXPECTED_RGB565_BYTES, 721_920);
  assert.equal(EXPECTED_TOTAL_CHUNKS, 15_360);
  assert.equal(DATA_CHUNK_PACKET_SIZE, 59);
  assert.equal(CRC_ALGORITHM, 'none');

  assert.deepEqual(
    DISPLAY_OFF,
    Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0a, 0x00, 0x00, 0x00])
  );
  assert.deepEqual(
    DISPLAY_ON,
    Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x0b, 0x00, 0x00, 0x00])
  );
  assert.deepEqual(
    HEADER_START,
    Buffer.from([
      0xaa, 0x55, 0xaa, 0x55, 0x05, 0x00, 0x00, 0x00, 0x04, 0x00, 0x0f, 0x2f, 0x00, 0x04, 0x0b, 0x00,
    ])
  );
  assert.deepEqual(
    HEADER_END,
    Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x06, 0x00, 0x00, 0x00])
  );
  assert.deepEqual(
    CHUNK_HEADER,
    Buffer.from([0xaa, 0x55, 0xaa, 0x55, 0x08, 0x00, 0x00, 0x00])
  );
});

test('RGB565 conversion matches ToRgb565::to_rgb565_le with no brightness pixel scaling', () => {
  assert.equal(rgb888ToRgb565(255, 0, 0), 0xf800);
  assert.equal(rgb888ToRgb565(0, 255, 0), 0x07e0);
  assert.equal(rgb888ToRgb565(0, 0, 255), 0x001f);
  assert.equal(rgb888ToRgb565(255, 255, 255), 0xffff);
  assert.equal(rgb888ToRgb565(0, 0, 0), 0x0000);

  const rgba = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  // Pixel 0: pure red -> 0xF800 LE => [0x00, 0xF8]
  rgba[0] = 255;
  rgba[1] = 0;
  rgba[2] = 0;
  rgba[3] = 255;
  // Pixel 1: pure green -> 0x07E0 LE => [0xE0, 0x07]
  rgba[4] = 0;
  rgba[5] = 255;
  rgba[6] = 0;
  rgba[7] = 255;
  // Pixel 2: pure blue -> 0x001F LE => [0x1F, 0x00]
  rgba[8] = 0;
  rgba[9] = 0;
  rgba[10] = 255;
  rgba[11] = 255;

  const rgb565 = rgbaToRgb565Le(rgba);
  assert.equal(rgb565.length, EXPECTED_RGB565_BYTES);
  assert.equal(rgb565[0], 0x00);
  assert.equal(rgb565[1], 0xf8);
  assert.equal(rgb565[2], 0xe0);
  assert.equal(rgb565[3], 0x07);
  assert.equal(rgb565[4], 0x1f);
  assert.equal(rgb565[5], 0x00);
});

test('packet construction & chunk ordering produce exact 59-byte sequential packets with zero CRC bytes', () => {
  const payload = Buffer.alloc(IMG_CHUNK_SIZE, 0x5a);
  const pkt = buildDataChunkPacket(47 * 5, payload);
  assert.equal(pkt.length, 59);
  assert.deepEqual(pkt.subarray(0, 8), CHUNK_HEADER);
  assert.equal(pkt.readUInt32LE(8), 235);
  assert.deepEqual(pkt.subarray(12), payload);

  const rgba = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = (i >> 2) & 0xff;
    rgba[i + 1] = ((i >> 2) * 3) & 0xff;
    rgba[i + 2] = ((i >> 2) * 7) & 0xff;
    rgba[i + 3] = 255;
  }

  const rgb565 = rgbaToRgb565Le(rgba);
  const seq = buildFramePacketSequence(rgb565);

  assert.equal(seq.chunks.length, EXPECTED_TOTAL_CHUNKS);
  assert.equal(seq.totalBytesOnWire, 16 + EXPECTED_TOTAL_CHUNKS * 59 + 8);

  const reconstructed = Buffer.alloc(EXPECTED_RGB565_BYTES);
  for (let idx = 0; idx < seq.chunks.length; idx++) {
    const chunkPkt = seq.chunks[idx];
    assert.equal(chunkPkt.length, DATA_CHUNK_PACKET_SIZE);
    assert.deepEqual(chunkPkt.subarray(0, 8), CHUNK_HEADER);
    const offset = chunkPkt.readUInt32LE(8);
    assert.equal(offset, idx * IMG_CHUNK_SIZE);
    chunkPkt.subarray(12).copy(reconstructed, offset);
  }
  assert.deepEqual(reconstructed, rgb565);
});

test('parseInitAckResponse mirrors AooScreen::init ACK parsing strictly', () => {
  const empty = parseInitAckResponse(Buffer.alloc(0));
  assert.equal(empty.ok, false);
  assert.match(empty.errorMessage || '', /no response/i);

  const wrong = parseInitAckResponse(Buffer.from([0x42, 0x0d, 0x0a]));
  assert.equal(wrong.ok, false);
  assert.equal(wrong.containsAckByte, false);

  const exactA = parseInitAckResponse(Buffer.from([0x41]));
  assert.equal(exactA.ok, true);
  assert.equal(exactA.containsAckByte, true);

  const embeddedA = parseInitAckResponse(Buffer.from([0x00, 0x41, 0x0a]));
  assert.equal(embeddedA.ok, true);
});

test('dry-run mode builds and logs packets without writing to serial device', () => {
  clearDryRunLog();
  const rgba = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4, 0x33);
  const res = runDryRunFrame({
    rgbaBuffer: rgba,
    screenId: 'test-scr',
    screenName: 'Test Dry Run',
  });

  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.wroteToDevice, false);
  assert.equal(res.totalChunks, EXPECTED_TOTAL_CHUNKS);
  assert.equal(res.crcAlgorithm, 'none');

  const state = getSerialDiagnosticsState();
  assert.ok(state.dryRunLog.length >= 4);
  assert.equal(state.dryRunLog[0].direction, 'DRY_RUN');
});

test('safety gates block writes when AOOSTAR_ENABLE_SERIAL_WRITES!=true or emergency stopped', () => {
  const prev = process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
  try {
    delete process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
    clearEmergencyStop();
    assert.equal(canPerformRealSerialWrite().allowed, false);

    process.env.AOOSTAR_ENABLE_SERIAL_WRITES = 'true';
    assert.equal(canPerformRealSerialWrite().allowed, true);

    activateEmergencyStop('unit-test stop');
    assert.equal(canPerformRealSerialWrite().allowed, false);

    clearEmergencyStop();
    assert.equal(canPerformRealSerialWrite().allowed, true);
  } finally {
    if (prev === undefined) delete process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
    else process.env.AOOSTAR_ENABLE_SERIAL_WRITES = prev;
    clearEmergencyStop();
  }
});

test('encodePngRgba produces a valid PNG container for asterctl', () => {
  const rgba = Buffer.alloc(16 * 8 * 4, 0x80);
  const png = encodePngRgba(rgba, 16, 8);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), 16);
  assert.equal(png.readUInt32BE(20), 8);
  assert.equal(png.subarray(png.length - 8, png.length - 4).toString('ascii'), 'IEND');
});
