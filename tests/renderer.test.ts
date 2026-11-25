import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CONFIG} from '../src/presets.ts';
import {DISPLAY_HEIGHT, DISPLAY_WIDTH} from '../src/server/aoostar/protocol.ts';
import {renderScreenToPngBuffer, renderScreenToRgbaBuffer} from '../src/server/frameRenderer.ts';
import {buildExposedEntities} from '../src/server/telemetry.ts';
import type {TelemetrySnapshot} from '../src/types.ts';

function makeSampleTelemetry(): TelemetrySnapshot {
  return {
    timestamp: Date.now(),
    sourceMode: 'local',
    sourceLabel: 'Test Host',
    isRealUnraidHost: false,
    agentConnected: false,
    haConnected: false,
    system: {
      hostname: 'unraid-test',
      unraidVersion: '7.0.0',
      kernel: '6.6.0-unraid',
      uptimeSeconds: 93780,
      cpuModel: 'AMD Ryzen 7 PRO',
      cpuCores: 16,
      cpuPercent: 42,
      cpuTempC: 57,
      cpuPowerW: 48,
      ramUsedBytes: 16 * 1024 ** 3,
      ramTotalBytes: 64 * 1024 ** 3,
      ramCachedBytes: 6 * 1024 ** 3,
      swapTotalBytes: 0,
      swapUsedBytes: 0,
      loadAvg: [1.12, 0.98, 0.74],
    },
    disks: [
      {
        id: 'd1',
        name: 'parity',
        device: 'nvme0n1',
        role: 'parity',
        model: 'Samsung 990 PRO',
        sizeBytes: 4e12,
        usedBytes: 1e12,
        tempC: 41,
        smartStatus: 'PASSED',
        spinState: 'active',
        readMBps: 12,
        writeMBps: 4,
        errors: 0,
      },
      {
        id: 'd2',
        name: 'disk1',
        device: 'sda',
        role: 'data',
        model: 'WDC WD80EFZZ',
        sizeBytes: 8e12,
        usedBytes: 4e12,
        tempC: 36,
        smartStatus: 'PASSED',
        spinState: 'active',
        readMBps: 20,
        writeMBps: 8,
        errors: 0,
      },
    ],
    array: {
      state: 'STARTED',
      parityValid: true,
      parityCheckRunning: false,
      parityProgressPercent: 0,
      usedBytes: 12e12,
      totalBytes: 24e12,
      freeBytes: 12e12,
      moverRunning: false,
    },
    zfsPools: [],
    shares: [],
    containers: [],
    vms: [],
    tasks: [],
    sessions: [],
    ups: {
      connected: true,
      model: 'APC Smart-UPS',
      status: 'ONLINE',
      batteryPercent: 100,
      loadPercent: 18,
      runtimeMinutes: 45,
      inputVoltage: 120,
      nominalPowerW: 900,
      currentPowerW: 112,
    },
    fans: [],
    temps: [],
    network: [],
    gpus: [],
    history: {
      timestamps: ['00:01', '00:02', '00:03'],
      cpuSeries: [20, 35, 42],
      ramSeries: [24, 25, 25],
      netRxSeries: [10, 18, 24.5],
      netTxSeries: [4, 6, 8.2],
    },
  };
}

test('server-side resvg renderer produces exact 960x376 RGBA buffers and valid PNG across all orientations', () => {
  const telemetry = makeSampleTelemetry();
  const exposed = buildExposedEntities(telemetry, [], [], {});
  const screen = DEFAULT_CONFIG.screens[0];
  const expectedRgbaLen = DISPLAY_WIDTH * DISPLAY_HEIGHT * 4;

  for (const rotation of [0, 90, 180, 270] as const) {
    const rgba = renderScreenToRgbaBuffer({
      screen,
      telemetry,
      haEntities: [],
      exposedEntities: exposed,
      rotation,
      brightnessPercent: 100,
    });
    assert.equal(rgba.length, expectedRgbaLen, `Rotation ${rotation} must yield 1,443,840 RGBA bytes`);
  }

  const png = renderScreenToPngBuffer({
    screen,
    telemetry,
    haEntities: [],
    exposedEntities: exposed,
    rotation: 0,
    brightnessPercent: 85,
  });

  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  assert.equal(png.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(png.readUInt32BE(16), DISPLAY_WIDTH);
  assert.equal(png.readUInt32BE(20), DISPLAY_HEIGHT);
});

test('server-side renderer scales brightness, supports blank mode, and handles unbound entities', () => {
  const telemetry = makeSampleTelemetry();
  const screen = {
    ...DEFAULT_CONFIG.screens[0],
    backgroundType: 'solid' as const,
    backgroundColor: '#FFFFFF',
    widgets: [
      {
        id: 'w-unbound',
        type: 'entity_number' as const,
        x: 20,
        y: 20,
        w: 220,
        h: 100,
        title: 'Missing Sensor',
        accentColor: '#FFFFFF',
        textColor: '#FFFFFF',
        bgColor: '#FFFFFF',
        bgOpacity: 1,
        borderOpacity: 0,
        fontScale: 1,
        entityId: 'nonexistent.metric',
      },
    ],
  };

  const blank = renderScreenToRgbaBuffer({
    screen,
    telemetry,
    haEntities: [],
    exposedEntities: [],
    blank: true,
  });
  assert.equal(blank.length, DISPLAY_WIDTH * DISPLAY_HEIGHT * 4);
  assert.equal(blank[0], 0);
  assert.equal(blank[1], 0);
  assert.equal(blank[2], 0);
  assert.equal(blank[3], 255);

  const zeroBright = renderScreenToRgbaBuffer({
    screen,
    telemetry,
    haEntities: [],
    exposedEntities: [],
    brightnessPercent: 0,
  });
  assert.equal(zeroBright[0], 0);
  assert.equal(zeroBright[1], 0);
  assert.equal(zeroBright[2], 0);

  const halfBright = renderScreenToRgbaBuffer({
    screen,
    telemetry,
    haEntities: [],
    exposedEntities: [],
    brightnessPercent: 50,
  });
  const fullBright = renderScreenToRgbaBuffer({
    screen,
    telemetry,
    haEntities: [],
    exposedEntities: [],
    brightnessPercent: 100,
  });
  assert.ok(halfBright[0] < fullBright[0], '50% brightness should scale pixel luminance down');
});
