import {useState} from 'react';
import {CheckCircle2, Globe, Plus, RefreshCw, Server, ShieldAlert, Trash2} from 'lucide-react';
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

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      {/* Always-On Local Server Telemetry Card */}
      <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-display font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-emerald-400" />
              Local Server Stats (Always Active)
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Automatically pulls CPU, memory, drive thermals, Docker containers, active SMB users, and running tasks directly from your Unraid / Linux host.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-emerald-400">
              {telemetry?.isRealUnraidHost ? 'Unraid Host Active' : 'Auto Host Collector Active'}
            </span>
            <button
              onClick={() => void onRefreshAll()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#263042] bg-[#141A26] text-xs text-slate-200 hover:bg-[#1C2436]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Sync Now
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add Home Assistant */}
        <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-5 space-y-4">
          <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#1F2937]">
            <div>
              <h2 className="text-base font-display font-semibold text-slate-100">Home Assistant</h2>
              <p className="text-xs text-slate-400 mt-1">
                Expose all Home Assistant sensors to the Exposed Entities registry and Screens studio.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
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
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Local URL</label>
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
                className="w-full px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-100"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
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
                className="w-full px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-100"
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
                  haStatus.ok ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {haStatus.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                <span>{haStatus.message}</span>
              </div>
            )}
          </div>
        </section>

        {/* Add Other External Local Connections */}
        <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-5 space-y-4">
          <div className="pb-3 border-b border-[#1F2937]">
            <h2 className="text-base font-display font-semibold text-slate-100 flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" />
              Other Local Sources (JSON / HTTP)
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Poll any local API endpoint (Tautulli, Pi-hole, Solar Inverter, UPS, or custom script) and expose its value as an entity.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="text"
              value={newConnName}
              onChange={(e) => setNewConnName(e.target.value)}
              placeholder="Name (e.g. Pi-hole Blocked)"
              className="px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs text-slate-100"
            />
            <input
              type="text"
              value={newConnUrl}
              onChange={(e) => setNewConnUrl(e.target.value)}
              placeholder="http://192.168.1.2/api/stats"
              className="px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-100"
            />
            <input
              type="text"
              value={newConnPath}
              onChange={(e) => setNewConnPath(e.target.value)}
              placeholder="JSON path (e.g. data.blocked_today)"
              className="px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs font-mono text-slate-100"
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={newConnUnit}
                onChange={(e) => setNewConnUnit(e.target.value)}
                placeholder="Unit (e.g. W)"
                className="flex-1 px-3 py-1.5 rounded bg-[#0B0E14] border border-[#263042] text-xs text-slate-100"
              />
              <button
                onClick={handleAddCustomConnection}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-[#1A2233] border border-[#2C384F] text-xs font-medium text-slate-100 hover:border-amber-500/60 whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Source
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-[#1F2937]">
            {config.integrations.customConnections.map((cc) => (
              <div
                key={cc.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded bg-[#0B0E14] border border-[#1F2937] text-xs"
              >
                <div className="min-w-0">
                  <div className="font-medium text-slate-200 truncate">{cc.name}</div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">
                    {cc.url} {cc.jsonPath ? `-> ${cc.jsonPath}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`font-mono ${cc.lastError ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {cc.lastError ? cc.lastError : `${cc.lastValue ?? '—'} ${cc.unit ?? ''}`}
                  </span>
                  <button
                    onClick={() => handleRemoveCustom(cc.id)}
                    className="text-slate-400 hover:text-red-400"
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
