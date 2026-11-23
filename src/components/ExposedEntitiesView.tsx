import {useMemo, useState} from 'react';
import {BarChart3, Gauge, Hash, Search} from 'lucide-react';
import {createWidgetFromType} from '../presets.ts';
import type {ExposedEntity, StudioConfig, WidgetType} from '../types.ts';

interface ExposedEntitiesViewProps {
  config: StudioConfig;
  exposedEntities: ExposedEntity[];
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  onNavigateToScreens: () => void;
}

export function ExposedEntitiesView({
  config,
  exposedEntities,
  onUpdateConfig,
  onNavigateToScreens,
}: ExposedEntitiesViewProps) {
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'server' | 'home_assistant' | 'custom_http'>('all');

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

  const addWidgetForEntity = (entity: ExposedEntity, type: WidgetType) => {
    const widget = createWidgetFromType(type, 24, 24);
    widget.title = entity.tag;
    widget.entityId = entity.id;
    widget.entityIds = [entity.id];
    onUpdateConfig((prev) => ({
      ...prev,
      screens: prev.screens.map((s) =>
        s.id === prev.activeScreenId ? {...s, widgets: [...s.widgets, widget]} : s
      ),
    }));
    onNavigateToScreens();
  };

  return (
    <div className="max-w-[1280px] mx-auto p-6 space-y-6">
      <div className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-5 flex flex-wrap items-center justify-between gap-4 shadow-xs dark:shadow-none">
        <div>
          <h1 className="text-lg font-display font-semibold text-slate-900 dark:text-slate-100">
            Exposed Entities &amp; Tags
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            All live values collected from your server, Home Assistant, and custom connections. Rename tags or units here and assign any entity to a number, graph, or gauge on your Screens.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
                ['server', 'Server'],
                ['home_assistant', 'Home Assistant'],
                ['custom_http', 'Custom'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
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
      </div>

      <div
        data-guide="entities-table"
        className="rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] overflow-hidden shadow-xs dark:shadow-none"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-[#0B0E14] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-[#1F2937]">
              <tr>
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
                return (
                  <tr key={entity.id} className="hover:bg-slate-50 dark:hover:bg-[#141A26]">
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-800 dark:text-slate-200">{entity.id}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {entity.source === 'server'
                          ? 'Server Stats'
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
                              onClick={() => addWidgetForEntity(entity, 'apex_area')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-sky-500/60"
                              title="Add as ApexCharts Area Graph"
                            >
                              <BarChart3 className="w-3 h-3 text-sky-600 dark:text-sky-400" />
                              Graph
                            </button>
                            <button
                              onClick={() => addWidgetForEntity(entity, 'apex_radial')}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 dark:bg-[#161E2E] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200 hover:border-emerald-500/60"
                              title="Add as ApexCharts Radial Gauge"
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
                  <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                    No exposed entities match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
