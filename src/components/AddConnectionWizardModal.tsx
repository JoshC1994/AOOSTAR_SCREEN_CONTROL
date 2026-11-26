import {useEffect, useState} from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Globe,
  Home,
  Server,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import type {CustomConnection, StudioConfig, TelemetrySnapshot} from '../types.ts';
import {apiFetch} from '../utils/apiClient.ts';

type WizardKind = 'home_assistant' | 'custom_http' | 'host_sensors';

interface AddConnectionWizardModalProps {
  open: boolean;
  initialKind?: WizardKind | null;
  config: StudioConfig;
  telemetry: TelemetrySnapshot | null;
  onClose: () => void;
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  onRefreshAll: () => Promise<void>;
}

interface CustomTestResult {
  ok: boolean;
  message: string;
  extractedValue?: string | null;
  previewValue?: string;
  suggestedPaths?: Array<{path: string; value: string}>;
}

export function AddConnectionWizardModal({
  open,
  initialKind = null,
  config,
  telemetry,
  onClose,
  onUpdateConfig,
  onRefreshAll,
}: AddConnectionWizardModalProps) {
  const [step, setStep] = useState<'pick' | 'configure'>(initialKind ? 'configure' : 'pick');
  const [kind, setKind] = useState<WizardKind>(initialKind ?? 'home_assistant');

  // Home Assistant fields
  const [haUrl, setHaUrl] = useState(config.integrations.haUrl || '');
  const [haToken, setHaToken] = useState(config.integrations.haToken || '');
  const [haEnabled, setHaEnabled] = useState(config.integrations.haEnabled);
  const [testingHa, setTestingHa] = useState(false);
  const [haResult, setHaResult] = useState<{ok: boolean; message: string} | null>(null);

  // Custom HTTP/JSON fields
  const [connName, setConnName] = useState('');
  const [connUrl, setConnUrl] = useState('');
  const [connToken, setConnToken] = useState('');
  const [connPath, setConnPath] = useState('');
  const [connUnit, setConnUnit] = useState('');
  const [testingCustom, setTestingCustom] = useState(false);
  const [customResult, setCustomResult] = useState<CustomTestResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialKind) {
      setKind(initialKind);
      setStep('configure');
    } else {
      setStep('pick');
    }
    setHaUrl(config.integrations.haUrl || '');
    setHaToken(config.integrations.haToken || '');
    setHaEnabled(config.integrations.haEnabled);
    setHaResult(null);
    setConnName('');
    setConnUrl('');
    setConnToken('');
    setConnPath('');
    setConnUnit('');
    setCustomResult(null);
    setSaving(false);
  }, [open, initialKind, config.integrations.haEnabled, config.integrations.haToken, config.integrations.haUrl]);

  if (!open) return null;

  const handleSelectKind = (nextKind: WizardKind) => {
    setKind(nextKind);
    setStep('configure');
    setHaResult(null);
    setCustomResult(null);
  };

  const handleTestHa = async () => {
    setTestingHa(true);
    setHaResult(null);
    try {
      const res = await apiFetch('/api/integrations/test-ha', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          haUrl: haUrl.trim(),
          haToken: haToken.trim() || undefined,
        }),
      });
      const data = (await res.json()) as {ok: boolean; status?: number; message?: string; error?: string};
      setHaResult({
        ok: Boolean(data.ok),
        message: data.message || data.error || `HTTP ${data.status ?? res.status}`,
      });
    } catch {
      setHaResult({ok: false, message: 'Could not reach Home Assistant API.'});
    } finally {
      setTestingHa(false);
    }
  };

  const handleSaveHa = async () => {
    if (!haUrl.trim()) return;
    setSaving(true);
    try {
      onUpdateConfig((prev) => ({
        ...prev,
        integrations: {
          ...prev.integrations,
          haEnabled: true,
          haUrl: haUrl.trim(),
          ...(haToken.trim() ? {haToken: haToken.trim(), clearHaToken: false} : {}),
        },
      }));
      await onRefreshAll();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleTestCustom = async () => {
    if (!connUrl.trim()) {
      setCustomResult({ok: false, message: 'Enter an endpoint URL first.'});
      return;
    }
    setTestingCustom(true);
    setCustomResult(null);
    try {
      const res = await apiFetch('/api/integrations/test-custom', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          url: connUrl.trim(),
          token: connToken.trim() || undefined,
          jsonPath: connPath.trim() || undefined,
        }),
      });
      const data = (await res.json()) as CustomTestResult & {error?: string};
      setCustomResult({
        ok: Boolean(data.ok),
        message: data.message || data.error || `HTTP ${res.status}`,
        extractedValue: data.extractedValue,
        previewValue: data.previewValue,
        suggestedPaths: data.suggestedPaths,
      });
    } catch {
      setCustomResult({ok: false, message: 'Request failed. Verify URL reachability from the container.'});
    } finally {
      setTestingCustom(false);
    }
  };

  const handleSaveCustom = async () => {
    if (!connName.trim() || !connUrl.trim()) return;
    setSaving(true);
    try {
      const newConn: CustomConnection = {
        id: `conn_${Date.now().toString(36)}`,
        name: connName.trim(),
        type: 'http_json',
        url: connUrl.trim(),
        ...(connToken.trim() ? {token: connToken.trim()} : {}),
        jsonPath: connPath.trim() || undefined,
        unit: connUnit.trim() || '',
        enabled: true,
        ...(customResult?.extractedValue ? {lastValue: customResult.extractedValue} : {}),
      };
      onUpdateConfig((prev) => ({
        ...prev,
        integrations: {
          ...prev.integrations,
          customConnections: [...prev.integrations.customConnections, newConn],
        },
      }));
      await onRefreshAll();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-6 space-y-5 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
          <div className="flex items-center gap-3">
            {step === 'configure' && (
              <button
                type="button"
                onClick={() => setStep('pick')}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                {step === 'pick'
                  ? 'Add Data Connection'
                  : kind === 'home_assistant'
                    ? 'Connect Home Assistant'
                    : kind === 'custom_http'
                      ? 'Add Custom HTTP / JSON Source'
                      : 'Host Hardware & Container Collector'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {step === 'pick'
                  ? 'Step 1 of 2 · Choose a local integration to expose telemetry as screen entities.'
                  : kind === 'host_sensors'
                    ? 'Built-in container telemetry runs locally without cloud access.'
                    : 'Step 2 of 2 · Enter connection details, test live reachability, and save.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close connection wizard"
            className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step 1: Source Type Picker */}
        {step === 'pick' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <button
              type="button"
              onClick={() => handleSelectKind('home_assistant')}
              className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-4 flex flex-col justify-between gap-4 transition-colors"
            >
              <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-sky-600 dark:text-sky-400">
                <Home className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Home Assistant
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Import room temperatures, power sensors, solar stats, and states via Long-Lived Token.
                </p>
                <div className="mt-2.5 text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <span>{config.integrations.haEnabled ? 'Configured' : 'Configure'}</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectKind('custom_http')}
              className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-4 flex flex-col justify-between gap-4 transition-colors"
            >
              <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-amber-600 dark:text-amber-400">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Custom HTTP / JSON
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Poll any local service (Pi-hole, Tautulli, UPS, solar inverter, custom API) with auto JSON-key picker.
                </p>
                <div className="mt-2.5 text-[11px] font-mono text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <span>{config.integrations.customConnections.length} active</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleSelectKind('host_sensors')}
              className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-4 flex flex-col justify-between gap-4 transition-colors"
            >
              <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Host NAS Sensors
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Inspect local Docker host detection (CPU, GPU, hwmon, storage, containers) &amp; mount tips.
                </p>
                <div className="mt-2.5 text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span>Always Active</span>
                  <ChevronRight className="w-3 h-3" />
                </div>
              </div>
            </button>
          </div>
        )}

        {/* Step 2A: Home Assistant */}
        {step === 'configure' && kind === 'home_assistant' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Home Assistant URL
                </label>
                <input
                  type="text"
                  value={haUrl}
                  onChange={(e) => setHaUrl(e.target.value)}
                  placeholder="http://192.168.1.50:8123"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Long-Lived Access Token {config.integrations.haTokenSet ? '(leave blank to keep saved token)' : ''}
                </label>
                <input
                  type="password"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  placeholder={config.integrations.haTokenSet ? 'Saved securely on server' : 'Paste token from HA Profile -> Security'}
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {haResult && (
              <div
                className={`p-3 rounded border text-xs flex items-center gap-2 ${
                  haResult.ok
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                    : 'border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                }`}
              >
                {haResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />}
                <span>{haResult.message}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-[#1F2937]">
              <button
                type="button"
                onClick={() => void handleTestHa()}
                disabled={testingHa || !haUrl.trim()}
                className="px-3.5 py-2 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
              >
                {testingHa ? 'Testing...' : 'Test Connection'}
              </button>

              <div className="flex items-center gap-2">
                {haEnabled && (
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateConfig((prev) => ({
                        ...prev,
                        integrations: {...prev.integrations, haEnabled: false},
                      }));
                      onClose();
                    }}
                    className="px-3 py-2 rounded border border-rose-300 dark:border-rose-900/50 text-xs text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                  >
                    Disable HA
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveHa()}
                  disabled={saving || !haUrl.trim()}
                  className="px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold disabled:opacity-50"
                >
                  {saving ? 'Syncing...' : 'Save & Sync Entities'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2B: Custom HTTP / JSON */}
        {step === 'configure' && kind === 'custom_http' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Entity Display Name
                </label>
                <input
                  type="text"
                  value={connName}
                  onChange={(e) => setConnName(e.target.value)}
                  placeholder="e.g. Solar Power Output"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Unit (Optional)
                </label>
                <input
                  type="text"
                  value={connUnit}
                  onChange={(e) => setConnUnit(e.target.value)}
                  placeholder="e.g. W, °C, %, req/s"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Endpoint URL (LAN / Docker Service)
                </label>
                <input
                  type="text"
                  value={connUrl}
                  onChange={(e) => setConnUrl(e.target.value)}
                  placeholder="http://192.168.1.20:8080/api/metrics"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  JSON Dot Path (Optional)
                </label>
                <input
                  type="text"
                  value={connPath}
                  onChange={(e) => setConnPath(e.target.value)}
                  placeholder="e.g. data.watts"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Bearer Token (Optional)
                </label>
                <input
                  type="password"
                  value={connToken}
                  onChange={(e) => setConnToken(e.target.value)}
                  placeholder="Optional API token"
                  className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            {customResult && (
              <div className="space-y-2.5">
                <div
                  className={`p-3 rounded border text-xs flex items-start gap-2 ${
                    customResult.ok
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                      : 'border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                  }`}
                >
                  {customResult.ok ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <div>{customResult.message}</div>
                    {customResult.previewValue && !customResult.extractedValue && (
                      <div className="mt-1 font-mono text-[11px] opacity-80 truncate">
                        Preview: {customResult.previewValue}
                      </div>
                    )}
                  </div>
                </div>

                {customResult.suggestedPaths && customResult.suggestedPaths.length > 0 && (
                  <div className="rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] p-3 space-y-2">
                    <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      Click any detected JSON key to select its path:
                    </div>
                    <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                      {customResult.suggestedPaths.map((item) => (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => setConnPath(item.path)}
                          className={`px-2 py-1 rounded border text-[11px] font-mono transition-colors ${
                            connPath === item.path
                              ? 'border-amber-500 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'border-slate-300 dark:border-[#263042] bg-white dark:bg-[#121824] text-slate-700 dark:text-slate-300 hover:border-amber-500/60'
                          }`}
                        >
                          {item.path} = {item.value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-[#1F2937]">
              <button
                type="button"
                onClick={() => void handleTestCustom()}
                disabled={testingCustom || !connUrl.trim()}
                className="px-3.5 py-2 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
              >
                {testingCustom ? 'Inspecting...' : 'Test Endpoint & Inspect JSON'}
              </button>

              <button
                type="button"
                onClick={() => void handleSaveCustom()}
                disabled={saving || !connName.trim() || !connUrl.trim()}
                className="px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add Source & Sync'}
              </button>
            </div>
          </div>
        )}

        {/* Step 2C: Host Collector Overview */}
        {step === 'configure' && kind === 'host_sensors' && (
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-emerald-500" />
                  {telemetry?.system.cpuModel || 'Local Host Collector'}
                </span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">
                  {telemetry?.sourceLabel || 'Active'}
                </span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                CPU load, memory, thermal zones, storage utilization, and container statuses are automatically read from read-only host mounts inside Docker.
              </p>
            </div>

            <div className="rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] p-3.5 space-y-2">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Recommended Read-Only Docker Mounts (Unraid &amp; Linux)
              </div>
              <ul className="space-y-1 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                <li>• <span className="text-slate-800 dark:text-slate-200">/sys/class/hwmon:/sys/class/hwmon:ro</span> — CPU &amp; board thermal sensors</li>
                <li>• <span className="text-slate-800 dark:text-slate-200">/var/run/docker.sock:/var/run/docker.sock:ro</span> — Container list (or use Docker Socket Proxy)</li>
                <li>• <span className="text-slate-800 dark:text-slate-200">/var/local/emhttp:/var/local/emhttp:ro</span> — Optional Unraid array &amp; disk telemetry</li>
                <li>• <span className="text-slate-800 dark:text-slate-200">--device=/dev/dri</span> — Optional Intel / AMD iGPU telemetry</li>
              </ul>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-[#1F2937]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
