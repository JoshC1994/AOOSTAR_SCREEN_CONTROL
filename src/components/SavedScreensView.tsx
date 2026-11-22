import {Edit3, Trash2} from 'lucide-react';
import type {LcdScreen, SavedScreen, StudioConfig} from '../types.ts';

interface SavedScreensViewProps {
  config: StudioConfig;
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  onNavigateToScreens: () => void;
}

type UnifiedScreenRow =
  | {
      kind: 'playlist';
      key: string;
      screen: LcdScreen;
      active: boolean;
    }
  | {
      kind: 'library';
      key: string;
      saved: SavedScreen;
      screen: LcdScreen;
      active: false;
    };

export function SavedScreensView({
  config,
  onUpdateConfig,
  onNavigateToScreens,
}: SavedScreensViewProps) {
  const savedScreens = config.savedScreens ?? [];

  const rows: UnifiedScreenRow[] = [
    ...config.screens.map(
      (screen): UnifiedScreenRow => ({
        kind: 'playlist',
        key: `playlist-${screen.id}`,
        screen,
        active: screen.enabled,
      })
    ),
    ...savedScreens
      .filter(
        (saved) =>
          !config.screens.some(
            (s) =>
              s.id === saved.screen.id ||
              s.name.trim().toLowerCase() === saved.name.trim().toLowerCase()
          )
      )
      .map(
        (saved): UnifiedScreenRow => ({
          kind: 'library',
          key: `library-${saved.id}`,
          saved,
          screen: saved.screen,
          active: false,
        })
      ),
  ];

  const activeCount = config.screens.filter((s) => s.enabled).length;

  const handleToggleActive = (row: UnifiedScreenRow) => {
    if (row.kind === 'playlist') {
      onUpdateConfig((prev) => {
        const nextScreens = prev.screens.map((s) =>
          s.id === row.screen.id ? {...s, enabled: !s.enabled} : s
        );
        const firstEnabledId = nextScreens.find((s) => s.enabled)?.id ?? '';
        const nextActiveId =
          prev.activeScreenId === row.screen.id && row.screen.enabled
            ? firstEnabledId
            : !prev.activeScreenId
              ? firstEnabledId
              : prev.activeScreenId;
        return {
          ...prev,
          screens: nextScreens,
          activeScreenId: nextActiveId,
        };
      });
      return;
    }

    const cloned: LcdScreen = {
      ...structuredClone(row.saved.screen),
      id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: row.saved.name,
      enabled: true,
    };
    onUpdateConfig((prev) => ({
      ...prev,
      screens: [...prev.screens, cloned],
      activeScreenId: prev.activeScreenId || cloned.id,
    }));
  };

  const handleEdit = (row: UnifiedScreenRow) => {
    if (row.kind === 'playlist') {
      onUpdateConfig((prev) => ({...prev, activeScreenId: row.screen.id}));
      onNavigateToScreens();
      return;
    }

    const cloned: LcdScreen = {
      ...structuredClone(row.saved.screen),
      id: `scr-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      name: row.saved.name,
      enabled: true,
    };
    onUpdateConfig((prev) => ({
      ...prev,
      screens: [...prev.screens, cloned],
      activeScreenId: cloned.id,
    }));
    onNavigateToScreens();
  };

  const handleDelete = (row: UnifiedScreenRow) => {
    if (row.kind === 'library') {
      onUpdateConfig((prev) => ({
        ...prev,
        savedScreens: (prev.savedScreens ?? []).filter((item) => item.id !== row.saved.id),
      }));
      return;
    }

    if (config.screens.length <= 1) return;

    onUpdateConfig((prev) => {
      const remaining = prev.screens.filter((s) => s.id !== row.screen.id);
      const nextSaved = (prev.savedScreens ?? []).filter(
        (item) =>
          item.screen.id !== row.screen.id &&
          item.name.trim().toLowerCase() !== row.screen.name.trim().toLowerCase()
      );
      return {
        ...prev,
        screens: remaining,
        savedScreens: nextSaved,
        activeScreenId:
          prev.activeScreenId === row.screen.id ? remaining[0].id : prev.activeScreenId,
      };
    });
  };

  return (
    <div className="max-w-[1280px] mx-auto p-6">
      <section className="rounded-lg border border-[#1F2937] bg-[#0F131C] p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-display font-semibold text-slate-100">
              Saved Screens ({activeCount} active)
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Active screens rotate on the Aoostar display when you click Push to Screen in the top bar.
            </p>
          </div>
          {config.hardwareDeploy?.deployedAt && (
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              Last pushed {new Date(config.hardwareDeploy.deployedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        <div className="divide-y divide-[#1A2130] border border-[#1F2937] rounded-md bg-[#0B0E14]">
          {rows.map((row, idx) => {
            const canDelete = row.kind === 'library' || config.screens.length > 1;
            const displayName = row.kind === 'library' ? row.saved.name : row.screen.name;
            return (
              <div key={row.key} className="px-4 py-2.5 flex items-center justify-between gap-4 text-xs">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-slate-500 w-5 tabular-nums">{idx + 1}.</span>
                  <span className="font-medium text-slate-200 truncate">{displayName}</span>
                  <span className="text-slate-500 font-mono tabular-nums whitespace-nowrap">
                    {row.screen.durationSec}s · {row.screen.widgets.length} blocks
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleToggleActive(row)}
                    className={`px-2.5 py-1 rounded border text-[11px] font-medium transition-colors ${
                      row.active
                        ? 'border-emerald-700/50 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
                        : 'border-[#263042] bg-[#121824] text-slate-400 hover:text-slate-200 hover:border-slate-500'
                    }`}
                  >
                    {row.active ? 'Active' : 'Paused'}
                  </button>
                  <button
                    onClick={() => handleEdit(row)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-[#263042] bg-[#141A26] text-[11px] text-slate-200 hover:border-amber-500/60 transition-colors"
                  >
                    <Edit3 className="w-3 h-3" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(row)}
                    disabled={!canDelete}
                    title={
                      canDelete
                        ? 'Delete screen'
                        : 'At least one screen must remain available'
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-red-900/40 bg-red-950/20 text-[11px] text-red-300 hover:bg-red-900/40 disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
