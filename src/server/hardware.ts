import crypto from 'node:crypto';
import type {DiagnosticsSnapshot, ExposedEntity, LastFrameMeta, LcdScreen, TelemetrySnapshot} from '../types.ts';
import {
  CRC_ALGORITHM,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  EXPECTED_RGB565_BYTES,
  EXPECTED_TOTAL_CHUNKS,
  formatHexPreview,
  HEADER_START,
  rgbaToRgb565Le,
} from './aoostar/protocol.ts';
import {
  activateEmergencyStop,
  canPerformRealSerialWrite,
  clearEmergencyStop,
  closeActiveSerialTransport,
  getSerialDiagnosticsState,
  inspectSerialPermissions,
  isEmergencyStopped,
  isSerialWritesEnvEnabled,
  pushFrameOverRealSerial,
  resolveStrictAoostarDevice,
  runDryRunFrame,
  runSafeDisplayOnOverSerial,
  scanUsbSerialDevices,
  sendDisplayOffOverSerial,
  setLastProtocolError,
} from './aoostar/serial.ts';
import {
  createCalibrationTestRgba,
  detectAsterctlBinary,
  getAsterctlStatus,
  runOneShotAsterctlCommand,
  sendImageViaAsterctl,
  startOrRestartAsterctlDaemon,
  stopAsterctlProcess,
  testAsterctlIntegration,
  writeAsterctlMonitorAssets,
  writeAsterctlSensorSnapshot,
} from './aoostar/asterctl.ts';

const HEADER_START_HEX = formatHexPreview(HEADER_START, 16);

let lastFrameMeta: LastFrameMeta = {
  pushedAt: null,
  screenId: null,
  screenName: null,
  width: DISPLAY_WIDTH,
  height: DISPLAY_HEIGHT,
  byteLength: EXPECTED_RGB565_BYTES,
  crc16Hex: 'NONE (aoostar-rs uses no wire CRC)',
  crcAlgorithm: CRC_ALGORITHM,
  devicePath: '/dev/ttyACM0',
  deliveryMode: 'blocked',
  headerHex: HEADER_START_HEX,
  chunksSent: 0,
  totalChunks: EXPECTED_TOTAL_CHUNKS,
  initAck: false,
  powerState: 'off',
  lastError: null,
};

let lastRgb565Buffer: Buffer | null = null;

export {
  activateEmergencyStop,
  clearEmergencyStop,
  closeActiveSerialTransport,
  inspectSerialPermissions,
  isEmergencyStopped,
  isSerialWritesEnvEnabled,
  scanUsbSerialDevices,
  stopAsterctlProcess,
  testAsterctlIntegration,
  writeAsterctlSensorSnapshot,
};

export function getLastFrameMeta(): LastFrameMeta {
  return lastFrameMeta;
}

export function getLastFrameBuffer(): Buffer | null {
  return lastRgb565Buffer;
}

export function buildDiagnosticsSnapshot(sessionPushArmed: boolean, preferredDevicePath?: string): DiagnosticsSnapshot {
  const devices = scanUsbSerialDevices();
  const perms = inspectSerialPermissions(preferredDevicePath);
  const asterctl = getAsterctlStatus();
  const serialDiag = getSerialDiagnosticsState();
  const aoostarMatch = devices.find((d) => d.isAoostarMatch);

  const activeTransport: DiagnosticsSnapshot['activeTransport'] =
    !serialDiag.serialWritesEnabled || serialDiag.emergencyStopped
      ? 'blocked'
      : asterctl.available
        ? 'asterctl'
        : 'protocol-serial';

  return {
    detectedDevicePath: aoostarMatch?.path ?? perms.devicePath ?? null,
    usbVidPid: aoostarMatch ? `${aoostarMatch.vendorId}:${aoostarMatch.productId}` : perms.usbVidPid,
    serialPermissions: perms,
    detectedDevices: devices,
    asterctl,
    serialWritesEnabled: serialDiag.serialWritesEnabled,
    emergencyStopped: serialDiag.emergencyStopped,
    sessionPushArmed,
    activeTransport,
    lastProtocolError: serialDiag.lastProtocolError || asterctl.lastError,
    lastPacketPreview: serialDiag.lastPacketPreview,
    lastDryRunSummary: serialDiag.lastDryRunSummary,
    lastFrame: lastFrameMeta,
    serialLogs: serialDiag.serialLogs,
    dryRunLog: serialDiag.dryRunLog,
  };
}

/**
 * Dry-run frame build & protocol packet audit. Never touches /dev/ttyACM0.
 */
export function dryRunScreenFrame(params: {
  rgbaBuffer: Uint8Array;
  screenId: string;
  screenName: string;
}) {
  const dry = runDryRunFrame({
    rgbaBuffer: params.rgbaBuffer,
    screenId: params.screenId,
    screenName: params.screenName,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
  });

  lastRgb565Buffer = rgbaToRgb565Le(params.rgbaBuffer, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  lastFrameMeta = {
    pushedAt: new Date().toISOString(),
    screenId: params.screenId,
    screenName: params.screenName,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    byteLength: dry.rgb565Bytes,
    crc16Hex: `SHA256:${dry.frameSha256Short}`,
    frameDigestHex: dry.frameSha256Short,
    crcAlgorithm: 'none',
    devicePath: 'DRY_RUN (no serial write)',
    deliveryMode: 'dry-run',
    headerHex: dry.headerStartHex,
    chunksSent: 0,
    totalChunks: dry.totalChunks,
    initAck: false,
    powerState: 'off',
    lastError: null,
  };

  return dry;
}

/**
 * Pushes a rendered frame using Path A (asterctl) when available,
 * or exact Path B protocol (protocol.ts + serial.ts) ONLY if asterctl binary is missing.
 * Never falls back silently to virtual-buffer on failure; throws on any error.
 */
export async function pushHardwareFrame(params: {
  rgbaBase64?: string;
  rgbaBuffer?: Buffer;
  screenId: string;
  screenName: string;
  devicePath: string;
  powerOff?: boolean;
}): Promise<LastFrameMeta> {
  const rgbaBuf = params.rgbaBuffer
    ? params.rgbaBuffer
    : params.rgbaBase64
      ? Buffer.from(params.rgbaBase64, 'base64')
      : Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);

  const rgb565 = rgbaToRgb565Le(rgbaBuf, DISPLAY_WIDTH, DISPLAY_HEIGHT);
  const digestShort = crypto.createHash('sha256').update(rgb565).digest('hex').slice(0, 12).toUpperCase();
  lastRgb565Buffer = rgb565;

  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    lastFrameMeta = {
      pushedAt: new Date().toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${digestShort}`,
      frameDigestHex: digestShort,
      crcAlgorithm: 'none',
      devicePath: params.devicePath,
      deliveryMode: 'blocked',
      headerHex: HEADER_START_HEX,
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      initAck: false,
      powerState: 'off',
      lastError: gate.reason,
    };
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  const bin = detectAsterctlBinary();

  try {
    if (params.powerOff) {
      if (bin.available) {
        const resolved = resolveStrictAoostarDevice(params.devicePath);
        if (!resolved.devicePath) {
          throw new Error(resolved.error || 'Aoostar USB device (0416:90a1) not found');
        }
        await stopAsterctlProcess();
        await runOneShotAsterctlCommand(['--device', resolved.devicePath, '--off']);
        lastFrameMeta = {
          pushedAt: new Date().toISOString(),
          screenId: params.screenId,
          screenName: params.screenName,
          width: DISPLAY_WIDTH,
          height: DISPLAY_HEIGHT,
          byteLength: rgb565.length,
          crc16Hex: `SHA256:${digestShort}`,
          frameDigestHex: digestShort,
          crcAlgorithm: 'none',
          devicePath: resolved.devicePath,
          deliveryMode: 'asterctl',
          headerHex: HEADER_START_HEX,
          chunksSent: 0,
          totalChunks: EXPECTED_TOTAL_CHUNKS,
          initAck: true,
          powerState: 'off',
          lastError: null,
        };
        return lastFrameMeta;
      }

      const offRes = sendDisplayOffOverSerial(params.devicePath);
      lastFrameMeta = {
        pushedAt: new Date().toISOString(),
        screenId: params.screenId,
        screenName: params.screenName,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        byteLength: rgb565.length,
        crc16Hex: `SHA256:${digestShort}`,
        frameDigestHex: digestShort,
        crcAlgorithm: 'none',
        devicePath: offRes.devicePath,
        deliveryMode: 'usb-serial',
        headerHex: HEADER_START_HEX,
        chunksSent: 0,
        totalChunks: EXPECTED_TOTAL_CHUNKS,
        initAck: true,
        powerState: 'off',
        lastError: null,
      };
      return lastFrameMeta;
    }

    // Path A (Preferred): authoritative asterctl binary
    if (bin.available) {
      const res = await sendImageViaAsterctl({
        rgbaBuffer: rgbaBuf,
        requestedDevicePath: params.devicePath,
      });
      lastFrameMeta = {
        pushedAt: new Date().toISOString(),
        screenId: params.screenId,
        screenName: params.screenName,
        width: DISPLAY_WIDTH,
        height: DISPLAY_HEIGHT,
        byteLength: rgb565.length,
        crc16Hex: `SHA256:${digestShort}`,
        frameDigestHex: digestShort,
        crcAlgorithm: 'none',
        devicePath: res.devicePath,
        deliveryMode: 'asterctl',
        headerHex: HEADER_START_HEX,
        chunksSent: EXPECTED_TOTAL_CHUNKS,
        totalChunks: EXPECTED_TOTAL_CHUNKS,
        initAck: true,
        powerState: 'on',
        lastError: null,
      };
      return lastFrameMeta;
    }

    // Path B (Only when asterctl binary is unavailable): exact aoostar-rs serial protocol
    const res = pushFrameOverRealSerial({
      rgbaBuffer: rgbaBuf,
      requestedDevicePath: params.devicePath,
    });
    lastFrameMeta = {
      pushedAt: new Date().toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${res.frameSha256Short}`,
      frameDigestHex: res.frameSha256Short,
      crcAlgorithm: 'none',
      devicePath: res.devicePath,
      deliveryMode: 'usb-serial',
      headerHex: HEADER_START_HEX,
      chunksSent: res.chunksSent,
      totalChunks: res.totalChunks,
      initAck: true,
      powerState: 'on',
      lastError: null,
    };
    return lastFrameMeta;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setLastProtocolError(msg);
    lastFrameMeta = {
      pushedAt: new Date().toISOString(),
      screenId: params.screenId,
      screenName: params.screenName,
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      byteLength: rgb565.length,
      crc16Hex: `SHA256:${digestShort}`,
      frameDigestHex: digestShort,
      crcAlgorithm: 'none',
      devicePath: params.devicePath,
      deliveryMode: 'error',
      headerHex: HEADER_START_HEX,
      chunksSent: 0,
      totalChunks: EXPECTED_TOTAL_CHUNKS,
      initAck: false,
      powerState: 'off',
      lastError: msg,
    };
    throw err;
  }
}

/**
 * Path A daemon sync: generates monitor.json + panel PNGs + sensor snapshot and restarts asterctl.
 */
export async function deployScreensWithAsterctl(params: {
  screensWithBuffers: Array<{screen: LcdScreen; rgbaBuffer: Buffer}>;
  telemetry: TelemetrySnapshot;
  exposedEntities: ExposedEntity[];
  devicePath: string;
}): Promise<{pid: number; binaryPath: string; devicePath: string; monitorJsonPath: string}> {
  writeAsterctlSensorSnapshot(params.telemetry, params.exposedEntities);
  const assets = writeAsterctlMonitorAssets({
    screens: params.screensWithBuffers,
    refreshSec: 1,
  });
  const started = await startOrRestartAsterctlDaemon({
    requestedDevicePath: params.devicePath,
  });
  lastFrameMeta = {
    pushedAt: new Date().toISOString(),
    screenId: params.screensWithBuffers[0]?.screen.id ?? null,
    screenName: params.screensWithBuffers[0]?.screen.name ?? null,
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    byteLength: EXPECTED_RGB565_BYTES,
    crc16Hex: 'Managed by asterctl',
    crcAlgorithm: 'none',
    devicePath: started.devicePath,
    deliveryMode: 'asterctl',
    headerHex: HEADER_START_HEX,
    chunksSent: EXPECTED_TOTAL_CHUNKS,
    totalChunks: EXPECTED_TOTAL_CHUNKS,
    initAck: true,
    powerState: 'on',
    lastError: null,
  };
  return {
    ...started,
    monitorJsonPath: assets.monitorJsonPath,
  };
}

export async function runSafeHardwareTest(params: {
  confirmed: boolean;
  mode: 'display-on' | 'test-frame';
  devicePath: string;
  rgbaBuffer?: Buffer;
  screenId?: string;
  screenName?: string;
}) {
  if (!params.confirmed) {
    throw new Error('Explicit user confirmation is required before running a hardware test.');
  }

  const gate = canPerformRealSerialWrite();
  if (!gate.allowed) {
    throw new Error(gate.reason || 'Serial writes disabled');
  }

  const bin = detectAsterctlBinary();

  if (params.mode === 'display-on') {
    if (bin.available) {
      const resolved = resolveStrictAoostarDevice(params.devicePath);
      if (!resolved.devicePath) {
        throw new Error(resolved.error || 'Aoostar USB device (0416:90a1) not found');
      }
      await stopAsterctlProcess();
      const out = await runOneShotAsterctlCommand(['--device', resolved.devicePath, '--on']);
      return {
        ok: true,
        transport: 'asterctl',
        devicePath: resolved.devicePath,
        ackOk: true,
        output: [out.stdout, out.stderr].filter(Boolean).join('\n'),
      };
    }

    const res = runSafeDisplayOnOverSerial(params.devicePath);
    return {
      ok: true,
      transport: 'protocol-serial',
      devicePath: res.devicePath,
      ackOk: res.ackOk,
      ackBytesHex: res.ackBytesHex,
    };
  }

  const testRgba = params.rgbaBuffer ?? createCalibrationTestRgba();
  const meta = await pushHardwareFrame({
    rgbaBuffer: testRgba,
    screenId: params.screenId || 'safe-test-frame',
    screenName: params.screenName || 'Aoostar Safe Test Pattern',
    devicePath: params.devicePath,
  });

  return {
    ok: true,
    transport: meta.deliveryMode,
    devicePath: meta.devicePath,
    meta,
  };
}
