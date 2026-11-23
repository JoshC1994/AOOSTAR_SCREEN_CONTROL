import type {HardwareDeployState, LastFrameMeta, LcdScreen, StudioConfig} from '../types.ts';
import {renderScreenToRgbaBuffer} from './frameRenderer.ts';
import {encodeAndPushRgb565Frame} from './hardware.ts';
import {
  buildExposedEntities,
  fetchHomeAssistantEntities,
  pollCustomConnections,
  resolveTelemetry,
} from './telemetry.ts';

let timerHandle: NodeJS.Timeout | null = null;
let lastRotationSwitchMs = Date.now();
let isTickRunning = false;

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
  lastTickAt: null,
  activeIndex: 0,
  currentScreenId: null,
  currentScreenName: null,
  isSleeping: false,
  effectiveBrightness: 85,
  deployedScreensCount: 0,
};

export async function runHardwareDaemonTick(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void,
  overrideRgbaBase64?: string,
  forceFull = false
): Promise<LastFrameMeta | null> {
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

  let rgbaBase64 = overrideRgbaBase64;
  if (!rgbaBase64) {
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
    const buf = renderScreenToRgbaBuffer({
      screen: activeScreen,
      telemetry: snapshot,
      haEntities: haRes.entities,
      exposedEntities,
      rotation: cfg.hardware.rotation,
      blank: sleeping && (cfg.hardware.sleepMode ?? 'off') === 'off',
    });
    rgbaBase64 = buf.toString('base64');
  }

  const meta = encodeAndPushRgb565Frame({
    rgbaBase64,
    screenId: activeScreen.id,
    screenName: activeScreen.name,
    devicePath: cfg.hardware.devicePath,
    brightness: effectiveBrightness,
    forceFull,
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

export function startHardwareDaemon(
  getConfig: () => StudioConfig,
  onConfigPatch?: (patch: Partial<HardwareDeployState>) => void
) {
  if (timerHandle) {
    clearInterval(timerHandle);
    timerHandle = null;
  }

  runtimeState.running = true;
  lastRotationSwitchMs = Date.now();
  runtimeState.activeIndex = getConfig().hardwareDeploy?.activeIndex ?? 0;

  // Immediate boot push so hardware lights up right after server/Unraid startup
  void runHardwareDaemonTick(getConfig, onConfigPatch);

  const scheduleNext = () => {
    const intervalMs = Math.max(1000, (getConfig().hardware.pushIntervalSec || 2) * 1000);
    timerHandle = setTimeout(async () => {
      const cfg = getConfig();
      if (cfg.hardwareDeploy?.deployed !== false && cfg.hardware.autoPushEnabled !== false && !isTickRunning) {
        isTickRunning = true;
        try {
          await runHardwareDaemonTick(getConfig, onConfigPatch);
        } finally {
          isTickRunning = false;
        }
      }
      scheduleNext();
    }, intervalMs);
  };

  scheduleNext();
}

export function resetDaemonRotation(index = 0) {
  runtimeState.activeIndex = index;
  lastRotationSwitchMs = Date.now();
}

export function getDaemonStatus(): DaemonRuntimeState {
  return {...runtimeState};
}
