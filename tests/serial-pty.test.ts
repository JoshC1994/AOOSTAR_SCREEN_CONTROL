import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn, spawnSync, type ChildProcessWithoutNullStreams} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  runSafeDisplayOnOverSerialAsync,
  sendDisplayOffOverSerialAsync,
} from '../src/server/aoostar/serial.ts';

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-pty-'));
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

test('PTY emulator: async diff-cached serial pushes full frame, skips identical, diffs changed chunks, and handles DISPLAY_OFF', async (t) => {
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

    // 1. Handshake DISPLAY_ON -> ACK 'A'
    const onRes = await runSafeDisplayOnOverSerialAsync(emu.slavePath);
    assert.equal(onRes.ackOk, true);
    assert.equal(onRes.devicePath, emu.slavePath);
    await waitForCondition(() => readState(emu.stateFile).display_on_count >= 1);

    // 2. Full initial frame push
    const frame1 = Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
    for (let i = 0; i < frame1.length; i += 4) {
      frame1[i] = (i >> 2) & 0xff;
      frame1[i + 1] = ((i >> 2) * 3) & 0xff;
      frame1[i + 2] = 0x20;
      frame1[i + 3] = 0xff;
    }
    const rgb1 = rgbaToRgb565Le(frame1);
    const expectedHash1 = crypto.createHash('sha256').update(rgb1).digest('hex').slice(0, 12).toUpperCase();

    const push1 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frame1,
      requestedDevicePath: emu.slavePath,
    });
    assert.equal(push1.fullSync, true);
    assert.equal(push1.unchangedSkipped, false);
    assert.equal(push1.chunksSent, EXPECTED_TOTAL_CHUNKS);

    await waitForCondition(() => readState(emu.stateFile).frames.length >= 1);
    const stateAfter1 = readState(emu.stateFile);
    assert.equal(stateAfter1.frames[0].chunks_received, EXPECTED_TOTAL_CHUNKS);
    assert.equal(stateAfter1.frames[0].sha256_short, expectedHash1);
    assert.equal(stateAfter1.unknown_bytes, 0);

    // 3. Identical frame -> skipped with 0 wire writes
    const push2 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frame1,
      requestedDevicePath: emu.slavePath,
    });
    assert.equal(push2.unchangedSkipped, true);
    assert.equal(push2.chunksSent, 0);
    assert.equal(readState(emu.stateFile).frames.length, 1);

    // 4. Modify 1 pixel in middle of frame -> diff sends only 1 changed chunk
    const frame2 = Buffer.from(frame1);
    const pixelIdx = 12345;
    frame2[pixelIdx * 4] = frame1[pixelIdx * 4] ^ 0xff;
    frame2[pixelIdx * 4 + 1] = frame1[pixelIdx * 4 + 1] ^ 0xff;
    const rgb2 = rgbaToRgb565Le(frame2);
    const expectedHash2 = crypto.createHash('sha256').update(rgb2).digest('hex').slice(0, 12).toUpperCase();

    const push3 = await pushFrameOverRealSerialAsync({
      rgbaBuffer: frame2,
      requestedDevicePath: emu.slavePath,
    });
    assert.equal(push3.fullSync, false);
    assert.equal(push3.unchangedSkipped, false);
    assert.ok(push3.chunksSent >= 1 && push3.chunksSent <= 2, `Expected 1..2 diff chunks, got ${push3.chunksSent}`);

    await waitForCondition(() => readState(emu.stateFile).frames.length >= 2);
    const stateAfter3 = readState(emu.stateFile);
    assert.equal(stateAfter3.frames[1].chunks_received, push3.chunksSent);
    assert.equal(stateAfter3.frames[1].sha256_short, expectedHash2);
    assert.equal(stateAfter3.unknown_bytes, 0);

    // 5. DISPLAY_OFF
    await sendDisplayOffOverSerialAsync(emu.slavePath);
    await waitForCondition(() => readState(emu.stateFile).display_off_count >= 1);
    assert.equal(readState(emu.stateFile).display_off_count, 1);
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

test('PTY emulator: missing ACK triggers loud failure without silent fallback', async (t) => {
  if (!hasPython3()) {
    t.skip('python3 not installed');
    return;
  }

  const prevSerialEnv = process.env.AOOSTAR_ENABLE_SERIAL_WRITES;
  const prevPtyEnv = process.env.AOOSTAR_TEST_PTY_PATH;
  const emu = await startPtyEmulator(['--no-ack']);

  try {
    process.env.AOOSTAR_ENABLE_SERIAL_WRITES = 'true';
    process.env.AOOSTAR_TEST_PTY_PATH = emu.slavePath;
    clearEmergencyStop();
    await closeActiveSerialTransportAsync();

    await assert.rejects(
      () => runSafeDisplayOnOverSerialAsync(emu.slavePath),
      /no response received/i
    );
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
