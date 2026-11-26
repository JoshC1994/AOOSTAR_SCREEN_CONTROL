import {useEffect, useRef, useState} from 'react';
import {
  AlertTriangle,
  Clock,
  Container,
  Lock,
  Moon,
  Power,
  RefreshCw,
  Sun,
  Trash2,
  Unlock,
  Upload,
  Usb,
} from 'lucide-react';
import {PRESET_BACKGROUNDS} from '../presets.ts';
import type {AuthStatusResponse, DetectedUsbDevice, LastFrameMeta, StudioConfig, TelemetrySnapshot} from '../types.ts';
import {apiFetch} from '../utils/apiClient.ts';
import {SecuritySettingsPanel} from './SecuritySettingsPanel.tsx';

interface SettingsViewProps {
  config: StudioConfig;
  telemetry: TelemetrySnapshot | null;
  lastFrame: LastFrameMeta | null;
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  authStatus: AuthStatusResponse | null;
  onAuthStatusChanged: () => Promise<void> | void;
  onSignedOut: () => void;
  focusSecurityCounter?: number;
}

const POLL_OPTIONS = [
  {ms: 1000, label: '1.0s (Fast)'},
  {ms: 2500, label: '2.5s (Standard)'},
  {ms: 5000, label: '5.0s (Low CPU)'},
  {ms: 10000, label: '10.0s (Quiet)'},
];

const BRIGHTNESS_PRESETS = [
  {value: 20, label: 'Night 20%'},
  {value: 55, label: 'Desk 55%'},
  {value: 85, label: 'Day 85%'},
  {value: 100, label: 'Max 100%'},
];

const QUICK_SCREEN_SECONDS = [10, 15, 30, 60];

export function SettingsView({
  config,
  telemetry,
  lastFrame,
  onUpdateConfig,
  authStatus,
  onAuthStatusChanged,
  onSignedOut,
  focusSecurityCounter = 0,
}: SettingsViewProps) {
  const [devices, setDevices] = useState<DetectedUsbDevice[]>([]);
  const [frameMeta, setFrameMeta] = useState<LastFrameMeta | null>(lastFrame);
  const [serialWritesActive, setSerialWritesActive] = useState(false);
  const [serialWritesEnvLocked, setSerialWritesEnvLocked] = useState(false);
  const [hardwareActionMsg, setHardwareActionMsg] = useState<{ok: boolean; text: string} | null>(null);
  const [busyHwAction, setBusyHwAction] = useState(false);
  const [confirmUnlockWrites, setConfirmUnlockWrites] = useState(false);
  const [uploadingForDocker, setUploadingForDocker] = useState<string | null>(null);
  const [newContainerName, setNewContainerName] = useState('');
  const [highlightSecurity, setHighlightSecurity] = useState(false);
  const dockerFileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadTargetRef = useRef<string | null>(null);
  const securitySectionRef = useRef<HTMLDivElement | null>(null);

  const scanHardware = async () => {
    try {
      const [devRes, diagRes] = await Promise.all([
        apiFetch('/api/hardware/devices'),
        apiFetch('/api/diagnostics'),
      ]);
      if (devRes.ok) {
        const data = (await devRes.json()) as {devices: DetectedUsbDevice[]; lastFrame: LastFrameMeta};
        setDevices(data.devices);
        setFrameMeta(data.lastFrame);
      }
      if (diagRes.ok) {
        const d = (await diagRes.json()) as {
          serialWritesEnabled?: boolean;
          serialWritesEnvLocked?: boolean;
        };
        setSerialWritesActive(Boolean(d.serialWritesEnabled));
        setSerialWritesEnvLocked(Boolean(d.serialWritesEnvLocked));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void scanHardware();
  }, []);

  useEffect(() => {
    if (lastFrame) setFrameMeta(lastFrame);
  }, [lastFrame]);

  useEffect(() => {
    if (focusSecurityCounter <= 0) return;
    setHighlightSecurity(true);
    securitySectionRef.current?.scrollIntoView({behavior: 'smooth', block: 'start'});
    const timer = window.setTimeout(() => setHighlightSecurity(false), 3000);
    return () => window.clearTimeout(timer);
  }, [focusSecurityCounter]);

  const handleDisplayCommand = async (endpoint: '/api/display/on' | '/api/display/off' | '/api/hardware/force-refresh', label: string) => {
    setBusyHwAction(true);
    setHardwareActionMsg(null);
    try {
      const res = await apiFetch(endpoint, {method: 'POST'});
      const data = (await res.json().catch(() => ({}))) as {error?: string; message?: string};
      setHardwareActionMsg({
        ok: res.ok,
        text: res.ok ? data.message || `${label} succeeded.` : data.error || `${label} failed (HTTP ${res.status})`,
      });
      await scanHardware();
    } catch {
      setHardwareActionMsg({ok: false, text: `${label} request failed.`});
    } finally {
      setBusyHwAction(false);
    }
  };

  const handleToggleSerialWrites = async (enable: boolean) => {
    setBusyHwAction(true);
    setConfirmUnlockWrites(false);
    setHardwareActionMsg(null);
    try {
      const res = await apiFetch('/api/hardware/serial-writes', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({enabled: enable, confirmed: true}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        serialWritesEnabled?: boolean;
      };
      if (res.ok) {
        setSerialWritesActive(Boolean(data.serialWritesEnabled));
        onUpdateConfig((prev) => ({
          ...prev,
          hardware: {...prev.hardware, serialWritesEnabled: enable},
        }));
        setHardwareActionMsg({
          ok: true,
          text: enable ? 'Serial hardware writes unlocked.' : 'Serial hardware writes locked safely.',
        });
      } else {
        setHardwareActionMsg({ok: false, text: data.error || `Failed (HTTP ${res.status})`});
      }
    } finally {
      setBusyHwAction(false);
    }
  };

  const handleUploadDockerIcon = async (file: File, containerName: string) => {
    setUploadingForDocker(containerName);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });
      const res = await apiFetch('/api/uploads', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: `${containerName}-icon`, dataUrl}),
      });
      if (res.ok) {
        const record = (await res.json()) as {
          id: string;
          name: string;
          url: string;
          mediaType?: 'image' | 'video';
          createdAt: string;
        };
        onUpdateConfig((prev) => ({
          ...prev,
          customImages: [record, ...prev.customImages],
          dockerIcons: {
            ...prev.dockerIcons,
            [containerName]: record.url,
          },
        }));
      }
    } finally {
      setUploadingForDocker(null);
    }
  };

  const discoveredContainers = telemetry?.containers ?? [];
  const customOnlyNames = Object.keys(config.dockerIcons || {}).filter(
    (name) => !discoveredContainers.some((c) => c.name === name)
  );
  const imageChoices = [
    ...config.customImages.filter((m) => m.mediaType !== 'video'),
    ...PRESET_BACKGROUNDS,
  ];

  const applyDurationToAllScreens = (sec: number) => {
    onUpdateConfig((prev) => ({
      ...prev,
      screens: prev.screens.map((s) => ({...s, durationSec: sec})),
    }));
  };

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      <div className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 shadow-xs dark:shadow-none">
        <h1 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
          Display, Security &amp; Hardware Settings
        </h1>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Manage Studio login credentials, script API tokens, screen cycle times, brightness, sleep hours, and USB display target.
        </p>
      </div>

      {/* Security & Access */}
      <div ref={securitySectionRef}>
        <SecuritySettingsPanel
          authStatus={authStatus}
          onAuthStatusChanged={onAuthStatusChanged}
          onSignedOut={onSignedOut}
          highlightSection={highlightSecurity}
        />
      </div>

      {/* Section 1: Display Times & Refresh */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-5 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Screen Display Times &amp; Polling
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Control how long each screen stays visible and how often telemetry pushes to the LCD.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400">Set all screens:</span>
            {QUICK_SCREEN_SECONDS.map((sec) => (
              <button
                key={sec}
                onClick={() => applyDurationToAllScreens(sec)}
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-mono text-slate-800 dark:text-slate-200 hover:border-amber-500/60 transition-colors"
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex items-center justify-between px-3.5 py-2.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] cursor-pointer">
            <div>
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200">Auto-Rotate Screens</div>
              <div className="text-[11px] text-slate-500">Cycle through enabled screens</div>
            </div>
            <input
              type="checkbox"
              checked={config.rotationEnabled}
              onChange={(e) => onUpdateConfig((prev) => ({...prev, rotationEnabled: e.target.checked}))}
              className="accent-amber-500"
            />
          </label>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Live Telemetry Refresh Rate
            </label>
            <select
              value={config.hardware.pollIntervalMs ?? 2500}
              onChange={(e) =>
                onUpdateConfig((prev) => ({
                  ...prev,
                  hardware: {...prev.hardware, pollIntervalMs: Number(e.target.value)},
                }))
              }
              className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
            >
              {POLL_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              USB Auto-Push Interval ({config.hardware.pushIntervalSec}s)
            </label>
            <div className="flex items-center gap-3 px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042]">
              <input
                type="checkbox"
                checked={config.hardware.autoPushEnabled}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, autoPushEnabled: e.target.checked},
                  }))
                }
                className="accent-amber-500"
                title="Enable automatic USB push"
              />
              <input
                type="number"
                min={1}
                max={60}
                value={config.hardware.pushIntervalSec}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, pushIntervalSec: Math.max(1, Number(e.target.value))},
                  }))
                }
                className="w-20 bg-transparent text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none"
              />
              <span className="text-[11px] text-slate-500">sec</span>
            </div>
            <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {!config.hardware.autoPushEnabled
                ? 'Paused — tick to stream live updates or click Push to Screen'
                : !serialWritesActive
                  ? 'Waiting: unlock Serial Writes below to start pushing'
                  : config.hardwareDeploy?.daemonState === 'sleeping'
                    ? 'Sleeping (schedule or stopped array)'
                    : 'Active — streaming live updates to LCD'}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-200 dark:border-[#1F2937] rounded-md">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
              <tr>
                <th className="py-2.5 px-4 font-medium">Screen Name</th>
                <th className="py-2.5 px-4 font-medium text-center">Included in Rotation</th>
                <th className="py-2.5 px-4 font-medium">Display Time (Seconds)</th>
                <th className="py-2.5 px-4 font-medium">Transition</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1A2130]">
              {config.screens.map((scr) => (
                <tr key={scr.id} className="hover:bg-slate-50 dark:hover:bg-[#141A26]">
                  <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">{scr.name}</td>
                  <td className="py-2.5 px-4 text-center">
                    <input
                      type="checkbox"
                      checked={scr.enabled}
                      onChange={(e) =>
                        onUpdateConfig((prev) => ({
                          ...prev,
                          screens: prev.screens.map((s) =>
                            s.id === scr.id ? {...s, enabled: e.target.checked} : s
                          ),
                        }))
                      }
                      className="accent-amber-500 cursor-pointer"
                    />
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={3}
                        max={600}
                        value={scr.durationSec}
                        onChange={(e) =>
                          onUpdateConfig((prev) => ({
                            ...prev,
                            screens: prev.screens.map((s) =>
                              s.id === scr.id
                                ? {...s, durationSec: Math.max(3, Number(e.target.value))}
                                : s
                            ),
                          }))
                        }
                        className="w-20 px-2.5 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] font-mono text-xs text-slate-900 dark:text-slate-100 tabular-nums"
                      />
                      <span className="text-[11px] text-slate-500">sec</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-4">
                    <select
                      value={scr.transition}
                      onChange={(e) =>
                        onUpdateConfig((prev) => ({
                          ...prev,
                          screens: prev.screens.map((s) =>
                            s.id === scr.id
                              ? {...s, transition: e.target.value as 'cut' | 'fade' | 'slide'}
                              : s
                          ),
                        }))
                      }
                      className="px-2.5 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200"
                    >
                      <option value="fade">Fade</option>
                      <option value="slide">Slide</option>
                      <option value="cut">Instant Cut</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Brightness, Orientation & Sleep Schedule */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-5 shadow-xs dark:shadow-none">
        <div className="pb-3 border-b border-slate-200 dark:border-[#1F2937]">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            Brightness, Orientation &amp; Sleep Schedule
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Set daytime LCD brightness, physical display rotation, and automatic overnight blanking or dimming.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                LCD Backlight Brightness
              </label>
              <span className="font-mono text-xs text-amber-600 dark:text-amber-300 tabular-nums">
                {config.hardware.brightness}%
              </span>
            </div>
            <input
              type="range"
              min={5}
              max={100}
              value={config.hardware.brightness}
              onChange={(e) =>
                onUpdateConfig((prev) => ({
                  ...prev,
                  hardware: {...prev.hardware, brightness: Number(e.target.value)},
                }))
              }
              className="w-full accent-amber-500"
            />
            <div className="grid grid-cols-4 gap-2">
              {BRIGHTNESS_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      hardware: {...prev.hardware, brightness: preset.value},
                    }))
                  }
                  className={`py-1.5 rounded text-xs font-medium border transition-colors ${
                    config.hardware.brightness === preset.value
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-700 dark:text-amber-300'
                      : 'bg-slate-100 dark:bg-[#121824] border-slate-300 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Display Orientation
              </label>
              <select
                value={config.hardware.rotation}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    hardware: {...prev.hardware, rotation: Number(e.target.value) as 0 | 90 | 180 | 270},
                  }))
                }
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
              >
                <option value={0}>0° Standard Landscape (960×376)</option>
                <option value={90}>90° Portrait (376×960)</option>
                <option value={180}>180° Flipped Landscape (960×376)</option>
                <option value={270}>270° Flipped Portrait (376×960)</option>
              </select>
            </div>

            <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200">
                  <Moon className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                  Night Sleep Schedule
                </div>
                <input
                  type="checkbox"
                  checked={config.hardware.sleepScheduleEnabled}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      hardware: {...prev.hardware, sleepScheduleEnabled: e.target.checked},
                    }))
                  }
                  className="accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-3 gap-2 items-end">
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Sleep At</label>
                  <input
                    type="time"
                    value={config.hardware.sleepStart}
                    onChange={(e) =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        hardware: {...prev.hardware, sleepStart: e.target.value},
                      }))
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#121824] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">Wake At</label>
                  <input
                    type="time"
                    value={config.hardware.sleepEnd}
                    onChange={(e) =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        hardware: {...prev.hardware, sleepEnd: e.target.value},
                      }))
                    }
                    className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-[#121824] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-800 dark:text-slate-200"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-1">During Sleep</label>
                  <select
                    value={config.hardware.sleepMode ?? 'off'}
                    onChange={(e) =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        hardware: {...prev.hardware, sleepMode: e.target.value as 'off' | 'dim'},
                      }))
                    }
                    className="w-full px-2 py-1.5 rounded bg-white dark:bg-[#121824] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200"
                  >
                    <option value="off">Backlight Off</option>
                    <option value="dim">Dim to 5%</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between px-3 py-2 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] cursor-pointer text-xs">
                <span className="text-slate-800 dark:text-slate-200">Power off LCD at boot</span>
                <input
                  type="checkbox"
                  checked={Boolean(config.hardware.bootDisplayOff)}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      hardware: {...prev.hardware, bootDisplayOff: e.target.checked},
                    }))
                  }
                  className="accent-amber-500"
                />
              </label>
              <label className="flex items-center justify-between px-3 py-2 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] cursor-pointer text-xs">
                <span className="text-slate-800 dark:text-slate-200">Off on emergency stop</span>
                <input
                  type="checkbox"
                  checked={Boolean(config.hardware.powerOffOnEmergencyStop)}
                  onChange={(e) =>
                    onUpdateConfig((prev) => ({
                      ...prev,
                      hardware: {...prev.hardware, powerOffOnEmergencyStop: e.target.checked},
                    }))
                  }
                  className="accent-amber-500"
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Docker Container Images */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Container className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Docker Container Images
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Assign custom icons or images to running Docker containers so they appear inside the Docker Containers block on your LCD.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newContainerName}
              onChange={(e) => setNewContainerName(e.target.value)}
              placeholder="Add container name (e.g. plex)"
              className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 w-48"
            />
            <button
              onClick={() => {
                const clean = newContainerName.trim();
                if (!clean) return;
                onUpdateConfig((prev) => ({
                  ...prev,
                  dockerIcons: {
                    ...prev.dockerIcons,
                    [clean]: prev.dockerIcons?.[clean] || imageChoices[0]?.url || '',
                  },
                }));
                setNewContainerName('');
              }}
              className="px-3 py-1.5 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200 hover:border-amber-500/60"
            >
              Add Mapping
            </button>
          </div>
        </div>

        <input
          ref={dockerFileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            const target = activeUploadTargetRef.current;
            if (file && target) void handleUploadDockerIcon(file, target);
            e.target.value = '';
          }}
        />

        <div className="overflow-x-auto border border-slate-200 dark:border-[#1F2937] rounded-md">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
              <tr>
                <th className="py-2.5 px-4 font-medium w-16">Preview</th>
                <th className="py-2.5 px-4 font-medium">Container Name</th>
                <th className="py-2.5 px-4 font-medium">Status</th>
                <th className="py-2.5 px-4 font-medium">Assigned Image / Icon</th>
                <th className="py-2.5 px-4 font-medium text-right">Upload / Clear</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1A2130]">
              {[
                ...discoveredContainers.map((c) => ({name: c.name, state: c.state, image: c.image})),
                ...customOnlyNames.map((name) => ({name, state: 'custom' as const, image: 'Manual mapping'})),
              ].map((row) => {
                const assignedUrl = config.dockerIcons?.[row.name] ?? '';
                return (
                  <tr key={row.name} className="hover:bg-slate-50 dark:hover:bg-[#141A26]">
                    <td className="py-2 px-4">
                      {assignedUrl ? (
                        <img
                          src={assignedUrl}
                          alt={row.name}
                          referrerPolicy="no-referrer"
                          className="w-7 h-7 rounded object-cover border border-slate-300 dark:border-[#263042] bg-black"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#0B0E14] flex items-center justify-center font-mono text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">
                          {row.name.slice(0, 2)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <div className="font-mono font-medium text-slate-800 dark:text-slate-200">{row.name}</div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[220px]">{row.image}</div>
                    </td>
                    <td className="py-2 px-4">
                      <span
                        className={`text-xs font-mono ${
                          row.state === 'running'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.state === 'custom'
                              ? 'text-sky-600 dark:text-sky-400'
                              : 'text-slate-500'
                        }`}
                      >
                        {row.state}
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <select
                        value={assignedUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          onUpdateConfig((prev) => {
                            const next = {...(prev.dockerIcons || {})};
                            if (val) next[row.name] = val;
                            else delete next[row.name];
                            return {...prev, dockerIcons: next};
                          });
                        }}
                        className="w-full max-w-[240px] px-2.5 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200"
                      >
                        <option value="">Default Monogram</option>
                        {imageChoices.map((img) => (
                          <option key={img.id} value={img.url}>
                            {img.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            activeUploadTargetRef.current = row.name;
                            dockerFileInputRef.current?.click();
                          }}
                          disabled={uploadingForDocker === row.name}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-amber-500/60"
                        >
                          <Upload className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          {uploadingForDocker === row.name ? 'Uploading...' : 'Upload'}
                        </button>
                        {assignedUrl && (
                          <button
                            onClick={() =>
                              onUpdateConfig((prev) => {
                                const next = {...(prev.dockerIcons || {})};
                                delete next[row.name];
                                return {...prev, dockerIcons: next};
                              })
                            }
                            className="p-1.5 rounded border border-red-300 dark:border-red-900/40 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
                            title="Clear image"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 4: USB Display Hardware Port */}
      <section
        data-guide="settings-hardware"
        className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Usb className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              USB Serial Display Target
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Aoostar WTR MAX / GEM12+ PRO secondary LCD serial interface (VID 0x0416, PID 0x90A1 · 1,500,000 baud · AA 55 AA 55 protocol).
            </p>
          </div>
          <button
            onClick={() => void scanHardware()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1C2436]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Scan USB Screen
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400">
              Serial Port Path
            </label>
            <input
              type="text"
              value={config.hardware.devicePath}
              onChange={(e) =>
                onUpdateConfig((prev) => ({
                  ...prev,
                  hardware: {...prev.hardware, devicePath: e.target.value},
                }))
              }
              className="w-full px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            {devices.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {devices.map((d) => (
                  <button
                    key={d.path}
                    type="button"
                    onClick={() =>
                      onUpdateConfig((prev) => ({
                        ...prev,
                        hardware: {...prev.hardware, devicePath: d.path},
                      }))
                    }
                    className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors ${
                      config.hardware.devicePath === d.path
                        ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'border-slate-300 dark:border-[#263042] bg-slate-50 dark:bg-[#0B0E14] text-slate-700 dark:text-slate-300 hover:border-amber-500/60'
                    }`}
                  >
                    {d.path} ({d.vendorId}:{d.productId}
                    {d.isAoostarMatch ? ' · Aoostar LCD' : ''}
                    {!d.writable ? ' · RO' : ''})
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                No USB-UART display detected. On Unraid, verify <code className="font-mono">--device=/dev/ttyACM0</code> or container privileged mode is active.
              </div>
            )}
          </div>

          <div className="p-3 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] text-xs space-y-1.5 font-mono">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Transport Mode:</span>
              <span
                className={
                  frameMeta?.deliveryMode === 'asterctl' || frameMeta?.deliveryMode === 'usb-serial'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : frameMeta?.deliveryMode === 'error'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-amber-700 dark:text-amber-400'
                }
              >
                {frameMeta?.deliveryMode === 'asterctl'
                  ? `asterctl (${frameMeta.devicePath})`
                  : frameMeta?.deliveryMode === 'usb-serial'
                    ? `USB Serial (${frameMeta.devicePath})`
                    : frameMeta?.deliveryMode === 'dry-run'
                      ? 'Dry Run (No USB write)'
                      : frameMeta?.deliveryMode === 'error'
                        ? 'Error (No fallback write)'
                        : 'Blocked (See Diagnostics)'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Active on Hardware:</span>
              <span className="text-slate-800 dark:text-slate-200 truncate">
                {config.hardwareDeploy?.currentScreenName ?? frameMeta?.screenName ?? 'Waiting'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Chunks / Display Ack:</span>
              <span className="text-slate-800 dark:text-slate-200 tabular-nums">
                {frameMeta?.chunksSent ?? 0} / {frameMeta?.totalChunks ?? 15360} ·{' '}
                {frameMeta?.initAck ? 'ACK ("A")' : 'No ACK yet'}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500 dark:text-slate-400">Frame Digest / Wire CRC:</span>
              <span className="text-amber-700 dark:text-amber-300">{frameMeta?.crc16Hex ?? 'None (no wire CRC)'}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void handleDisplayCommand('/api/display/on', 'Display On')}
              disabled={busyHwAction}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-emerald-400 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5" />
              Display On
            </button>
            <button
              onClick={() => void handleDisplayCommand('/api/display/off', 'Display Off')}
              disabled={busyHwAction}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
            >
              Display Off
            </button>
            <button
              onClick={() => void handleDisplayCommand('/api/hardware/force-refresh', 'Force Full Refresh')}
              disabled={busyHwAction}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Force Full Refresh
            </button>
          </div>

          <div className="flex items-center gap-2">
            {serialWritesEnvLocked ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-700 dark:text-amber-300">
                <Lock className="w-3.5 h-3.5" />
                Locked off by AOOSTAR_LOCK_SERIAL_WRITES=true
              </span>
            ) : serialWritesActive ? (
              <button
                onClick={() => void handleToggleSerialWrites(false)}
                disabled={busyHwAction}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40"
              >
                <Lock className="w-3.5 h-3.5" />
                Lock Serial Writes
              </button>
            ) : (
              <button
                onClick={() => setConfirmUnlockWrites(true)}
                disabled={busyHwAction}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-amber-400 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-xs font-medium text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
              >
                <Unlock className="w-3.5 h-3.5" />
                Unlock Serial Writes
              </button>
            )}
          </div>
        </div>

        {confirmUnlockWrites && (
          <div className="p-3 rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-xs flex flex-wrap items-center justify-between gap-3">
            <span className="text-amber-900 dark:text-amber-200">
              Confirm enabling physical serial writes to <code className="font-mono">{config.hardware.devicePath}</code>?
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmUnlockWrites(false)}
                className="px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#141A26] text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleToggleSerialWrites(true)}
                className="px-3 py-1 rounded bg-amber-500 text-slate-950 font-semibold text-xs hover:bg-amber-400"
              >
                Confirm Unlock
              </button>
            </div>
          </div>
        )}

        {hardwareActionMsg && (
          <div
            className={`p-2.5 rounded border text-xs font-mono ${
              hardwareActionMsg.ok
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {hardwareActionMsg.text}
          </div>
        )}

        {frameMeta?.lastError && (
          <div className="p-3 rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Hardware Push Error: </span>
              <span className="font-mono">{frameMeta.lastError}</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
