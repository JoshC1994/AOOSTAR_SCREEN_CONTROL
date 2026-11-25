import crypto from 'node:crypto';
import type {
  DaemonLifecycleState,
  DiagnosticsSnapshot,
  ExposedEntity,
  LastFrameMeta,
  LcdScreen,
  TelemetrySnapshot,
} from '../types.ts';
import {
  applyBrightnessScaleRgba,
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
  closeActiveSerialTransportAsync,
  getSerialDiagnosticsState,
  inspectSerialPermissions,
  isConfigSerialWritesEnabled,
  isEmergencyStopped,
  isSerialWritesActive,
  isSerialWritesEnvEnabled,
  isSerialWritesEnvLocked,
  pushFrameOverRealSerialAsync,
  resetFrameDiffCache,
  runDryRunFrame,
  runSafeDisplayOnOverSerialAsync,
  scanUsbSerialDevices,
  sendDisplayOffOverSerialAsync,
  setConfigSerialWritesEnabled,
  setLastProtocolError,
} from './aoostar/serial.ts';
import {
  createCalibrationTestRgba,
  getAsterctlStatus,
  runAsterctlPowerDiagnostic,
  stopAsterctlProcess,
  testAsterctlIntegration,
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
  diffMode: true,
  unchangedSkipped: false,
  initAck: false,
  powerState: 'off',
  lastError: null,
};

let lastRgb565Buffer: Buffer | null = null;

export {
  activateEmergencyStop,
  clearEmergencyStop,
  closeActiveSerialTransport,
  closeActiveSerialTransportAsync,
  inspectSerialPermissions,
  isConfigSerialWritesEnabled,
  isEmergencyStopped,
  isSerialWritesActive,
  isSerialWritesEnvEnabled,
  isSerialWritesEnvLocked,
  resetFrameDiffCache,
  runAsterctlPowerDiagnostic,
  scanUsbSerialDevices,
  setConfigSerialWritesEnabled,
  stopAsterctlProcess,
  testAsterctlIntegration,
};

export function getLastFrameMeta(): LastFrameMeta {
  return lastFrameMeta;
}

export function getLastFrameBuffer(): Buffer | null {
  return lastRgb565Buffer;
}

export function setLastFrameMeta(meta: LastFrameMeta): void {
  lastFrameMeta = meta;
}

export function buildDiagnosticsSnapshot(
  sessionPushArmed: boolean,
  preferredDevicePath?: string,
  daemonState?: DaemonLifecycleState
): DiagnosticsSnapshot {
  const devices = scanUsbSerialDevices();
  const perms = inspectSerialPermissions(preferredDevicePath);
  const asterctl = getAsterctlStatus();
  const serialDiag = getSerialDiagnosticsState();
  const aoostarMatch = devices.find((d) => d.isAoostarMatch);

  const activeTransport: DiagnosticsSnapshot['activeTransport'] =
    !serialDiag.serialWritesEnabled || serialDiag.emergencyStopped
      ? 'blocked'
      : 'protocol-serial';

  return {
    detectedDevicePath: aoostarMatch?.path ?? perms.devicePath ?? null,
    usbVidPid: aoostarMatch ? `${aoostarMatch.vendorId}:${aoostarMatch.productId}` : perms.usbVidPid,
    serialPermissions: perms,
    detectedDevices: devices,
    asterctl,
    serialWritesEnabled: serialDiag.serialWritesEnabled,
    serialWritesEnvEnabled: serialDiag.serialWritesEnvEnabled,
    serialWritesConfigEnabled: serialDiag.serialWritesConfigEnabled,
    serialWritesEnvLocked: serialDiag.serialWritesEnvLocked,
    emergencyStopped: serialDiag.emergencyStopped,
    sessionPushArmed,
    daemonState,
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
    diffMode: false,
    unchangedSkipped: false,
    initAck: false,
    powerState: 'off',
    lastError: null,
  };

  return dry;
}

/**
 * Primary LCD frame pusher:
 * Uses Node async diff-cached USB-UART serial transport (`aoostar-rs` exact wire format),
 * avoiding process spawning per frame while preserving strict VID:PID, ACK, and safety gates.
 * `asterctl` remains available for Diagnostics (--simulate / --on) checks.
 */
export async function pushHardwareFrame(params: {
  rgbaBase64?: string;
  rgbaBuffer?: Buffer;
  screenId: string;
  screenName: string;
  devicePath: string;
  brightnessPercent?: number;
  brightnessKey?: number;
  forceFullRefresh?: boolean;
  powerOff?: boolean;
}): Promise<LastFrameMeta> {
  const rawRgba = params.rgbaBuffer
    ? params.rgbaBuffer
    : params.rgbaBase64
      ? Buffer.from(params.rgbaBase64, 'base64')
      : Buffer.alloc(DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);

  const scaledRgba =
    params.brightnessPercent !== undefined && params.brightnessPercent < 100
      ? applyBrightnessScaleRgba(rawRgba, params.brightnessPercent, DISPLAY_WIDTH, DISPLAY_HEIGHT)
      : rawRgba;

  const rgb565 = rgbaToRgb565Le(scaledRgba, DISPLAY_WIDTH, DISPLAY_HEIGHT);
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
      diffMode: true,
      unchangedSkipped: false,
      initAck: false,
      powerState: 'off',
      lastError: gate.reason,
    };
    throw new Error(gate.reason || 'Serial writes blocked');
  }

  try {
    if (getAsterctlStatus().running) {
      await stopAsterctlProcess();
    }

    if (params.powerOff) {
      const offRes = await sendDisplayOffOverSerialAsync(params.devicePath);
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
        diffMode: false,
        unchangedSkipped: false,
        initAck: true,
        powerState: 'off',
        lastError: null,
      };
      return lastFrameMeta;
    }

    const res = await pushFrameOverRealSerialAsync({
      rgbaBuffer: scaledRgba,
      requestedDevicePath: params.devicePath,
      forceFullRefresh: Boolean(params.forceFullRefresh),
      brightnessKey: params.brightnessKey ?? params.brightnessPercent,
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
      diffMode: !res.fullSync,
      unchangedSkipped: res.unchangedSkipped,
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
      diffMode: true,
      unchangedSkipped: false,
      initAck: false,
      powerState: 'off',
      lastError: msg,
    };
    throw err;
  }
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

  if (getAsterctlStatus().running) {
    await stopAsterctlProcess();
  }

  if (params.mode === 'display-on') {
    const res = await runSafeDisplayOnOverSerialAsync(params.devicePath);
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
    forceFullRefresh: true,
  });

  return {
    ok: true,
    transport: meta.deliveryMode,
    devicePath: meta.devicePath,
    meta,
  };
}
