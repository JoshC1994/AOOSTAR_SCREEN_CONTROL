import type {HardwareDeployState, LastFrameMeta, LcdScreen, StudioConfig} from '../types.ts';
import {detectAsterctlBinary, getAsterctlStatus} from './aoostar/asterctl.ts';
import {
  activateEmergencyStop,
  deployScreensWithAsterctl,
  isEmergencyStopped,
  isSerialWritesEnvEnabled,
  pushHardwareFrame,
  stopAsterctlProcess,
  writeAsterctlSensorSnapshot,
} from './hardware.ts';
import {renderScreenToRgbaBuffer} from './frameRenderer.ts';
import {
  buildExposedEntities,
  fetchHomeAssistantEntities,
  pollCustomConnections,
  resolveTelemetry,
} from './telemetry.ts';

let timerHandle: NodeJS.Timeout | null = null;
let lastRotationSwitchMs = Date.now();
let isTickRunning = false;
let sessionPushArmed = false;

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
}

export async function runHardwareDaemonTick(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void,
  overrideRgbaBase64?: string,
  options?: {restartAsterctlDaemon?: boolean}
): Promise<LastFrameMeta | null> {
  if (!isSerialWritesEnvEnabled()) {
    throw new Error(
      'Serial writes are disabled (AOOSTAR_ENABLE_SERIAL_WRITES=false). Use Dry Run on Diagnostics first, then set AOOSTAR_ENABLE_SERIAL_WRITES=true to write to hardware.'
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

  const nowMs = Date.now();
  let idx = Math.max(0, Math.min(playlist.length - 1, runtimeState.activeIndex));
  const current = playlist[idx];

  if (!overrideRgbaBase64 && playlist.length > 1 && nowMs - lastRotationSwitchMs >= current.durationSec * 1000) {
    idx = (idx + 1) % playlist.length;
    lastRotationSwitchMs = nowMs;
  }

  const activeScreen = playlist[idx];
  const sleeping = isWithinSleepWindow(
    cfg.hardware.sleepScheduleEnabled,
    cfg.hardware.sleepStart,
    cfg.hardware.sleepEnd
  );
  const effectiveBrightness = sleeping
    ? cfg.hardware.sleepMode === 'dim'
      ? cfg.hardware.sleepDimPercent ?? 5
      : 0
    : cfg.hardware.brightness;
  const blankSleep = sleeping && (cfg.hardware.sleepMode ?? 'off') === 'off';

  const {sourceMode, agentEnabled, agentUrl, agentToken, haEnabled, haUrl, haToken, customConnections} =
    cfg.integrations;
  const [haRes, polledCustom] = await Promise.all([
    fetchHomeAssistantEntities(haEnabled, haUrl, haToken),
    pollCustomConnections(customConnections),
  ]);
  const snapshot = await resolveTelemetry(
    sourceMode,
    agentEnabled,
    agentUrl,
    agentToken,
    haRes.connected
  );
  const exposedEntities = buildExposedEntities(
    snapshot,
    haRes.entities,
    polledCustom,
    cfg.entityOverrides
  );

  const asterctlBin = detectAsterctlBinary();

  // If Path A (asterctl) is available and sleeping off -> power off display cleanly
  if (blankSleep) {
    const meta = await pushHardwareFrame({
      rgbaBase64: overrideRgbaBase64,
      screenId: activeScreen.id,
      screenName: activeScreen.name,
      devicePath: cfg.hardware.devicePath,
      powerOff: true,
    });
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
    });
    return meta;
  }

  // If asterctl daemon is requested on config deploy OR running in Path A mode
  if (asterctlBin.available && options?.restartAsterctlDaemon && !overrideRgbaBase64) {
    const screensWithBuffers = playlist.map((scr) => ({
      screen: scr,
      rgbaBuffer: renderScreenToRgbaBuffer({
        screen: scr,
        telemetry: snapshot,
        haEntities: haRes.entities,
        exposedEntities,
        rotation: cfg.hardware.rotation,
        blank: false,
      }),
    }));
    await deployScreensWithAsterctl({
      screensWithBuffers,
      telemetry: snapshot,
      exposedEntities,
      devicePath: cfg.hardware.devicePath,
    });
  } else if (asterctlBin.available && getAsterctlStatus().running && !overrideRgbaBase64) {
    // Keep asterctl values.txt fed cleanly while asterctl daemon handles display streaming
    writeAsterctlSensorSnapshot(snapshot, exposedEntities);
  } else {
    const rgbaBuffer = overrideRgbaBase64
      ? Buffer.from(overrideRgbaBase64, 'base64')
      : renderScreenToRgbaBuffer({
          screen: activeScreen,
          telemetry: snapshot,
          haEntities: haRes.entities,
          exposedEntities,
          rotation: cfg.hardware.rotation,
          blank: false,
        });

    await pushHardwareFrame({
      rgbaBuffer,
      screenId: activeScreen.id,
      screenName: activeScreen.name,
      devicePath: cfg.hardware.devicePath,
      powerOff: false,
    });
  }

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
  });

  const {getLastFrameMeta} = await import('./hardware.ts');
  return getLastFrameMeta();
}

export function startHardwareDaemon(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
) {
  if (timerHandle) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }

  runtimeState.running = true;
  lastRotationSwitchMs = Date.now();
  runtimeState.activeIndex = getConfig().hardwareDeploy?.activeIndex ?? 0;

  // CRITICAL SERIAL SAFETY: Never push frames automatically on app startup.
  // Serial writes remain disarmed until user explicitly triggers/enables them and AOOSTAR_ENABLE_SERIAL_WRITES=true.
  sessionPushArmed = false;
  runtimeState.sessionPushArmed = false;

  const scheduleNext = () => {
    const intervalMs = Math.max(1000, (getConfig().hardware.pushIntervalSec || 2) * 1000);
    timerHandle = setTimeout(async () => {
      const cfg = getConfig();
      if (
        sessionPushArmed &&
        isSerialWritesEnvEnabled() &&
        !isEmergencyStopped() &&
        cfg.hardwareDeploy?.deployed === true &&
        cfg.hardware.autoPushEnabled === true &&
        !isTickRunning
      ) {
        isTickRunning = true;
        try {
          await runHardwareDaemonTick(getConfig, onConfigPatch);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[aoostar-daemon] Background push failed, disarming auto-push: ${msg}`);
          sessionPushArmed = false;
          runtimeState.sessionPushArmed = false;
        } finally {
          isTickRunning = false;
        }
      }
      scheduleNext();
    }, intervalMs);
  };

  scheduleNext();
}

export async function emergencyStopDaemon() {
  sessionPushArmed = false;
  runtimeState.sessionPushArmed = false;
  activateEmergencyStop('Emergency stop pressed: stopped serial writes and asterctl process');
  await stopAsterctlProcess();
}

export function resetDaemonRotation(index = 0) {
  runtimeState.activeIndex = index;
  lastRotationSwitchMs = Date.now();
}

export function getDaemonStatus(): DaemonRuntimeState {
  return {...runtimeState};
}
