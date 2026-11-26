import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHUNK_HEADER,
  DISPLAY_HEIGHT,
  DISPLAY_ON,
  DISPLAY_WIDTH,
  EXPECTED_RGB565_BYTES,
  EXPECTED_TOTAL_CHUNKS,
  HEADER_END,
  HEADER_START,
  IMG_CHUNK_SIZE,
  INIT_ACK_WAIT_MS,
  rgbaToRgb565Le,
} from '../src/server/aoostar/protocol.ts';
import {
  pushFrameViaAsyncTransport,
  pushFrameViaSerialTransport,
  sendDisplayOnHandshake,
  type AsyncSerialPortTransport,
  type SerialPortTransport,
} from '../src/server/aoostar/serial.ts';

class MockSerialFdTransport implements SerialPortTransport {
  public writes: Buffer[] = [];
  public flushCount = 0;
  public sleepCalls: number[] = [];
  public closed = false;
  public rxQueue: Buffer = Buffer.alloc(0);
  private readonly ackResponseOnDisplayOn: Buffer;
  public failFirstNWrites = 0;
  private writeAttempt = 0;

  constructor(rxBytesOnDisplayOn: number[] = [0x41]) {
    this.ackResponseOnDisplayOn = Buffer.from(rxBytesOnDisplayOn);
  }

  writeAll(data: Buffer): void {
    this.writeAttempt += 1;
    if (this.failFirstNWrites > 0) {
      this.failFirstNWrites -= 1;
      const err = new Error('Simulated transient EIO') as NodeJS.ErrnoException;
      err.code = 'EIO';
      throw err;
    }
    const copy = Buffer.from(data);
    this.writes.push(copy);
    if (copy.equals(DISPLAY_ON) && this.ackResponseOnDisplayOn.length > 0) {
      this.rxQueue = Buffer.concat([this.rxQueue, this.ackResponseOnDisplayOn]);
    }
  }

  flush(): void {
    this.flushCount += 1;
  }

  bytesToRead(): number {
    return this.rxQueue.length;
  }

  read(maxBytes: number): Buffer {
    const out = this.rxQueue.subarray(0, maxBytes);
    this.rxQueue = this.rxQueue.subarray(out.length);
    return Buffer.from(out);
  }

  sleepMs(ms: number): void {
    this.sleepCalls.push(ms);
  }

  close(): void {
    this.closed = true;
  }
}

test('integration: mocked serial FD receives exact aoostar-rs byte sequence in strict order', () => {
  const rgba = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  for (let p = 0; p < DISPLAY_WIDTH * DISPLAY_HEIGHT; p++) {
    rgba[p * 4] = (p * 5) & 0xff;
    rgba[p * 4 + 1] = (p * 11) & 0xff;
    rgba[p * 4 + 2] = (p * 17) & 0xff;
    rgba[p * 4 + 3] = 255;
  }
  const expectedRgb565 = rgbaToRgb565Le(rgba);

  const mockFd = new MockSerialFdTransport([0x41]);
  const res = pushFrameViaSerialTransport({
    transport: mockFd,
    rgb565Le: expectedRgb565,
    initializeDisplay: true,
  });

  assert.equal(res.chunksSent, EXPECTED_TOTAL_CHUNKS);
  assert.equal(res.totalChunks, EXPECTED_TOTAL_CHUNKS);
  assert.deepEqual(mockFd.sleepCalls, [INIT_ACK_WAIT_MS]);

  // Expected write calls: 1 (DISPLAY_ON) + 1 (HEADER_START) + 15360 (chunks) + 1 (HEADER_END)
  assert.equal(mockFd.writes.length, EXPECTED_TOTAL_CHUNKS + 3);
  assert.equal(mockFd.flushCount, EXPECTED_TOTAL_CHUNKS + 3);

  assert.deepEqual(mockFd.writes[0], DISPLAY_ON);
  assert.deepEqual(mockFd.writes[1], HEADER_START);

  const reconstructed = Buffer.alloc(EXPECTED_RGB565_BYTES);
  for (let i = 0; i < EXPECTED_TOTAL_CHUNKS; i++) {
    const pkt = mockFd.writes[i + 2];
    assert.equal(pkt.length, 59);
    assert.deepEqual(pkt.subarray(0, 8), CHUNK_HEADER);
    const offset = pkt.readUInt32LE(8);
    assert.equal(offset, i * IMG_CHUNK_SIZE);
    pkt.subarray(12).copy(reconstructed, offset);
  }
  assert.deepEqual(reconstructed, expectedRgb565);

  assert.deepEqual(mockFd.writes[mockFd.writes.length - 1], HEADER_END);
});

test('integration: transient write errors retry up to SERIAL_RETRY=3 and missing/bad ACK fails loudly', () => {
  const retryingFd = new MockSerialFdTransport([0x41]);
  retryingFd.failFirstNWrites = 2; // within SERIAL_RETRY = 3
  const ack = sendDisplayOnHandshake(retryingFd);
  assert.equal(ack.ackOk, true);
  assert.equal(retryingFd.writes.length, 1);

  const noAckFd = new MockSerialFdTransport([]);
  assert.throws(
    () => sendDisplayOnHandshake(noAckFd),
    /no response received/i
  );

  const wrongAckFd = new MockSerialFdTransport([0x45, 0x52, 0x52]);
  assert.throws(
    () => sendDisplayOnHandshake(wrongAckFd),
    /unexpected bytes/i
  );

  const failingFd = new MockSerialFdTransport([0x41]);
  failingFd.failFirstNWrites = 10; // exceeds SERIAL_RETRY = 3
  assert.throws(() => sendDisplayOnHandshake(failingFd), /Simulated transient EIO/);
});

test('integration: async serial transport sends strictly one 59-byte packet per writeAll call for full and diff frames', async () => {
  class MockAsyncTransport implements AsyncSerialPortTransport {
    public writes: Buffer[] = [];
    public rxQueue: Buffer = Buffer.alloc(0);
    public drainedCount = 0;
    async writeAll(data: Buffer) {
      const copy = Buffer.from(data);
      this.writes.push(copy);
      if (copy.equals(DISPLAY_ON)) {
        this.rxQueue = Buffer.from([0x41]);
      }
    }
    async flush() {}
    async drainRx() {
      this.drainedCount += 1;
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

  const frame1 = Buffer.alloc(EXPECTED_RGB565_BYTES, 0x11);
  const frame2 = Buffer.from(frame1);
  // Change 5 non-adjacent chunks so a buggy batching implementation would concatenate 5 * 59 = 295 bytes
  for (const idx of [0, 3, 100, 5000, EXPECTED_TOTAL_CHUNKS - 1]) {
    frame2[idx * IMG_CHUNK_SIZE] = 0x99;
  }

  const transport = new MockAsyncTransport();
  const fullRes = await pushFrameViaAsyncTransport({
    transport,
    rgb565Le: frame1,
    prevRgb565: null,
    initializeDisplay: true,
  });

  assert.equal(fullRes.fullSync, true);
  assert.equal(fullRes.chunksSent, EXPECTED_TOTAL_CHUNKS);
  assert.equal(transport.writes.length, EXPECTED_TOTAL_CHUNKS + 3);
  assert.deepEqual(transport.writes[0], DISPLAY_ON);
  assert.deepEqual(transport.writes[1], HEADER_START);
  for (let i = 0; i < EXPECTED_TOTAL_CHUNKS; i++) {
    const pkt = transport.writes[i + 2];
    assert.equal(pkt.length, 59, `Full frame write #${i} must be exactly one 59B packet`);
    assert.deepEqual(pkt.subarray(0, 8), CHUNK_HEADER);
  }
  assert.deepEqual(transport.writes[transport.writes.length - 1], HEADER_END);

  transport.writes.length = 0;
  const diffRes = await pushFrameViaAsyncTransport({
    transport,
    rgb565Le: frame2,
    prevRgb565: frame1,
    initializeDisplay: false,
  });

  assert.equal(diffRes.fullSync, false);
  assert.equal(diffRes.chunksSent, 5);
  assert.equal(transport.writes.length, 7); // HEADER_START + 5 x 59B chunks + HEADER_END
  assert.deepEqual(transport.writes[0], HEADER_START);
  for (let i = 1; i <= 5; i++) {
    assert.equal(transport.writes[i].length, 59);
    assert.deepEqual(transport.writes[i].subarray(0, 8), CHUNK_HEADER);
  }
  assert.deepEqual(transport.writes[6], HEADER_END);
});
