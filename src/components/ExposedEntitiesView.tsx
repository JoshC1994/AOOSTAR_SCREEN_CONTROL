import {useMemo, useState} from 'react';
import {
  BarChart3,
  CheckCircle2,
  Gauge,
  Globe,
  Hash,
  Home,
  List,
  Plus,
  Search,
  Server,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {createWidgetFromType} from '../presets.ts';
import type {ExposedEntity, StudioConfig, TelemetrySnapshot, WidgetType} from '../types.ts';
import {AddConnectionWizardModal} from './AddConnectionWizardModal.tsx';

interface ExposedEntitiesViewProps {
  config: StudioConfig;
  telemetry: TelemetrySnapshot | null;
  haConnected: boolean;
  exposedEntities: ExposedEntity[];
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  onRefreshAll: () => Promise<void>;
  onNavigateToScreens: (options?: {edit?: boolean}) => void;
  onOpenSettingsConnections?: () => void;
}

export function ExposedEntitiesView({
  config,
  telemetry,
  haConnected,
  exposedEntities,
  onUpdateConfig,
  onRefreshAll,
  onNavigateToScreens,
  onOpenSettingsConnections,
}: ExposedEntitiesViewProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'server' | 'home_assistant' | 'custom_http'>('all');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardKind, setWizardKind] = useState<'home_assistant' | 'custom_http' | 'host_sensors' | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [targetScreenId, setTargetScreenId] = useState<string>(
    config.activeScreenId || config.screens[0]?.id || ''
  );

  const effectiveTargetScreenId = useMemo(() => {
    if (config.screens.some((s) => s.id === targetScreenId)) return targetScreenId;
    return config.activeScreenId || config.screens[0]?.id || '';
  }, [config.activeScreenId, config.screens, targetScreenId]);

  const filtered = useMemo(() => {
    return exposedEntities.filter((e) => {
      if (sourceFilter !== 'all' && e.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.id.toLowerCase().includes(q) && !e.tag.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [exposedEntities, search, sourceFilter]);

  const selectedEntities = useMemo(
    () => exposedEntities.filter((e) => selectedIds.includes(e.id)),
    [exposedEntities, selectedIds]
  );

  const selectedNumericCount = useMemo(
    () => selectedEntities.filter((e) => e.numericValue !== null).length,
    [selectedEntities]
  );

  const updateOverride = (id: string, patch: {tag?: string; unit?: string; enabled?: boolean}) => {
    onUpdateConfig((prev) => ({
      ...prev,
      entityOverrides: {
        ...prev.entityOverrides,
        [id]: {
          ...(prev.entityOverrides[id] || {}),
          ...patch,
        },
      },
    }));
  };

  const toggleSelectEntity = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const addWidgetForEntity = (entity: ExposedEntity, type: WidgetType) => {
    const widget = createWidgetFromType(type, 24, 24);
    widget.title = entity.tag;
    widget.entityId = entity.id;
    widget.entityIds = [entity.id];
    const destId = effectiveTargetScreenId;
    onUpdateConfig((prev) => ({
      ...prev,
      activeScreenId: destId || prev.activeScreenId,
      screens: prev.screens.map((s) =>
        s.id === (destId || prev.activeScreenId) ? {...s, widgets: [...s.widgets, widget]} : s
      ),
    }));
    onNavigateToScreens({edit: true});
  };

  const addMultiEntityWidget = (type: 'apex_area' | 'apex_bar' | 'entity_list') => {
    const pool =
      type === 'entity_list'
        ? selectedEntities
        : selectedEntities.filter((e) => e.numericValue !== null);
    if (pool.length === 0) return;

    const widget = createWidgetFromType(type, 24, 24);
    widget.w = type === 'entity_list' ? 360 : 440;
    widget.h = type === 'entity_list' ? 220 : 210;
    widget.entityIds = pool.map((e) => e.id);
    widget.entityId = pool[0].id;
    widget.title =
      pool.length === 1
        ? pool[0].tag
        : pool
            .slice(0, 2)
            .map((e) => e.tag)
            .join(' · ') + (pool.length > 2 ? ` +${pool.length - 2}` : '');

    const destId = effectiveTargetScreenId;
    onUpdateConfig((prev) => ({
      ...prev,
      activeScreenId: destId || prev.activeScreenId,
      screens: prev.screens.map((s) =>
        s.id === (destId || prev.activeScreenId) ? {...s, widgets: [...s.widgets, widget]} : s
      ),
    }));
    setSelectedIds([]);
    onNavigateToScreens({edit: true});
  };

  const openWizard = (kind: 'home_assistant' | 'custom_http' | 'host_sensors' | null = null) => {
    setWizardKind(kind);
    setWizardOpen(true);
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

  const haCount = exposedEntities.filter((e) => e.source === 'home_assistant').length;
  const customCount = config.integrations.customConnections.length;

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-5">
      {/* Unified Header + Add Connection Action */}
      <section className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
              Entities &amp; Connections
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Connect local data sources, customize entity names or units, and place single metrics or multi-series graphs directly onto your screens.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onOpenSettingsConnections && (
              <button
                type="button"
                onClick={onOpenSettingsConnections}
                className="px-3 py-2 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 transition-colors whitespace-nowrap"
              >
                Manage in Settings
              </button>
            )}
            <button
              type="button"
              data-guide="add-connection-btn"
              onClick={() => openWizard(null)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Connection
            </button>
          </div>
        </div>

        {/* Connected Sources Summary Row */}
        <div
          data-guide="connections-grid"
          className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3 border-t border-slate-200 dark:border-[#1F2937]"
        >
          <button
            type="button"
            onClick={() => openWizard('host_sensors')}
            className="text-left p-3 rounded-md border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] hover:border-emerald-500/50 transition-colors flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Server className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Host Telemetry
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {telemetry?.sourceLabel || 'Local Collector Active'}
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 shrink-0">
              Active
            </span>
          </button>

          <button
            type="button"
            onClick={() => openWizard('home_assistant')}
            className="text-left p-3 rounded-md border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] hover:border-sky-500/50 transition-colors flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Home className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Home Assistant
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {config.integrations.haUrl || 'Click to connect local instance'}
                </div>
              </div>
            </div>
            <span
              className={`text-[11px] font-mono shrink-0 ${
                haConnected
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {haConnected ? `${haCount} entities` : config.integrations.haEnabled ? 'Pending' : 'Setup'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => openWizard('custom_http')}
            className="text-left p-3 rounded-md border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#0B0E14] hover:border-amber-500/50 transition-colors flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Globe className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Custom HTTP / JSON
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Pi-hole, Tautulli, Solar, UPS, local APIs
                </div>
              </div>
            </div>
            <span className="text-[11px] font-mono text-amber-600 dark:text-amber-400 shrink-0 tabular-nums">
              {customCount > 0 ? `${customCount} active` : '+ Add'}
            </span>
          </button>
        </div>

        {/* Inline custom connections chips for fast remove when present */}
        {config.integrations.customConnections.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {config.integrations.customConnections.map((cc) => (
              <div
                key={cc.id}
                className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-slate-200 dark:border-[#263042] bg-slate-50 dark:bg-[#121824] text-[11px]"
              >
                <CheckCircle2
                  className={`w-3 h-3 shrink-0 ${
                    cc.lastError ? 'text-amber-500' : 'text-emerald-500'
                  }`}
                />
                <span className="font-medium text-slate-800 dark:text-slate-200">{cc.name}</span>
                <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                  {cc.lastError ? 'error' : `${cc.lastValue ?? '—'}${cc.unit ? ` ${cc.unit}` : ''}`}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveCustom(cc.id)}
                  title={`Remove ${cc.name}`}
                  className="text-slate-400 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Filter + Easy Graph & Screen Target Bar */}
      <div className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter entities or tags..."
              className="pl-8 pr-3 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="flex items-center p-0.5 rounded bg-slate-100 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#1F2937]">
            {(
              [
                ['all', 'All'],
                ['server', 'Host'],
                ['home_assistant', 'Home Assistant'],
                ['custom_http', 'Custom'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setSourceFilter(key)}
                className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  sourceFilter === key
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Place onto Screen:
          </label>
          <select
            value={effectiveTargetScreenId}
            onChange={(e) => setTargetScreenId(e.target.value)}
            className="px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
          >
            {config.screens.map((scr, idx) => (
              <option key={scr.id} value={scr.id}>
                {idx + 1}. {scr.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Multi-Entity Graph Builder Action Strip */}
      {selectedIds.length > 0 && (
        <div className="rounded-lg border border-amber-400/60 dark:border-amber-600/50 bg-amber-50 dark:bg-amber-950/25 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-amber-950 dark:text-amber-200 font-medium">
            <span className="font-mono font-bold tabular-nums">{selectedIds.length}</span>{' '}
            {selectedIds.length === 1 ? 'entity' : 'entities'} selected — combine into one card on your target screen:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selectedNumericCount === 0}
              onClick={() => addMultiEntityWidget('apex_area')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold disabled:opacity-40"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Build Area Graph ({selectedNumericCount})
            </button>
            <button
              type="button"
              disabled={selectedNumericCount === 0}
              onClick={() => addMultiEntityWidget('apex_bar')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60 disabled:opacity-40"
            >
              <BarChart3 className="w-3.5 h-3.5 text-sky-500" />
              Build Bar Chart ({selectedNumericCount})
            </button>
            <button
              type="button"
              onClick={() => addMultiEntityWidget('entity_list')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#141A26] text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-amber-500/60"
            >
              <List className="w-3.5 h-3.5 text-emerald-500" />
              Build List ({selectedIds.length})
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Entities Table */}
      <div
        data-guide="entities-table"
        className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] overflow-hidden shadow-xs dark:shadow-none"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
              <tr>
                <th className="py-3 px-3 w-9 text-center" title="Select multiple entities to build a graph or list">
                  <span className="sr-only">Select</span>
                </th>
                <th className="py-3 px-4 font-medium">Entity ID (Use in {"{{...}}"})</th>
                <th className="py-3 px-4 font-medium">Custom Tag / Label</th>
                <th className="py-3 px-4 font-medium w-24">Unit</th>
                <th className="py-3 px-4 font-medium text-right">Live Value</th>
                <th className="py-3 px-4 font-medium text-center">Active</th>
                <th className="py-3 px-4 font-medium text-right">Place on Screen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-[#1A2130]">
              {filtered.map((entity) => {
                const override = config.entityOverrides[entity.id] || {};
                const isNumeric = entity.numericValue !== null;
                const isSelected = selectedIds.includes(entity.id);
                return (
                  <tr
                    key={entity.id}
                    className={`hover:bg-slate-50 dark:hover:bg-[#141A26] ${
                      isSelected ? 'bg-amber-50/50 dark:bg-amber-950/15' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectEntity(entity.id)}
                        aria-label={`Select ${entity.tag} for multi-entity graph`}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-800 dark:text-slate-200">{entity.id}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {entity.source === 'server'
                          ? 'Host Stats'
                          : entity.source === 'home_assistant'
                            ? 'Home Assistant'
                            : 'Custom Connection'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={override.tag ?? entity.tag}
                        onChange={(e) => updateOverride(entity.id, {tag: e.target.value})}
                        className="w-full max-w-[220px] px-2.5 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="text"
                        value={override.unit ?? entity.unit}
                        onChange={(e) => updateOverride(entity.id, {unit: e.target.value})}
                        className="w-20 px-2 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="py-2.5 px-4 font-mono text-right tabular-nums text-amber-600 dark:text-amber-300 font-medium">
                      {String(entity.rawValue)}
                      {entity.unit ? <span className="text-slate-500 dark:text-slate-400 ml-1">{entity.unit}</span> : null}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <input
                        type="checkbox"
                        checked={entity.enabled}
                        onChange={(e) => updateOverride(entity.id, {enabled: e.target.checked})}
                        className="accent-amber-500 cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => addWidgetForEntity(entity, 'entity_number')}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-amber-500/60"
                          title="Add as Numerical Readout"
                        >
                          <Hash className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                          Number
                        </button>
                        {isNumeric && (
                          <>
                            <button
                              type="button"
                              onClick={() => addWidgetForEntity(entity, 'apex_area')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-sky-500/60"
                              title="Add as Area / Line Graph"
                            >
                              <BarChart3 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                              Graph
                            </button>
                            <button
                              type="button"
                              onClick={() => addWidgetForEntity(entity, 'apex_radial')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-emerald-500/60"
                              title="Add as Radial Gauge"
                            >
                              <Gauge className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              Gauge
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 px-4 text-center text-slate-500">
                    {sourceFilter === 'home_assistant' && !search
                      ? 'No Home Assistant entities exposed yet. Click "+ Add Connection" above to link Home Assistant.'
                      : 'No exposed entities match your search.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <AddConnectionWizardModal
        open={wizardOpen}
        initialKind={wizardKind}
        config={config}
        telemetry={telemetry}
        onClose={() => setWizardOpen(false)}
        onUpdateConfig={onUpdateConfig}
        onRefreshAll={onRefreshAll}
      />
    </div>
  );
}
