import {useCallback, useEffect, useRef, useState} from 'react';
import {ConnectionsView} from './components/ConnectionsView.tsx';
import {ExposedEntitiesView} from './components/ExposedEntitiesView.tsx';
import {InfoView} from './components/InfoView.tsx';
import {QuickGuideModal} from './components/QuickGuideModal.tsx';
import {SavedScreensView} from './components/SavedScreensView.tsx';
import {ScreenStudioView} from './components/ScreenStudioView.tsx';
import {SettingsView} from './components/SettingsView.tsx';
import {DEFAULT_CONFIG} from './presets.ts';
import type {
  ExposedEntity,
  HardwareDeployState,
  HomeAssistantEntity,
  LastFrameMeta,
  LcdScreen,
  StudioConfig,
  TelemetrySnapshot,
  UiThemePreference,
} from './types.ts';
import {rasterizeScreenToRgbaBase64} from './utils/lcdRasterizer.ts';
import {isScreenUnsaved, screenSignature, upsertSavedScreen} from './utils/screenSave.ts';

type ActiveTab = 'screens' | 'saved' | 'entities' | 'connections' | 'settings' | 'info';

const NAV_TABS: Array<{id: ActiveTab; label: string}> = [
  {id: 'screens', label: 'Screens'},
  {id: 'saved', label: 'Saved Screens'},
  {id: 'entities', label: 'Entities'},
  {id: 'connections', label: 'Connections'},
  {id: 'settings', label: 'Settings'},
  {id: 'info', label: 'Info'},
];

interface TelemetryApiResponse {
  snapshot: TelemetrySnapshot;
  haConnected: boolean;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('screens');
  const [uiTheme, setUiTheme] = useState<UiThemePreference>(() => {
    try {
      const saved = window.localStorage.getItem('aoostar_studio_ui_theme');
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore storage read error
    }
    return 'dark';
  });
  const [config, setConfig] = useState<StudioConfig>(DEFAULT_CONFIG);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [haEntities, setHaEntities] = useState<HomeAssistantEntity[]>([]);
  const [exposedEntities, setExposedEntities] = useState<ExposedEntity[]>([]);
  const [haConnected, setHaConnected] = useState(false);
  const [lastFrame, setLastFrame] = useState<LastFrameMeta | null>(null);
  const [pushing, setPushing] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ok: boolean; text: string} | null>(null);
  const [dismissedSignatures, setDismissedSignatures] = useState<Record<string, string>>({});
  const [pendingSavePrompt, setPendingSavePrompt] = useState<
    | {kind: 'tab'; nextTab: ActiveTab; screens: LcdScreen[]}
    | {kind: 'push'; screens: LcdScreen[]}
    | null
  >(null);
  const [promptName, setPromptName] = useState('');
  const [showGuide, setShowGuide] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('aoostar_studio_guide_seen') !== '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const isDark = uiTheme === 'dark' || (uiTheme === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', isDark);
      document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    };
    applyTheme();
    try {
      window.localStorage.setItem('aoostar_studio_ui_theme', uiTheme);
    } catch {
      // ignore storage write error
    }
    if (uiTheme === 'system') {
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    }
  }, [uiTheme]);

  const handleCloseGuide = () => {
    setShowGuide(false);
    try {
      window.localStorage.setItem('aoostar_studio_guide_seen', '1');
    } catch {
      // ignore storage errors
    }
  };

  const saveTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((data: StudioConfig) => {
        setConfig(data);
        setConfigLoaded(true);
      })
      .catch(() => {
        setConfigLoaded(true);
      });
  }, []);

  const refreshTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/telemetry');
      if (res.ok) {
        const data = (await res.json()) as Partial<TelemetryApiResponse>;
        if (data?.snapshot && data.snapshot.system && data.snapshot.array) {
          setTelemetry(data.snapshot);
        }
        if (typeof data?.haConnected === 'boolean') setHaConnected(data.haConnected);
        if (Array.isArray(data?.haEntities)) setHaEntities(data.haEntities);
        if (Array.isArray(data?.exposedEntities)) setExposedEntities(data.exposedEntities);
      }
    } catch {
      // keep previous snapshot
    }
  }, []);

  useEffect(() => {
    if (!configLoaded) return;
    void refreshTelemetry();
    const intervalMs = Math.max(1000, config.hardware.pollIntervalMs ?? 2500);
    const id = window.setInterval(() => {
      void refreshTelemetry();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [configLoaded, config.hardware.pollIntervalMs, refreshTelemetry]);

  const handleUpdateConfig = useCallback((updater: (prev: StudioConfig) => StudioConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      if (saveTimeoutRef.current) window.clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = window.setTimeout(() => {
        void fetch('/api/config', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(next),
        });
      }, 250);
      return next;
    });
  }, []);

  const handlePushScreen = useCallback(
    async (targetScreen?: LcdScreen, overrideScreens?: LcdScreen[]) => {
      const sourceScreens = overrideScreens ?? config.screens;
      const enabledScreens = sourceScreens.filter((s) => s.enabled);
      if (enabledScreens.length === 0 && !targetScreen) {
        setPushFeedback({ok: false, text: 'All screens are paused — activate a screen first'});
        window.setTimeout(() => setPushFeedback(null), 3600);
        return;
      }

      const scr =
        targetScreen ??
        enabledScreens.find((s) => s.id === config.activeScreenId) ??
        enabledScreens[0];
      if (!scr) return;

      const deployList = enabledScreens.length > 0 ? enabledScreens : [scr];

      setPushing(true);
      try {
        const rgbaBase64 = await rasterizeScreenToRgbaBase64(
          scr,
          telemetry,
          haEntities,
          exposedEntities,
          config.dockerIcons,
          config.hardware.rotation
        );
        const res = await fetch('/api/hardware/deploy', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            screens: deployList,
            activeScreenId: scr.id,
            rgbaBase64,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            meta: LastFrameMeta;
            hardwareDeploy: HardwareDeployState;
          };
          setLastFrame(data.meta);
          setConfig((prev) => ({
            ...prev,
            hardwareDeploy: data.hardwareDeploy,
          }));
          if (data.meta.lastError) {
            setPushFeedback({
              ok: false,
              text: data.meta.lastError,
            });
          } else if (data.meta.deliveryMode === 'usb-serial') {
            setPushFeedback({
              ok: true,
              text: `Pushed ${data.meta.chunksSent}/${data.meta.totalChunks} chunks to ${data.meta.devicePath}`,
            });
          } else {
            setPushFeedback({
              ok: true,
              text: `Deployed ${deployList.length} screen${deployList.length > 1 ? 's' : ''} (buffer updated)`,
            });
          }
          window.setTimeout(() => setPushFeedback(null), 4800);
        } else {
          setPushFeedback({ok: false, text: `Push failed (HTTP ${res.status})`});
          window.setTimeout(() => setPushFeedback(null), 4200);
        }
      } catch {
        setPushFeedback({ok: false, text: 'Push request failed'});
        window.setTimeout(() => setPushFeedback(null), 4200);
      } finally {
        setPushing(false);
      }
    },
    [
      config.screens,
      config.activeScreenId,
      config.dockerIcons,
      config.hardware.rotation,
      telemetry,
      haEntities,
      exposedEntities,
    ]
  );

  const getUnsavedScreens = useCallback(() => {
    const unsaved = config.screens.filter(
      (s) =>
        isScreenUnsaved(s, config.savedScreens ?? []) &&
        dismissedSignatures[s.id] !== screenSignature(s)
    );
    unsaved.sort((a, b) =>
      a.id === config.activeScreenId ? -1 : b.id === config.activeScreenId ? 1 : 0
    );
    return unsaved;
  }, [config.screens, config.savedScreens, config.activeScreenId, dismissedSignatures]);

  const handleSelectTab = (nextTab: ActiveTab) => {
    if (activeTab === 'screens' && nextTab !== 'screens') {
      const unsaved = getUnsavedScreens();
      if (unsaved.length > 0) {
        setPromptName(unsaved[0].name);
        setPendingSavePrompt({kind: 'tab', nextTab, screens: unsaved});
        return;
      }
    }
    setActiveTab(nextTab);
  };

  const handlePushButtonClick = () => {
    const enabledScreens = config.screens.filter((s) => s.enabled);
    if (enabledScreens.length === 0) {
      setPushFeedback({ok: false, text: 'All screens are paused — activate a screen first'});
      window.setTimeout(() => setPushFeedback(null), 3200);
      return;
    }
    const unsaved = getUnsavedScreens();
    if (unsaved.length > 0) {
      setPromptName(unsaved[0].name);
      setPendingSavePrompt({kind: 'push', screens: unsaved});
      return;
    }
    void handlePushScreen();
  };

  const handleConfirmSaveAndContinue = () => {
    if (!pendingSavePrompt) return;
    const primary = pendingSavePrompt.screens[0];
    const renamedPrimary = promptName.trim() || primary.name;

    let nextSaved = [...(config.savedScreens ?? [])];
    const renamedMap = new Map<string, string>();
    for (const scr of pendingSavePrompt.screens) {
      const targetName = scr.id === primary.id ? renamedPrimary : scr.name;
      const res = upsertSavedScreen(nextSaved, scr, targetName);
      nextSaved = res.nextSavedScreens;
      renamedMap.set(scr.id, res.nextScreenName);
    }

    const nextScreens = config.screens.map((s) => {
      const newName = renamedMap.get(s.id);
      return newName ? {...s, name: newName} : s;
    });

    handleUpdateConfig((prev) => ({
      ...prev,
      savedScreens: nextSaved,
      screens: nextScreens,
    }));

    const action = pendingSavePrompt;
    setPendingSavePrompt(null);

    if (action.kind === 'tab') {
      setActiveTab(action.nextTab);
    } else {
      const enabled = nextScreens.filter((s) => s.enabled);
      const target = enabled.find((s) => s.id === config.activeScreenId) ?? enabled[0];
      void handlePushScreen(target, nextScreens);
    }
  };

  const handleContinueWithoutSaving = () => {
    if (!pendingSavePrompt) return;
    const nextDismissed: Record<string, string> = {...dismissedSignatures};
    for (const scr of pendingSavePrompt.screens) {
      nextDismissed[scr.id] = screenSignature(scr);
    }
    setDismissedSignatures(nextDismissed);

    const action = pendingSavePrompt;
    setPendingSavePrompt(null);

    if (action.kind === 'tab') {
      setActiveTab(action.nextTab);
    } else {
      void handlePushScreen();
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 dark:bg-[#0B0E14] dark:text-[#E6EDF3] flex flex-col transition-colors">
      {/* 3-Zone Top Bar */}
      <header className="h-[57px] border-b border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] px-6 flex items-center justify-between gap-6 shrink-0">
        <button
          onClick={() => handleSelectTab('screens')}
          className="text-base font-display font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 text-left"
        >
          Aoostar Display Studio
        </button>

        <nav className="hidden md:flex items-center gap-5 text-[13px] font-medium">
          {NAV_TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => handleSelectTab(tab.id)}
                className={`py-4 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                    : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {pushFeedback && (
            <span
              className={`hidden xl:inline text-xs font-mono whitespace-nowrap max-w-[340px] truncate ${
                pushFeedback.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
              title={pushFeedback.text}
            >
              {pushFeedback.text}
            </span>
          )}
          <button
            data-guide="push-screen-btn"
            onClick={handlePushButtonClick}
            disabled={pushing}
            className="px-4 py-1.5 text-xs font-semibold rounded bg-amber-500 text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            {pushing ? 'Pushing...' : 'Push to Screen'}
          </button>
        </div>
      </header>

      {/* Mobile Nav */}
      <div className="flex md:hidden border-b border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] px-4 overflow-x-auto gap-4">
        {NAV_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleSelectTab(tab.id)}
            className={`py-2.5 text-xs font-medium border-b-2 whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'border-amber-500 text-slate-900 dark:text-slate-100'
                : 'border-transparent text-slate-500 dark:text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1">
        {activeTab === 'screens' && (
          <ScreenStudioView
            config={config}
            telemetry={telemetry}
            haEntities={haEntities}
            exposedEntities={exposedEntities}
            onUpdateConfig={handleUpdateConfig}
          />
        )}

        {activeTab === 'saved' && (
          <SavedScreensView
            config={config}
            onUpdateConfig={handleUpdateConfig}
            onNavigateToScreens={() => setActiveTab('screens')}
          />
        )}

        {activeTab === 'entities' && (
          <ExposedEntitiesView
            config={config}
            exposedEntities={exposedEntities}
            onUpdateConfig={handleUpdateConfig}
            onNavigateToScreens={() => setActiveTab('screens')}
          />
        )}

        {activeTab === 'connections' && (
          <ConnectionsView
            config={config}
            telemetry={telemetry}
            haConnected={haConnected}
            onUpdateConfig={handleUpdateConfig}
            onRefreshAll={refreshTelemetry}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            config={config}
            telemetry={telemetry}
            lastFrame={lastFrame}
            onUpdateConfig={handleUpdateConfig}
          />
        )}

        {activeTab === 'info' && (
          <InfoView
            onOpenGuide={() => setShowGuide(true)}
            uiTheme={uiTheme}
            onChangeUiTheme={setUiTheme}
          />
        )}
      </div>

      <QuickGuideModal
        open={showGuide}
        onClose={handleCloseGuide}
        onNavigateTab={(tab) => setActiveTab(tab)}
      />

      {/* Unsaved Screen Prompt (Tab Switch or Push to Screen) */}
      {pendingSavePrompt && (
        <div
          onClick={() => setPendingSavePrompt(null)}
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-6 space-y-4 shadow-2xl"
          >
            <div className="pb-3 border-b border-slate-200 dark:border-[#1F2937]">
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Save Unsaved Screen{pendingSavePrompt.screens.length > 1 ? 's' : ''}?
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                {pendingSavePrompt.kind === 'push'
                  ? 'You have unsaved screen changes. Save to your Saved Screens library before pushing to the hardware display?'
                  : 'You have unsaved screen changes on the Screens page. Save to your Saved Screens library before switching tabs?'}
              </p>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Saved Screen Name
              </label>
              <input
                type="text"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
              {pendingSavePrompt.screens.length > 1 && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
                  Also saving:{' '}
                  {pendingSavePrompt.screens
                    .slice(1)
                    .map((s) => s.name)
                    .join(', ')}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPendingSavePrompt(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleContinueWithoutSaving}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-50 dark:bg-[#121824] text-xs text-slate-800 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500"
              >
                {pendingSavePrompt.kind === 'push' ? 'Push Without Saving' : 'Continue Without Saving'}
              </button>
              <button
                onClick={handleConfirmSaveAndContinue}
                className="px-3.5 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                {pendingSavePrompt.kind === 'push' ? 'Save & Push to Screen' : 'Save & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
