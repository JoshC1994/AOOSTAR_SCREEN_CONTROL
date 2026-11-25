import type {
  DaemonLifecycleState,
  HardwareDeployState,
  LastFrameMeta,
  LcdScreen,
  StudioConfig,
} from '../types.ts';
import {
  runSafeDisplayOnOverSerialAsync,
  sendDisplayOffOverSerialAsync,
} from './aoostar/serial.ts';
import {
  activateEmergencyStop,
  closeActiveSerialTransportAsync,
  getLastFrameMeta,
  isEmergencyStopped,
  isSerialWritesActive,
  pushHardwareFrame,
  resetFrameDiffCache,
  setLastFrameMeta,
  stopAsterctlProcess,
} from './hardware.ts';
import {renderScreenToRgbaBuffer} from './frameRenderer.ts';
import {
  buildExposedEntities,
  getCachedOrRefreshIntegrations,
  resolveTelemetry,
} from './telemetry.ts';

let timerHandle: NodeJS.Timeout | null = null;
let lastRotationSwitchMs = Date.now();
let isTickRunning = false;
let sessionPushArmed = false;
let consecutiveErrors = 0;
let prevSleepBlank = false;
let prevArrayStopped = false;
let prevEffectiveBrightness: number | null = null;
let shuttingDown = false;

const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

function parseHhMm(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map((n) => Number(n) || 0);
  return h * 60 + m;
}

export function isWithinSleepWindow(enabled: boolean, start: string, end: string, now = new Date()): boolean {
  if (!enabled) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const s = parseHhMm(start);
  const e = parseHhMm(end);
  if (s === e) return false;
  if (s < e) return mins >= s && mins < e;
  return mins >= s || mins < e;
}

export interface DaemonRuntimeState {
  running: boolean;
  sessionPushArmed: boolean;
  daemonState: DaemonLifecycleState;
  lastError: string | null;
  consecutiveErrors: number;
  lastTickAt: string | null;
  activeIndex: number;
  currentScreenId: string | null;
  currentScreenName: string | null;
  isSleeping: boolean;
  effectiveBrightness: number;
  deployedScreensCount: number;
}

const runtimeState: DaemonRuntimeState = {
  running: false,
  sessionPushArmed: false,
  daemonState: 'idle',
  lastError: null,
  consecutiveErrors: 0,
  lastTickAt: null,
  activeIndex: 0,
  currentScreenId: null,
  currentScreenName: null,
  isSleeping: false,
  effectiveBrightness: 85,
  deployedScreensCount: 0,
};

export function isSessionPushArmed(): boolean {
  return sessionPushArmed;
}

export function armSessionPush(armed: boolean) {
  sessionPushArmed = armed;
  runtimeState.sessionPushArmed = armed;
  if (!armed && runtimeState.daemonState === 'active') {
    runtimeState.daemonState = 'idle';
  }
}

export function resetDaemonBackoff() {
  consecutiveErrors = 0;
  runtimeState.consecutiveErrors = 0;
  runtimeState.lastError = null;
}

export async function runHardwareDaemonTick(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void,
  overrideRgbaBase64?: string,
  options?: {forceFullRefresh?: boolean; skipPowerSleepEdge?: boolean; now?: Date}
): Promise<LastFrameMeta | null> {
  if (!isSerialWritesActive()) {
    throw new Error(
      'Serial writes are disabled by safety policy. Validate packets via Dry Run first, then set AOOSTAR_ENABLE_SERIAL_WRITES=true or unlock serial writes in Settings.'
    );
  }
  if (isEmergencyStopped()) {
    throw new Error('Emergency stop is active. Clear Emergency Stop on Diagnostics before pushing.');
  }

  const cfg = getConfig();
  const playlist: LcdScreen[] = cfg.screens.filter((s) => s.enabled);

  if (playlist.length === 0) {
    runtimeState.deployedScreensCount = 0;
    runtimeState.currentScreenId = null;
    runtimeState.currentScreenName = null;
    onConfigPatch?.({
      activeIndex: 0,
      currentScreenId: null,
      currentScreenName: null,
    });
    return null;
  }

  const nowMs = options?.now ? options.now.getTime() : Date.now();
  let idx = Math.max(0, Math.min(playlist.length - 1, runtimeState.activeIndex));
  const current = playlist[idx];

  let screenChanged = false;
  if (!overrideRgbaBase64 && playlist.length > 1 && nowMs - lastRotationSwitchMs >= current.durationSec * 1000) {
    idx = (idx + 1) % playlist.length;
    lastRotationSwitchMs = nowMs;
    screenChanged = true;
  }

  const activeScreen = playlist[idx];
  const sleeping = isWithinSleepWindow(
    cfg.hardware.sleepScheduleEnabled,
    cfg.hardware.sleepStart,
    cfg.hardware.sleepEnd,
    options?.now
  );
  const effectiveBrightness = sleeping
    ? cfg.hardware.sleepMode === 'dim'
      ? cfg.hardware.sleepDimPercent ?? 5
      : 0
    : cfg.hardware.brightness;
  const blankSleep = sleeping && (cfg.hardware.sleepMode ?? 'off') === 'off';

  const integ = await getCachedOrRefreshIntegrations(cfg);
  const {sourceMode, agentEnabled, agentUrl, agentToken} = cfg.integrations;
  const snapshot = await resolveTelemetry(
    sourceMode,
    agentEnabled,
    agentUrl,
    agentToken,
    integ.haConnected
  );
  const exposedEntities = buildExposedEntities(
    snapshot,
    integ.haEntities,
    integ.customConnections,
    cfg.entityOverrides
  );

  // Edge-triggered sleep window blanking (send DISPLAY_OFF once on entering sleep, DISPLAY_ON on waking)
  if (!overrideRgbaBase64 && !options?.skipPowerSleepEdge) {
    if (blankSleep) {
      if (!prevSleepBlank) {
        const offMeta = await pushHardwareFrame({
          screenId: activeScreen.id,
          screenName: activeScreen.name,
          devicePath: cfg.hardware.devicePath,
          powerOff: true,
        });
        prevSleepBlank = true;
        runtimeState.activeIndex = idx;
        runtimeState.lastTickAt = new Date().toISOString();
        runtimeState.currentScreenId = activeScreen.id;
        runtimeState.currentScreenName = activeScreen.name;
        runtimeState.isSleeping = true;
        runtimeState.effectiveBrightness = effectiveBrightness;
        runtimeState.deployedScreensCount = playlist.length;
        runtimeState.daemonState = 'sleeping';
        runtimeState.lastError = null;
        onConfigPatch?.({
          activeIndex: idx,
          currentScreenId: activeScreen.id,
          currentScreenName: activeScreen.name,
          isSleeping: true,
          effectiveBrightness,
          daemonState: 'sleeping',
          lastError: null,
        });
        return offMeta;
      }

      runtimeState.isSleeping = true;
      runtimeState.daemonState = 'sleeping';
      return getLastFrameMeta();
    }

    if (prevSleepBlank) {
      prevSleepBlank = false;
      resetFrameDiffCache();
      options = {...options, forceFullRefresh: true};
    }

    // Edge-triggered Unraid array STOPPED sleep handling
    const arrayStopped = snapshot.array.state === 'STOPPED';
    if (arrayStopped) {
      if (!prevArrayStopped) {
        const offMeta = await pushHardwareFrame({
          screenId: activeScreen.id,
          screenName: activeScreen.name,
          devicePath: cfg.hardware.devicePath,
          powerOff: true,
        });
        prevArrayStopped = true;
        runtimeState.daemonState = 'sleeping';
        runtimeState.lastTickAt = new Date().toISOString();
        onConfigPatch?.({
          isSleeping: true,
          daemonState: 'sleeping',
          lastError: null,
        });
        return offMeta;
      }
      runtimeState.daemonState = 'sleeping';
      return getLastFrameMeta();
    }

    if (prevArrayStopped) {
      prevArrayStopped = false;
      resetFrameDiffCache();
      options = {...options, forceFullRefresh: true};
    }
  }

  const brightnessChanged =
    prevEffectiveBrightness !== null && prevEffectiveBrightness !== effectiveBrightness;
  if (brightnessChanged) {
    resetFrameDiffCache();
  }

  const rgbaBuffer = overrideRgbaBase64
    ? Buffer.from(overrideRgbaBase64, 'base64')
    : renderScreenToRgbaBuffer({
        screen: activeScreen,
        telemetry: snapshot,
        haEntities: integ.haEntities,
        exposedEntities,
        dockerIcons: cfg.dockerIcons,
        rotation: cfg.hardware.rotation,
        brightnessPercent: effectiveBrightness,
        blank: false,
        now: options?.now,
      });

  const meta = await pushHardwareFrame({
    rgbaBuffer,
    screenId: activeScreen.id,
    screenName: activeScreen.name,
    devicePath: cfg.hardware.devicePath,
    brightnessPercent: overrideRgbaBase64 ? effectiveBrightness : 100, // already scaled when server-rendered
    brightnessKey: effectiveBrightness,
    forceFullRefresh: Boolean(options?.forceFullRefresh || screenChanged || brightnessChanged),
    powerOff: false,
  });
  prevEffectiveBrightness = effectiveBrightness;

  consecutiveErrors = 0;
  runtimeState.consecutiveErrors = 0;
  runtimeState.lastError = null;
  runtimeState.daemonState = 'active';
  runtimeState.activeIndex = idx;
  runtimeState.lastTickAt = new Date().toISOString();
  runtimeState.currentScreenId = activeScreen.id;
  runtimeState.currentScreenName = activeScreen.name;
  runtimeState.isSleeping = sleeping;
  runtimeState.effectiveBrightness = effectiveBrightness;
  runtimeState.deployedScreensCount = playlist.length;

  onConfigPatch?.({
    activeIndex: idx,
    currentScreenId: activeScreen.id,
    currentScreenName: activeScreen.name,
    isSleeping: sleeping,
    effectiveBrightness,
    daemonState: 'active',
    lastError: null,
  });

  return meta;
}

export function startHardwareDaemon(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
) {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }

  shuttingDown = false;
  runtimeState.running = true;
  lastRotationSwitchMs = Date.now();
  const initialCfg = getConfig();
  runtimeState.activeIndex = initialCfg.hardwareDeploy?.activeIndex ?? 0;

  if (initialCfg.hardware.bootDisplayOff && isSerialWritesActive() && !isEmergencyStopped()) {
    sessionPushArmed = false;
    runtimeState.sessionPushArmed = false;
    runtimeState.daemonState = 'stopped';
    void sendDisplayOffOverSerialAsync(initialCfg.hardware.devicePath).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[aoostar-daemon] bootDisplayOff skipped or failed: ${msg}`);
    });
  } else if (
    initialCfg.hardwareDeploy?.deployed === true &&
    initialCfg.hardware.autoPushEnabled === true &&
    isSerialWritesActive() &&
    !isEmergencyStopped()
  ) {
    sessionPushArmed = true;
    runtimeState.sessionPushArmed = true;
    runtimeState.daemonState = 'active';
    resetFrameDiffCache();
    console.log('[aoostar-daemon] Resuming previously deployed LCD playlist on startup');
  } else {
    sessionPushArmed = false;
    runtimeState.sessionPushArmed = false;
    runtimeState.daemonState = 'idle';
  }

  const scheduleNext = () => {
    if (shuttingDown) return;
    const baseMs = Math.max(1000, (getConfig().hardware.pushIntervalSec || 2) * 1000);
    const delayMs =
      consecutiveErrors > 0
        ? Math.max(
            baseMs,
            BACKOFF_STEPS_MS[Math.min(BACKOFF_STEPS_MS.length - 1, consecutiveErrors - 1)]
          )
        : baseMs;

    timerHandle = setTimeout(async () => {
      if (shuttingDown) return;
      const cfg = getConfig();
      if (
        sessionPushArmed &&
        isSerialWritesActive() &&
        !isEmergencyStopped() &&
        cfg.hardwareDeploy?.deployed === true &&
        cfg.hardware.autoPushEnabled === true &&
        !isTickRunning
      ) {
        isTickRunning = true;
        try {
          await runHardwareDaemonTick(getConfig, onConfigPatch);
        } catch (err) {
          consecutiveErrors += 1;
          const msg = err instanceof Error ? err.message : String(err);
          runtimeState.consecutiveErrors = consecutiveErrors;
          runtimeState.lastError = msg;
          runtimeState.daemonState = 'retrying';
          onConfigPatch?.({
            daemonState: 'retrying',
            lastError: msg,
          });
          console.error(
            `[aoostar-daemon] Serial push failed (attempt ${consecutiveErrors}, retrying with backoff): ${msg}`
          );
        } finally {
          isTickRunning = false;
        }
      }
      scheduleNext();
    }, delayMs);
    timerHandle.unref?.();
  };

  scheduleNext();
}

export async function turnDisplayOnManual(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
): Promise<LastFrameMeta> {
  const cfg = getConfig();
  await runSafeDisplayOnOverSerialAsync(cfg.hardware.devicePath);
  prevSleepBlank = false;
  prevArrayStopped = false;
  resetFrameDiffCache();
  resetDaemonBackoff();

  const meta = await runHardwareDaemonTick(getConfig, onConfigPatch, undefined, {
    forceFullRefresh: true,
    skipPowerSleepEdge: true,
  });
  return meta ?? getLastFrameMeta();
}

export async function turnDisplayOffManual(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
): Promise<LastFrameMeta> {
  const cfg = getConfig();
  armSessionPush(false);
  const offRes = await sendDisplayOffOverSerialAsync(cfg.hardware.devicePath);
  runtimeState.daemonState = 'stopped';
  runtimeState.lastTickAt = new Date().toISOString();
  const prev = getLastFrameMeta();
  const meta: LastFrameMeta = {
    ...prev,
    pushedAt: new Date().toISOString(),
    devicePath: offRes.devicePath,
    deliveryMode: 'usb-serial',
    chunksSent: 0,
    initAck: true,
    powerState: 'off',
    lastError: null,
  };
  setLastFrameMeta(meta);
  onConfigPatch?.({daemonState: 'stopped', lastError: null});
  return meta;
}

export async function forceFullRefreshNow(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
): Promise<LastFrameMeta | null> {
  resetFrameDiffCache();
  resetDaemonBackoff();
  return await runHardwareDaemonTick(getConfig, onConfigPatch, undefined, {
    forceFullRefresh: true,
    skipPowerSleepEdge: true,
  });
}

export async function emergencyStopDaemon(powerOffDisplay = false, devicePath?: string) {
  sessionPushArmed = false;
  runtimeState.sessionPushArmed = false;
  runtimeState.daemonState = 'stopped';

  if (powerOffDisplay && isSerialWritesActive() && !isEmergencyStopped()) {
    try {
      await sendDisplayOffOverSerialAsync(devicePath);
    } catch {
      // ignore hardware failure during emergency stop
    }
  }

  activateEmergencyStop('Emergency stop pressed: stopped serial writes and asterctl process');
  await closeActiveSerialTransportAsync();
  await stopAsterctlProcess();
}

export async function gracefulShutdownHardware(getConfig: () => StudioConfig): Promise<void> {
  shuttingDown = true;
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  runtimeState.running = false;
  armSessionPush(false);

  const waitStart = Date.now();
  while (isTickRunning && Date.now() - waitStart < 1500) {
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    const cfg = getConfig();
    if (isSerialWritesActive() && !isEmergencyStopped() && getLastFrameMeta().powerState === 'on') {
      await sendDisplayOffOverSerialAsync(cfg.hardware.devicePath);
    }
  } catch {
    // best-effort shutdown display blank
  }

  await closeActiveSerialTransportAsync();
  await stopAsterctlProcess();
}

export function resetDaemonRotation(index = 0, nowMs = Date.now()) {
  runtimeState.activeIndex = index;
  lastRotationSwitchMs = nowMs;
}

export function getDaemonStatus(): DaemonRuntimeState {
  return {...runtimeState};
}
