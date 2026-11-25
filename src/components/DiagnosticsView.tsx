import {useCallback, useEffect, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  OctagonX,
  Play,
  Power,
  RefreshCw,
  ShieldAlert,
  Terminal,
  Usb,
} from 'lucide-react';
import type {DiagnosticsSnapshot} from '../types.ts';
import {apiFetch} from '../utils/apiClient.ts';

interface DiagnosticsViewProps {
  onRefreshParent?: () => void;
}

export function DiagnosticsView({onRefreshParent}: DiagnosticsViewProps) {
  const [diag, setDiag] = useState<DiagnosticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ok: boolean; text: string} | null>(null);
  const [confirmMode, setConfirmMode] = useState<'test-frame' | 'display-on' | null>(null);
  const [activeLogTab, setActiveLogTab] = useState<'dry-run' | 'serial' | 'asterctl'>('dry-run');

  const fetchDiagnostics = useCallback(async () => {
    try {
      const res = await apiFetch('/api/diagnostics');
      if (res.ok) {
        const data = (await res.json()) as DiagnosticsSnapshot;
        setDiag(data);
      }
    } catch {
      // ignore transient poll error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDiagnostics();
    const id = window.setInterval(() => {
      void fetchDiagnostics();
    }, 3000);
    return () => window.clearInterval(id);
  }, [fetchDiagnostics]);

  const handleDryRun = async () => {
    setBusyAction('dry-run');
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/hardware/dry-run', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.diagnostics) setDiag(data.diagnostics);
      if (res.ok) {
        setActionMessage({
          ok: true,
          text: `Dry run complete: ${data.totalChunks} packets (${data.totalBytesOnWire.toLocaleString()} bytes on wire, CRC: none). Never wrote to /dev/ttyACM0.`,
        });
        setActiveLogTab('dry-run');
      } else {
        setActionMessage({ok: false, text: data.error || `Dry run failed (HTTP ${res.status})`});
      }
    } catch (err) {
      setActionMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Dry run request failed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTestAsterctl = async () => {
    setBusyAction('test-asterctl');
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/hardware/test-asterctl', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({testRealDevice: false}),
      });
      const data = await res.json();
      if (data.diagnostics) setDiag(data.diagnostics);
      setActionMessage({
        ok: Boolean(data.ok),
        text: data.message || data.error || `asterctl check completed (HTTP ${res.status})`,
      });
      setActiveLogTab('asterctl');
    } catch (err) {
      setActionMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Test asterctl request failed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleConfirmedSafeTest = async () => {
    if (!confirmMode) return;
    const mode = confirmMode;
    setConfirmMode(null);
    setBusyAction(mode);
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/hardware/safe-test', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({confirmed: true, mode}),
      });
      const data = await res.json();
      if (data.diagnostics) setDiag(data.diagnostics);
      onRefreshParent?.();
      if (res.ok) {
        setActionMessage({
          ok: true,
          text:
            mode === 'display-on'
              ? `DISPLAY_ON ACK verified via ${data.transport} on ${data.devicePath}`
              : `Test frame pushed via ${data.transport} to ${data.devicePath}`,
        });
        setActiveLogTab(data.transport === 'asterctl' ? 'asterctl' : 'serial');
      } else {
        setActionMessage({
          ok: false,
          text: data.error || `Hardware test failed (HTTP ${res.status})`,
        });
      }
    } catch (err) {
      setActionMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Safe test request failed',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDisplayPowerOrRefresh = async (
    endpoint: '/api/display/on' | '/api/display/off' | '/api/hardware/force-refresh',
    key: string,
    label: string
  ) => {
    setBusyAction(key);
    setActionMessage(null);
    try {
      const res = await apiFetch(endpoint, {method: 'POST'});
      const data = await res.json().catch(() => ({}));
      if (data.diagnostics) setDiag(data.diagnostics);
      onRefreshParent?.();
      setActionMessage({
        ok: res.ok,
        text: res.ok ? data.message || `${label} complete.` : data.error || `${label} failed (HTTP ${res.status})`,
      });
    } catch (err) {
      setActionMessage({
        ok: false,
        text: err instanceof Error ? err.message : `${label} failed`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleEmergencyStop = async () => {
    setBusyAction('stop');
    setActionMessage(null);
    try {
      const res = await apiFetch('/api/hardware/stop-serial', {method: 'POST'});
      const data = await res.json();
      if (data.diagnostics) setDiag(data.diagnostics);
      onRefreshParent?.();
      setActionMessage({
        ok: true,
        text: data.message || 'All serial writes stopped.',
      });
    } catch (err) {
      setActionMessage({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to stop serial writes',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleClearEmergencyStop = async () => {
    setBusyAction('clear-stop');
    try {
      const res = await apiFetch('/api/hardware/clear-emergency-stop', {method: 'POST'});
      const data = await res.json();
      if (data.diagnostics) setDiag(data.diagnostics);
      setActionMessage({
        ok: true,
        text: 'Emergency stop latch cleared. Real writes remain gated by AOOSTAR_ENABLE_SERIAL_WRITES or Settings.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  const perms = diag?.serialPermissions;
  const aster = diag?.asterctl;

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      {/* Safety Warning Banner */}
      <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/25 p-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-display font-semibold text-amber-900 dark:text-amber-200">
              Serial writes can affect the physical LCD. Enable only after protocol validation.
            </div>
            <p className="text-xs text-amber-800/90 dark:text-amber-300/90 mt-1">
              Real writes to <code className="font-mono">/dev/ttyACM0</code> require{' '}
              <code className="font-mono font-semibold">AOOSTAR_ENABLE_SERIAL_WRITES=true</code> (defaults to{' '}
              <code className="font-mono">false</code>) and never trigger automatically on startup.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {diag?.emergencyStopped ? (
            <button
              onClick={() => void handleClearEmergencyStop()}
              disabled={busyAction !== null}
              className="px-3 py-1.5 rounded border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
            >
              Clear Emergency Stop
            </button>
          ) : null}
          <button
            onClick={() => void handleEmergencyStop()}
            disabled={busyAction !== null}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
          >
            <OctagonX className="w-3.5 h-3.5" />
            Stop all serial writes
          </button>
        </div>
      </div>

      {/* Action Controls Bar */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-[#1F2937]">
          <div>
            <h1 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
              Hardware &amp; Protocol Diagnostics
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Verified <code className="font-mono">zehnm/aoostar-rs</code> (VID <code className="font-mono">0416</code>, PID{' '}
              <code className="font-mono">90a1</code>, 960×376 RGB565 LE, 15,360 × 47B chunks, no wire CRC).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void fetchDiagnostics()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1C2436]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
            <button
              onClick={() => void handleDryRun()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-sky-300 dark:border-sky-800 bg-sky-50 dark:bg-sky-950/30 text-xs font-semibold text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              Dry run
            </button>
            <button
              onClick={() => void handleTestAsterctl()}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
            >
              <Terminal className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              Compare (--simulate --save)
            </button>
            <button
              onClick={() => setConfirmMode('display-on')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-50"
            >
              Safe DISPLAY_ON Check
            </button>
            <button
              onClick={() => setConfirmMode('test-frame')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold disabled:opacity-50"
            >
              <Cpu className="w-3.5 h-3.5" />
              Send test frame
            </button>
            <button
              onClick={() => void handleDisplayPowerOrRefresh('/api/display/on', 'display-power-on', 'Display On')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-emerald-400 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-xs font-medium text-emerald-800 dark:text-emerald-300 disabled:opacity-50"
            >
              <Power className="w-3.5 h-3.5" />
              On
            </button>
            <button
              onClick={() => void handleDisplayPowerOrRefresh('/api/display/off', 'display-power-off', 'Display Off')}
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 disabled:opacity-50"
            >
              Off
            </button>
            <button
              onClick={() =>
                void handleDisplayPowerOrRefresh('/api/hardware/force-refresh', 'force-refresh', 'Force Full Refresh')
              }
              disabled={busyAction !== null}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 disabled:opacity-50"
            >
              Full Sync
            </button>
          </div>
        </div>

        {actionMessage && (
          <div
            className={`p-3 rounded border text-xs flex items-start gap-2 ${
              actionMessage.ok
                ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/25 text-emerald-800 dark:text-emerald-300'
                : 'border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-300'
            }`}
          >
            {actionMessage.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span className="font-mono break-all">{actionMessage.text}</span>
          </div>
        )}

        {/* Hardware & Transport Matrix */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5 text-amber-500" />
              Detected Device Path
            </div>
            <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
              {diag?.detectedDevicePath ?? 'None'}
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400">
              USB VID/PID:{' '}
              <span
                className={
                  perms?.isAoostarMatch
                    ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                    : 'text-amber-700 dark:text-amber-400'
                }
              >
                {diag?.usbVidPid ?? 'Not found (expect 0x0416:0x90a1)'}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Serial Permissions
            </div>
            <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100">
              {!perms?.exists
                ? 'Device Missing'
                : perms.readable && perms.writable
                  ? `Read/Write OK (${perms.modeOctal ?? '---'})`
                  : `Denied (${perms.modeOctal ?? '---'})`}
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate" title={perms?.error || ''}>
              {perms?.error ? perms.error : perms?.exists ? 'R_OK | W_OK verified' : 'Map --device=/dev/ttyACM0'}
            </div>
          </div>

          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Optional asterctl CLI
            </div>
            <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 truncate">
              {aster?.available ? aster.version : 'Not installed (optional)'}
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 truncate" title={aster?.binaryPath || aster?.lastError || ''}>
              {aster?.binaryPath ?? 'Live updates run natively via Node serial'}
            </div>
          </div>

          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1">
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Real Serial Write Status
            </div>
            <div
              className={`text-sm font-mono font-semibold ${
                diag?.emergencyStopped
                  ? 'text-rose-600 dark:text-rose-400'
                  : diag?.serialWritesEnabled
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {diag?.emergencyStopped
                ? 'EMERGENCY STOPPED'
                : diag?.serialWritesEnabled
                  ? `ENABLED (${diag.activeTransport})`
                  : 'DISABLED (Safe Default)'}
            </div>
            <div className="text-[11px] font-mono text-slate-600 dark:text-slate-400 space-y-0.5">
              <div>
                Env: <span className="font-semibold">{String(diag?.serialWritesEnvEnabled ?? false)}</span> · Config:{' '}
                <span className="font-semibold">{String(diag?.serialWritesConfigEnabled ?? false)}</span>
                {diag?.serialWritesEnvLocked ? ' (Env Locked)' : ''}
              </div>
              <div>
                Daemon: <span className="font-semibold">{diag?.daemonState ?? 'idle'}</span> · Diff:{' '}
                <span>{diag?.lastFrame?.diffMode ? 'diff-cache' : 'full'}</span> · Skipped:{' '}
                <span>{String(diag?.lastFrame?.unchangedSkipped ?? false)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Last Error & Last Packet Preview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Last Protocol Error
            </div>
            <div
              className={`text-xs font-mono break-all ${
                diag?.lastProtocolError
                  ? 'text-rose-700 dark:text-rose-300'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {diag?.lastProtocolError || 'None recorded'}
            </div>
          </div>

          <div className="p-3.5 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Last Packet Preview
            </div>
            <div className="text-xs font-mono text-amber-700 dark:text-amber-300 break-all">
              {diag?.lastPacketPreview || 'No packets built or sent yet — click Dry run'}
            </div>
          </div>
        </div>
      </section>

      {/* Packet & Process Logs */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] overflow-hidden shadow-xs dark:shadow-none">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-[#1F2937] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {(
              [
                ['dry-run', `Dry-Run Packet Log (${diag?.dryRunLog.length ?? 0})`],
                ['serial', `Serial TX/RX Log (${diag?.serialLogs.length ?? 0})`],
                ['asterctl', `asterctl Output (${aster?.logs.length ?? 0})`],
              ] as const
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                onClick={() => setActiveLogTab(tabId)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                  activeLogTab === tabId
                    ? 'bg-amber-500/15 border-amber-500/60 text-amber-800 dark:text-amber-300'
                    : 'bg-slate-50 dark:bg-[#0B0E14] border-slate-200 dark:border-[#1F2937] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {diag?.lastDryRunSummary && (
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              Last Dry Run: {diag.lastDryRunSummary.screenName} · {diag.lastDryRunSummary.totalChunks} chunks ·{' '}
              {diag.lastDryRunSummary.totalBytesOnWire.toLocaleString()} B · SHA256:{diag.lastDryRunSummary.frameSha256Short}
            </div>
          )}
        </div>

        <div className="max-h-[420px] overflow-auto">
          {activeLogTab === 'asterctl' ? (
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
                <tr>
                  <th className="py-2 px-4 font-medium w-44">Timestamp</th>
                  <th className="py-2 px-4 font-medium w-24">Stream</th>
                  <th className="py-2 px-4 font-medium">Output Line</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1A2130]">
                {aster && aster.logs.length > 0 ? (
                  aster.logs.map((entry, idx) => (
                    <tr key={`${entry.timestamp}-${idx}`} className="hover:bg-slate-50 dark:hover:bg-[#141A26]">
                      <td className="py-2 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                        {entry.timestamp.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td
                        className={`py-2 px-4 uppercase ${
                          entry.stream === 'stderr'
                            ? 'text-rose-600 dark:text-rose-400'
                            : entry.stream === 'system'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {entry.stream}
                      </td>
                      <td className="py-2 px-4 text-slate-800 dark:text-slate-200 break-all">{entry.line}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="py-8 px-4 text-center text-slate-500">
                      No asterctl process output captured yet. Click &ldquo;Test asterctl&rdquo; to verify binary &amp; simulate mode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
                <tr>
                  <th className="py-2 px-4 font-medium w-44">Timestamp</th>
                  <th className="py-2 px-4 font-medium w-24">Dir</th>
                  <th className="py-2 px-4 font-medium w-52">Packet / Event</th>
                  <th className="py-2 px-4 font-medium w-24 text-right">Bytes</th>
                  <th className="py-2 px-4 font-medium">Hex Preview / Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-[#1A2130]">
                {((activeLogTab === 'dry-run' ? diag?.dryRunLog : diag?.serialLogs) ?? []).length > 0 ? (
                  ((activeLogTab === 'dry-run' ? diag?.dryRunLog : diag?.serialLogs) ?? []).map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-[#141A26]">
                      <td className="py-2 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                        {entry.timestamp.replace('T', ' ').slice(0, 19)}
                      </td>
                      <td
                        className={`py-2 px-4 font-semibold ${
                          entry.direction === 'ERROR'
                            ? 'text-rose-600 dark:text-rose-400'
                            : entry.direction === 'RX'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : entry.direction === 'DRY_RUN'
                                ? 'text-sky-600 dark:text-sky-400'
                                : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {entry.direction}
                      </td>
                      <td className="py-2 px-4 text-slate-800 dark:text-slate-200">{entry.label}</td>
                      <td className="py-2 px-4 text-right text-slate-700 dark:text-slate-300 tabular-nums">
                        {entry.byteCount}
                      </td>
                      <td className="py-2 px-4 break-all">
                        {entry.hexPreview ? (
                          <span className="text-slate-700 dark:text-slate-300">{entry.hexPreview}</span>
                        ) : null}
                        {entry.error ? (
                          <span className="block text-rose-600 dark:text-rose-400">{entry.error}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 px-4 text-center text-slate-500">
                      {activeLogTab === 'dry-run'
                        ? 'No dry-run packets recorded yet. Click "Dry run" above to inspect exact aoostar-rs framing safely.'
                        : 'No serial transactions recorded yet.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Confirmation Modal for Physical LCD Writes */}
      {confirmMode && (
        <div
          onClick={() => setConfirmMode(null)}
          className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start gap-3 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                  {confirmMode === 'display-on'
                    ? 'Confirm Safe DISPLAY_ON Test?'
                    : 'Confirm Sending Test Frame to Physical LCD?'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  Serial writes can affect the physical LCD. This will open{' '}
                  <code className="font-mono">{diag?.detectedDevicePath || '/dev/ttyACM0'}</code> and transmit verified{' '}
                  <code className="font-mono">aoostar-rs</code>{' '}
                  {confirmMode === 'display-on' ? 'DISPLAY_ON (AA 55 AA 55 0B 00 00 00) + ACK check' : '960×376 calibration pattern packets'}.
                </p>
              </div>
            </div>

            {!diag?.serialWritesEnabled && (
              <div className="p-3 rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300">
                <span className="font-semibold">Blocked by safety env:</span>{' '}
                <code className="font-mono">AOOSTAR_ENABLE_SERIAL_WRITES=false</code>. Enabling it in container env is required before the server allows any serial write.
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setConfirmMode(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-700 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmedSafeTest()}
                className="px-3.5 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold"
              >
                {confirmMode === 'display-on' ? 'Run DISPLAY_ON Check' : 'Confirm & Send Test Frame'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
