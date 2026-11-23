import {useState} from 'react';
import {CheckCircle2, Cpu, Globe, Monitor, Plus, RefreshCw, Server, ShieldAlert, Trash2} from 'lucide-react';
import type {CustomConnection, StudioConfig, TelemetrySnapshot} from '../types.ts';

interface ConnectionsViewProps {
  config: StudioConfig;
  telemetry: TelemetrySnapshot | null;
  haConnected: boolean;
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  onRefreshAll: () => Promise<void>;
}

export function ConnectionsView({
  config,
  telemetry,
  haConnected,
  onUpdateConfig,
  onRefreshAll,
}: ConnectionsViewProps) {
  const [testingHa, setTestingHa] = useState(false);
  const [haStatus, setHaStatus] = useState<{ok: boolean; message: string} | null>(null);

  const [newConnName, setNewConnName] = useState('');
  const [newConnUrl, setNewConnUrl] = useState('');
  const [newConnPath, setNewConnPath] = useState('');
  const [newConnUnit, setNewConnUnit] = useState('');

  const handleTestHa = async () => {
    setTestingHa(true);
    setHaStatus(null);
    try {
      const res = await fetch('/api/integrations/test-ha', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          haUrl: config.integrations.haUrl,
          haToken: config.integrations.haToken,
        }),
      });
      const data = (await res.json()) as {ok: boolean; message: string};
      setHaStatus(data);
      if (data.ok) {
        onUpdateConfig((prev) => ({
          ...prev,
          integrations: {...prev.integrations, haEnabled: true},
        }));
        await onRefreshAll();
      }
    } catch {
      setHaStatus({ok: false, message: 'Could not reach Home Assistant.'});
    } finally {
      setTestingHa(false);
    }
  };

  const handleAddCustomConnection = () => {
    if (!newConnName.trim() || !newConnUrl.trim()) return;
    const item: CustomConnection = {
      id: `conn_${Date.now().toString(36)}`,
      name: newConnName.trim(),
      type: 'http_json',
      url: newConnUrl.trim(),
      jsonPath: newConnPath.trim() || undefined,
      unit: newConnUnit.trim() || '',
      enabled: true,
    };
    onUpdateConfig((prev) => ({
      ...prev,
      integrations: {
        ...prev.integrations,
        customConnections: [...prev.integrations.customConnections, item],
      },
    }));
    setNewConnName('');
    setNewConnUrl('');
    setNewConnPath('');
    setNewConnUnit('');
    void onRefreshAll();
  };

  const handleRemoveCustom = (id: string) => {
    onUpdateConfig((prev) => ({
      ...prev,
      integrations: {
        ...prev.integrations,
        customConnections: prev.integrations.customConnections.filter((c) => c.id !== id),
      },
    }));
  };

  const primaryGpu = telemetry?.gpus?.[0];
  const ramPct = telemetry
    ? Math.round((telemetry.system.ramUsedBytes / Math.max(1, telemetry.system.ramTotalBytes)) * 100)
    : null;

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      {/* Always-On Local Server Telemetry Card */}
      <section
        data-guide="connections-grid"
        className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              Local Server Stats (Always Active)
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Reads CPU, GPU, memory, drive thermals, Docker containers, active SMB users, and host telemetry directly from your Unraid / Linux host.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">
              {telemetry?.sourceLabel || 'Collector Active'}
            </span>
            <button
              onClick={() => void onRefreshAll()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1C2436]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Now
            </button>
          </div>
        </div>

        {/* Live CPU & GPU Hardware Detection Readout */}
        {telemetry && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
            <div className="p-3 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 truncate">
                  <Cpu className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span className="truncate">{telemetry.system.cpuModel}</span>
                </span>
                <span className="font-mono text-amber-600 dark:text-amber-300 tabular-nums shrink-0">
                  {telemetry.system.cpuPercent}% · {telemetry.system.cpuTempC}°C
                </span>
              </div>
              <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                <span>{telemetry.system.cpuCores} threads</span>
                {telemetry.system.cpuFreqMhz ? <span>{telemetry.system.cpuFreqMhz} MHz</span> : null}
                <span>{telemetry.system.cpuPowerW} W</span>
                {ramPct !== null ? <span>RAM {ramPct}%</span> : null}
              </div>
            </div>

            <div className="p-3 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] text-xs space-y-1">
              {primaryGpu ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 truncate">
                      <Monitor className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
                      <span className="truncate">{primaryGpu.name}</span>
                    </span>
                    <span className="font-mono text-sky-600 dark:text-sky-300 tabular-nums shrink-0">
                      {primaryGpu.utilPercent !== null ? `${primaryGpu.utilPercent}%` : '—'}
                      {primaryGpu.tempC !== null ? ` · ${primaryGpu.tempC}°C` : ''}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="uppercase">{primaryGpu.vendor}</span>
                    {primaryGpu.freqMhz !== null ? <span>{primaryGpu.freqMhz} MHz</span> : null}
                    {primaryGpu.powerW !== null ? <span>{primaryGpu.powerW} W</span> : null}
                    {primaryGpu.vramUsedMB !== null ? (
                      <span>
                        VRAM {primaryGpu.vramUsedMB}
                        {primaryGpu.vramTotalMB ? `/${primaryGpu.vramTotalMB}` : ''} MB
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="text-slate-500 dark:text-slate-400">
                  No GPU sysfs/nvidia-smi sensor detected inside container. Map <code className="font-mono">/dev/dri</code> or NVIDIA runtime if needed.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Home Assistant */}
        <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                Home Assistant
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Expose all Home Assistant sensors to the Exposed Entities registry and Screens studio.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.integrations.haEnabled}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    integrations: {...prev.integrations, haEnabled: e.target.checked},
                  }))
                }
                className="accent-amber-500"
              />
              {haConnected ? 'Connected' : 'Enable'}
            </label>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Local URL
              </label>
              <input
                type="text"
                value={config.integrations.haUrl}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    integrations: {...prev.integrations, haUrl: e.target.value},
                  }))
                }
                placeholder="http://192.168.1.10:8123"
                className="w-full px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Long-Lived Access Token
              </label>
              <input
                type="password"
                value={config.integrations.haToken}
                onChange={(e) =>
                  onUpdateConfig((prev) => ({
                    ...prev,
                    integrations: {...prev.integrations, haToken: e.target.value},
                  }))
                }
                placeholder="eyJhbGciOi..."
                className="w-full px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
              />
            </div>

            <button
              onClick={() => void handleTestHa()}
              disabled={testingHa}
              className="px-4 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
            >
              {testingHa ? 'Connecting...' : 'Test & Sync Home Assistant'}
            </button>

            {haStatus && (
              <div
                className={`text-xs flex items-center gap-1.5 ${
                  haStatus.ok
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
                }`}
              >
                {haStatus.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                <span>{haStatus.message}</span>
              </div>
            )}
          </div>
        </section>

        {/* Add Other External Local Connections */}
        <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none">
          <div className="pb-3 border-b border-slate-200 dark:border-[#1F2937]">
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-600 dark:text-sky-400" />
              Other Local Sources (JSON / HTTP)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Poll any local API endpoint (Tautulli, Pi-hole, Solar Inverter, UPS, or custom script) and expose its value as an entity.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={newConnName}
              onChange={(e) => setNewConnName(e.target.value)}
              placeholder="Name (e.g. Pi-hole Blocked)"
              className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={newConnUrl}
              onChange={(e) => setNewConnUrl(e.target.value)}
              placeholder="http://192.168.1.2/api/stats"
              className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={newConnPath}
              onChange={(e) => setNewConnPath(e.target.value)}
              placeholder="JSON path (e.g. data.blocked_today)"
              className="px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newConnUnit}
                onChange={(e) => setNewConnUnit(e.target.value)}
                placeholder="Unit (e.g. W)"
                className="flex-1 px-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
              />
              <button
                onClick={handleAddCustomConnection}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-slate-100 dark:bg-[#1A2233] border border-slate-300 dark:border-[#2C384F] text-xs font-medium text-slate-900 dark:text-slate-100 hover:border-amber-500/60 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Source
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
            {config.integrations.customConnections.map((cc) => (
              <div
                key={cc.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937] text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-800 dark:text-slate-200 truncate">{cc.name}</div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">
                    {cc.url} {cc.jsonPath ? `-> ${cc.jsonPath}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`font-mono ${
                      cc.lastError
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {cc.lastError ? cc.lastError : `${cc.lastValue ?? '—'} ${cc.unit ?? ''}`}
                  </span>
                  <button
                    onClick={() => handleRemoveCustom(cc.id)}
                    className="text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                    title="Remove source"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {config.integrations.customConnections.length === 0 && (
              <p className="text-xs text-slate-500">No custom local HTTP sources added yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
