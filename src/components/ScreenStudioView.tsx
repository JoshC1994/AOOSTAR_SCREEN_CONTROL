import {useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Code2,
  Copy,
  Eye,
  Grid,
  Image as ImageIcon,
  Pause,
  Pencil,
  Play,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  BLOCK_SIZE_PRESETS,
  createWidgetFromType,
  DEFAULT_APEX_CODE,
  DEFAULT_HTML_CODE,
  LCD_HEIGHT,
  LCD_THEMES,
  LCD_WIDTH,
  PREMADE_SCREENS,
  PRESET_BACKGROUNDS,
  WIDGET_CATALOG,
} from '../presets.ts';
import type {
  ExposedEntity,
  FontFamilyOption,
  FontSizePreset,
  HomeAssistantEntity,
  LcdScreen,
  LcdTheme,
  ScreenWidget,
  StudioConfig,
  TelemetrySnapshot,
  WidgetType,
} from '../types.ts';
import {apiFetch} from '../utils/apiClient.ts';
import {isScreenUnsaved, upsertSavedScreen} from '../utils/screenSave.ts';
import {LcdWidgetRenderer} from './LcdWidgetRenderer.tsx';

interface ScreenStudioViewProps {
  config: StudioConfig;
  telemetry: TelemetrySnapshot | null;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  onUpdateConfig: (updater: (prev: StudioConfig) => StudioConfig) => void;
  editTrigger?: number;
  onNavigateToRotationSettings?: () => void;
}

const SNAP_GRID = 8;
const snap = (val: number) => Math.round(val / SNAP_GRID) * SNAP_GRID;

const ACCENT_SWATCHES = ['#F59E0B', '#10B981', '#38BDF8', '#A78BFA', '#F43F5E', '#F8FAFC'];
const BG_SWATCHES = ['#0F1520', '#0B0E14', '#171F2E', '#1E1B2E', '#0F241D', '#000000'];
const TEXT_SWATCHES = ['#F8FAFC', '#CBD5E1', '#94A3B8', '#F59E0B', '#38BDF8', '#10B981'];
const QUICK_DURATIONS = [10, 15, 30, 60];
const CATALOG_CATEGORIES = ['Generic Blocks', 'Custom Code & Media', 'System Lists'] as const;

const APEX_SNIPPETS = {
  area: DEFAULT_APEX_CODE,
  radial: `{
  "chart": { "type": "radialBar" },
  "colors": ["#10B981"],
  "series": ["{{server.ram_percent}}"],
  "labels": ["RAM Used"],
  "plotOptions": {
    "radialBar": {
      "hollow": { "size": "58%" },
      "dataLabels": {
        "name": { "color": "#94A3B8", "fontSize": "11px" },
        "value": { "color": "#F8FAFC", "fontSize": "20px" }
      }
    }
  }
}`,
  bar: `{
  "chart": { "type": "bar" },
  "colors": ["#38BDF8"],
  "series": [
    { "name": "Temp C", "data": [37, 36, 38, 44, 46] }
  ],
  "xaxis": {
    "categories": ["Parity", "D1", "D2", "NVMe0", "NVMe1"],
    "labels": { "style": { "colors": "#94A3B8" } }
  },
  "grid": { "borderColor": "rgba(148,163,184,0.12)" }
}`,
};

export function ScreenStudioView({
  config,
  telemetry,
  haEntities,
  exposedEntities,
  onUpdateConfig,
  editTrigger = 0,
  onNavigateToRotationSettings,
}: ScreenStudioViewProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [testRotating, setTestRotating] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<'widgets' | 'themes' | 'photos'>('widgets');
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [addScreenStep, setAddScreenStep] = useState<'menu' | 'saved' | 'templates'>('menu');
  const [showAdvancedWidget, setShowAdvancedWidget] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [fitScale, setFitScale] = useState(0.84);
  const [cycleRemainingSec, setCycleRemainingSec] = useState<number>(0);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [pendingDeleteScreen, setPendingDeleteScreen] = useState<LcdScreen | null>(null);
  const [pendingDeleteName, setPendingDeleteName] = useState('');
  const [serverPreviewUrl, setServerPreviewUrl] = useState<string | null>(null);
  const [loadingServerPreview, setLoadingServerPreview] = useState(false);

  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const widgetFileInputRef = useRef<HTMLInputElement | null>(null);
  const blockBgFileInputRef = useRef<HTMLInputElement | null>(null);
  const dockerIconFileInputRef = useRef<HTMLInputElement | null>(null);
  const dockerUploadTargetRef = useRef<string | null>(null);

  const enabledScreens = useMemo(
    () => config.screens.filter((s) => s.enabled),
    [config.screens]
  );

  const activeScreen = useMemo(
    () => config.screens.find((s) => s.id === config.activeScreenId) ?? enabledScreens[0],
    [config.screens, enabledScreens, config.activeScreenId]
  );

  const selectedWidget = useMemo(
    () => activeScreen?.widgets.find((w) => w.id === selectedWidgetId) ?? null,
    [activeScreen, selectedWidgetId]
  );

  useEffect(() => {
    if (editTrigger > 0) {
      setIsEditing(true);
      setTestRotating(false);
    }
  }, [editTrigger]);

  useEffect(() => {
    const updateScale = () => {
      const el = stageContainerRef.current;
      if (!el) return;
      const availW = Math.max(360, el.clientWidth - 72);
      const scale = Math.min(1, availW / LCD_WIDTH);
      setFitScale(Number(scale.toFixed(3)));
    };
    updateScale();
    const ro = new ResizeObserver(updateScale);
    if (stageContainerRef.current) ro.observe(stageContainerRef.current);
    return () => ro.disconnect();
  }, [isEditing]);

  useEffect(() => {
    if (!testRotating || !activeScreen || !activeScreen.enabled || enabledScreens.length === 0) {
      setCycleRemainingSec(0);
      return;
    }

    let remaining = activeScreen.durationSec;
    setCycleRemainingSec(remaining);

    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        const idx = enabledScreens.findIndex((s) => s.id === activeScreen.id);
        const next = enabledScreens[(idx + 1) % enabledScreens.length];
        onUpdateConfig((prev) => ({...prev, activeScreenId: next.id}));
        setSelectedWidgetId(null);
        remaining = next.durationSec;
      }
      setCycleRemainingSec(remaining);
    }, 1000);

    return () => clearInterval(timer);
  }, [testRotating, enabledScreens, activeScreen?.id, activeScreen?.enabled, activeScreen?.durationSec]);

  const updateActiveScreen = (updater: (scr: LcdScreen) => LcdScreen) => {
    if (!activeScreen) return;
    onUpdateConfig((prev) => ({
      ...prev,
      screens: prev.screens.map((s) => (s.id === activeScreen.id ? updater(s) : s)),
    }));
  };

  const updateWidget = (widgetId: string, patch: Partial<ScreenWidget>) => {
    updateActiveScreen((scr) => ({
      ...scr,
      widgets: scr.widgets.map((w) => (w.id === widgetId ? {...w, ...patch} : w)),
    }));
  };

  const dragOpRef = useRef<{
    mode: 'move' | 'resize';
    widgetId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);
  const justDraggedRef = useRef(false);

  const handleWidgetPointerDown = (
    e: PointerEvent,
    widget: ScreenWidget,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    setSelectedWidgetId(widget.id);
    justDraggedRef.current = false;

    const op = {
      mode,
      widgetId: widget.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: widget.x,
      origY: widget.y,
      origW: widget.w,
      origH: widget.h,
    };
    dragOpRef.current = op;

    const onMove = (ev: globalThis.PointerEvent) => {
      const rawDx = ev.clientX - op.startX;
      const rawDy = ev.clientY - op.startY;
      if (Math.abs(rawDx) > 3 || Math.abs(rawDy) > 3) {
        justDraggedRef.current = true;
      }
      const dx = rawDx / fitScale;
      const dy = rawDy / fitScale;

      if (op.mode === 'move') {
        const nextX = Math.max(0, Math.min(LCD_WIDTH - op.origW, snap(op.origX + dx)));
        const nextY = Math.max(0, Math.min(LCD_HEIGHT - op.origH, snap(op.origY + dy)));
        updateWidget(op.widgetId, {x: nextX, y: nextY});
      } else {
        const nextW = Math.max(80, Math.min(LCD_WIDTH - op.origX, snap(op.origW + dx)));
        const nextH = Math.max(24, Math.min(LCD_HEIGHT - op.origY, snap(op.origH + dy)));
        updateWidget(op.widgetId, {w: nextW, h: nextH});
      }
    };

    const onUp = () => {
      dragOpRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (justDraggedRef.current) {
        window.setTimeout(() => {
          justDraggedRef.current = false;
        }, 50);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleCanvasDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const widgetType = e.dataTransfer.getData('application/x-aoostar-widget') as WidgetType;
    if (!widgetType || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const rawX = (e.clientX - rect.left) / fitScale;
    const rawY = (e.clientY - rect.top) / fitScale;
    const created = createWidgetFromType(widgetType, 0, 0);
    created.x = Math.max(0, Math.min(LCD_WIDTH - created.w, snap(rawX - created.w / 2)));
    created.y = Math.max(0, Math.min(LCD_HEIGHT - created.h, snap(rawY - created.h / 2)));
    updateActiveScreen((scr) => ({...scr, widgets: [...scr.widgets, created]}));
    setSelectedWidgetId(created.id);
  };

  const handleAddWidgetClick = (type: WidgetType) => {
    const created = createWidgetFromType(type, 24, 24);
    updateActiveScreen((scr) => ({...scr, widgets: [...scr.widgets, created]}));
    setSelectedWidgetId(created.id);
  };

  const handleAddFromPreset = (preset: LcdScreen) => {
    const id = `scr-${Date.now()}`;
    const cloned: LcdScreen = {
      ...structuredClone(preset),
      id,
      name: `${preset.name}`,
      enabled: true,
    };
    onUpdateConfig((prev) => ({
      ...prev,
      screens: [...prev.screens, cloned],
      activeScreenId: id,
    }));
    setSelectedWidgetId(null);
    setShowTemplateModal(false);
  };

  const handleCreateBlankScreen = () => {
    const id = `scr-${Date.now()}`;
    const newScreen: LcdScreen = {
      id,
      name: `Screen ${config.screens.length + 1}`,
      enabled: true,
      durationSec: 15,
      transition: 'fade',
      backgroundType: 'solid',
      backgroundColor: '#0B0E14',
      backgroundDim: 0,
      widgets: [],
    };
    onUpdateConfig((prev) => ({
      ...prev,
      screens: [...prev.screens, newScreen],
      activeScreenId: id,
    }));
    setSelectedWidgetId(null);
    setShowTemplateModal(false);
  };

  const handleMoveScreen = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= config.screens.length) return;
    onUpdateConfig((prev) => {
      const next = [...prev.screens];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return {...prev, screens: next};
    });
  };

  const performDeleteScreen = (id: string) => {
    if (config.screens.length <= 1) return;
    onUpdateConfig((prev) => {
      const remaining = prev.screens.filter((s) => s.id !== id);
      const nextActive = remaining.find((s) => s.enabled)?.id ?? remaining[0]?.id ?? '';
      return {
        ...prev,
        screens: remaining,
        activeScreenId: prev.activeScreenId === id ? nextActive : prev.activeScreenId,
      };
    });
    setSelectedWidgetId(null);
  };

  const handleDeleteScreen = (id: string) => {
    if (config.screens.length <= 1) return;
    const target = config.screens.find((s) => s.id === id);
    if (!target) return;
    if (isScreenUnsaved(target, config.savedScreens ?? [])) {
      setPendingDeleteScreen(target);
      setPendingDeleteName(target.name);
      return;
    }
    performDeleteScreen(id);
  };

  const handleUploadMedia = async (
    file: File,
    destination:
      | {kind: 'library-only'}
      | {kind: 'screen-bg'}
      | {kind: 'widget-media'; widgetId: string}
      | {kind: 'widget-bg'; widgetId: string}
      | {kind: 'docker-icon'; containerName: string}
  ) => {
    setUploadingImage(true);
    setUploadError(null);
    try {
      const initRes = await apiFetch('/api/uploads/init', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: file.name, mimeType: file.type}),
      });
      if (!initRes.ok) {
        const errPayload = (await initRes.json().catch(() => ({}))) as {error?: string};
        setUploadError(errPayload.error || `Upload failed (HTTP ${initRes.status})`);
        return;
      }
      const {uploadId} = (await initRes.json()) as {uploadId: string};

      const CHUNK_SIZE = 2 * 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        const chunk = file.slice(offset, offset + CHUNK_SIZE);
        const chunkRes = await apiFetch(`/api/uploads/chunk/${encodeURIComponent(uploadId)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/octet-stream'},
          body: chunk,
        });
        if (!chunkRes.ok) {
          const errPayload = (await chunkRes.json().catch(() => ({}))) as {error?: string};
          setUploadError(errPayload.error || `Upload chunk failed (HTTP ${chunkRes.status})`);
          return;
        }
      }

      const finishRes = await apiFetch(`/api/uploads/finish/${encodeURIComponent(uploadId)}`, {
        method: 'POST',
      });
      if (!finishRes.ok) {
        const errPayload = (await finishRes.json().catch(() => ({}))) as {error?: string};
        setUploadError(errPayload.error || `Upload finalize failed (HTTP ${finishRes.status})`);
        return;
      }
      const record = (await finishRes.json()) as {
        id: string;
        name: string;
        url: string;
        mediaType?: 'image' | 'video';
        createdAt: string;
      };
      onUpdateConfig((prev) => {
        const nextCustomImages = [record, ...prev.customImages];
        if (destination.kind === 'library-only') {
          return {
            ...prev,
            customImages: nextCustomImages,
          };
        }
        if (destination.kind === 'docker-icon') {
          return {
            ...prev,
            customImages: nextCustomImages,
            dockerIcons: {
              ...prev.dockerIcons,
              [destination.containerName]: record.url,
            },
          };
        }
        return {
          ...prev,
          customImages: nextCustomImages,
          screens: prev.screens.map((s) => {
            if (s.id !== activeScreen?.id) return s;
            if (destination.kind === 'widget-media') {
              return {
                ...s,
                widgets: s.widgets.map((w) =>
                  w.id === destination.widgetId
                    ? {...w, imageUrl: record.url, mediaType: record.mediaType ?? 'image'}
                    : w
                ),
              };
            }
            if (destination.kind === 'widget-bg') {
              return {
                ...s,
                widgets: s.widgets.map((w) =>
                  w.id === destination.widgetId ? {...w, bgImageUrl: record.url} : w
                ),
              };
            }
            if (record.mediaType === 'video') {
              const mediaWidget = createWidgetFromType('image_layer', 24, 24);
              mediaWidget.title = record.name;
              mediaWidget.imageUrl = record.url;
              mediaWidget.mediaType = 'video';
              return {...s, widgets: [...s.widgets, mediaWidget]};
            }
            return {...s, backgroundType: 'image', backgroundImage: record.url};
          }),
        };
      });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Failed to import media file.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRenameMedia = (id: string, nextName: string) => {
    onUpdateConfig((prev) => ({
      ...prev,
      customImages: prev.customImages.map((item) =>
        item.id === id ? {...item, name: nextName} : item
      ),
    }));
  };

  const handleRemoveMedia = (id: string, url: string) => {
    onUpdateConfig((prev) => ({
      ...prev,
      customImages: prev.customImages.filter((item) => item.id !== id),
      screens: prev.screens.map((s) => ({
        ...s,
        backgroundImage: s.backgroundImage === url ? undefined : s.backgroundImage,
        backgroundType: s.backgroundImage === url ? 'solid' : s.backgroundType,
        widgets: s.widgets.map((w) => ({
          ...w,
          imageUrl: w.imageUrl === url ? undefined : w.imageUrl,
          bgImageUrl: w.bgImageUrl === url ? undefined : w.bgImageUrl,
        })),
      })),
    }));
    void apiFetch(`/api/uploads/${encodeURIComponent(id)}`, {method: 'DELETE'});
  };

  const handleOpenServerPreview = async () => {
    if (!activeScreen) return;
    setLoadingServerPreview(true);
    try {
      const url = `/api/hardware/preview.png?screenId=${encodeURIComponent(activeScreen.id)}&t=${Date.now()}`;
      const res = await apiFetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        setServerPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
      }
    } finally {
      setLoadingServerPreview(false);
    }
  };

  const applyThemeToActiveScreen = (theme: LcdTheme) => {
    updateActiveScreen((scr) => ({
      ...scr,
      themeId: theme.id,
      backgroundType: theme.backgroundType,
      backgroundColor: theme.backgroundColor,
      backgroundImage: theme.backgroundImage,
      backgroundDim: theme.backgroundDim,
      widgets: scr.widgets.map((w) => ({
        ...w,
        bgColor: theme.widgetBgColor,
        bgOpacity: theme.widgetBgOpacity,
        borderOpacity: theme.widgetBorderOpacity,
        textColor: theme.widgetTextColor,
        accentColor: theme.widgetAccentColor,
        fontFamily: theme.fontFamily,
      })),
    }));
  };

  const activeScreenIndex = activeScreen
    ? config.screens.findIndex((s) => s.id === activeScreen.id)
    : -1;
  const numericEntities = exposedEntities.filter((e) => e.enabled && e.numericValue !== null);
  const allEnabledEntities = exposedEntities.filter((e) => e.enabled);

  return (
    <div className="flex flex-col h-[calc(100vh-57px)] min-h-[660px] overflow-hidden">
      {/* Screen Carousel & Rotation Bar */}
      <div className="border-b border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0D111A] px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-2 overflow-x-auto py-0.5">
          {enabledScreens.map((scr, idx) => {
            const isActive = activeScreen ? scr.id === activeScreen.id : false;
            return (
              <div
                key={scr.id}
                className={`inline-flex items-center rounded-md border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-amber-50 dark:bg-[#1A2232] border-amber-500/70 text-slate-900 dark:text-slate-100'
                    : 'bg-slate-50 dark:bg-[#121722] border-slate-200 dark:border-[#1F2937] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <button
                  onClick={() => {
                    onUpdateConfig((prev) => ({...prev, activeScreenId: scr.id}));
                    setSelectedWidgetId(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium flex items-center gap-2 whitespace-nowrap"
                >
                  <span>{idx + 1}. {scr.name}</span>
                  <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                    {scr.durationSec}s
                  </span>
                </button>
              </div>
            );
          })}

          {enabledScreens.length === 0 && (
            <span className="text-xs text-slate-500 px-1 whitespace-nowrap">
              No active screens on rotation
            </span>
          )}

          <button
            data-guide="add-screen-btn"
            onClick={() => {
              setAddScreenStep('menu');
              setShowTemplateModal(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-slate-300 dark:border-slate-700 hover:border-amber-500/60 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-amber-700 dark:hover:text-amber-300 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Screen
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setTestRotating((prev) => !prev)}
            disabled={enabledScreens.length < 2}
            title="Preview screen cycling in your browser without changing hardware auto-rotate settings"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors whitespace-nowrap shrink-0 disabled:opacity-45 ${
              testRotating
                ? 'bg-sky-500/15 border-sky-500/50 text-sky-700 dark:text-sky-300'
                : 'bg-slate-100 dark:bg-[#141A26] border-slate-300 dark:border-[#263042] text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-[#1B2334]'
            }`}
          >
            {testRotating ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {testRotating ? `Stop Test (${cycleRemainingSec}s)` : 'Test Rotate'}
          </button>

          <button
            type="button"
            data-guide="edit-layout-btn"
            onClick={() => {
              setIsEditing((prev) => {
                const next = !prev;
                if (next) setTestRotating(false);
                else setSelectedWidgetId(null);
                return next;
              });
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
              isEditing
                ? 'bg-amber-500 border-amber-500 text-slate-950 hover:bg-amber-400'
                : 'bg-slate-100 dark:bg-[#141A26] border-slate-300 dark:border-[#263042] text-slate-800 dark:text-slate-200 hover:border-amber-500/60'
            }`}
          >
            {isEditing ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
            {isEditing ? 'Done Editing' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Main Stage (1-Pane Preview OR 3-Pane Studio Editor) */}
      {!activeScreen ? (
        <div className="flex-1 flex items-center justify-center bg-slate-200/70 dark:bg-[#080B10] p-8">
          <div className="max-w-md rounded-lg border border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] p-6 text-center space-y-3 shadow-lg">
            <div className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              All Screens Are Paused
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Activate an existing screen from Saved Screens, or add a new screen to display it here and include it in rotation.
            </p>
            <button
              onClick={() => {
                setAddScreenStep('menu');
                setShowTemplateModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Screen
            </button>
          </div>
        </div>
      ) : (
      <div
        className={
          isEditing
            ? 'grid grid-cols-1 lg:grid-cols-[260px_1fr_320px] flex-1 min-h-0 overflow-hidden'
            : 'flex flex-col flex-1 min-h-0 overflow-hidden'
        }
      >
        {/* Left Drawer (only rendered in Edit mode) */}
        {isEditing && (
        <aside
          data-guide="left-drawer"
          className="border-r border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] flex flex-col overflow-hidden"
        >
          <div className="grid grid-cols-[1fr_1fr_1.35fr] border-b border-slate-200 dark:border-[#1F2937] p-1.5 bg-slate-100 dark:bg-[#0B0E14] gap-1">
            <button
              onClick={() => setLeftTab('widgets')}
              className={`py-1.5 px-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                leftTab === 'widgets'
                  ? 'bg-white dark:bg-[#1A2233] text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Blocks
            </button>
            <button
              onClick={() => setLeftTab('themes')}
              className={`py-1.5 px-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                leftTab === 'themes'
                  ? 'bg-white dark:bg-[#1A2233] text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Themes
            </button>
            <button
              onClick={() => setLeftTab('photos')}
              className={`py-1.5 px-1 text-[11px] font-medium rounded transition-colors whitespace-nowrap ${
                leftTab === 'photos'
                  ? 'bg-white dark:bg-[#1A2233] text-slate-900 dark:text-slate-100 shadow-xs dark:shadow-none'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Media Library
            </button>
          </div>

          {leftTab === 'widgets' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <p className="text-[11px] text-slate-600 dark:text-slate-400 px-1">
                Click or drag any block onto the 960×376 screen.
              </p>
              {CATALOG_CATEGORIES.map((category) => {
                const items = WIDGET_CATALOG.filter((item) => item.category === category);
                return (
                  <div key={category} className="space-y-1.5">
                    <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      {category}
                    </div>
                    {items.map((item) => (
                      <div
                        key={item.type}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/x-aoostar-widget', item.type);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handleAddWidgetClick(item.type)}
                        className="cursor-grab active:cursor-grabbing rounded-md border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#121824] hover:border-amber-500/40 hover:bg-amber-50/40 dark:hover:bg-[#171F2E] px-3 py-2 transition-colors flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                            {item.label}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                            {item.description}
                          </div>
                        </div>
                        <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}

          {leftTab === 'themes' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              <p className="text-[11px] text-slate-600 dark:text-slate-400 px-1">
                Apply a premade palette and backdrop to the active screen.
              </p>
              {LCD_THEMES.map((theme) => {
                const isActiveTheme = activeScreen.themeId === theme.id;
                return (
                  <button
                    key={theme.id}
                    onClick={() => applyThemeToActiveScreen(theme)}
                    className={`w-full rounded-md border overflow-hidden text-left transition-all ${
                      isActiveTheme
                        ? 'border-amber-500 ring-1 ring-amber-400/40'
                        : 'border-slate-200 dark:border-[#263042] hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    <div
                      className="h-14 relative overflow-hidden"
                      style={{backgroundColor: theme.backgroundColor}}
                    >
                      {theme.backgroundType === 'image' && theme.backgroundImage && (
                        <img
                          src={theme.backgroundImage}
                          alt={theme.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      )}
                      <div
                        className="absolute inset-0 flex items-center justify-between px-3"
                        style={{backgroundColor: `rgba(0,0,0,${theme.backgroundDim})`}}
                      >
                        <div
                          className="px-2 py-1 rounded border text-[11px] font-semibold"
                          style={{
                            backgroundColor: theme.widgetBgColor,
                            color: theme.widgetTextColor,
                            borderColor: 'rgba(148,163,184,0.35)',
                          }}
                        >
                          {theme.name}
                        </div>
                        <div className="flex items-center gap-1">
                          <span
                            className="w-3 h-3 rounded-full border border-white/40"
                            style={{backgroundColor: theme.widgetBgColor}}
                          />
                          <span
                            className="w-3 h-3 rounded-full border border-white/40"
                            style={{backgroundColor: theme.widgetAccentColor}}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-50 dark:bg-[#121824] px-2.5 py-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                      {theme.description}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {leftTab === 'photos' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              <button
                onClick={() => bgFileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-full py-2.5 px-3 rounded-md border border-dashed border-slate-300 dark:border-slate-600 hover:border-amber-500/60 bg-slate-50 dark:bg-[#121824] text-xs font-medium text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                {uploadingImage ? 'Importing...' : 'Import to Media Library'}
              </button>
              <input
                ref={bgFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUploadMedia(file, {kind: 'library-only'});
                  e.target.value = '';
                }}
              />

              {uploadError && (
                <div className="px-2.5 py-2 rounded border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-[11px] text-red-700 dark:text-red-300">
                  {uploadError}
                </div>
              )}

              <div className="space-y-2.5">
                <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                  Imported Media ({config.customImages.length})
                </div>

                {config.customImages.length === 0 && (
                  <div className="rounded border border-dashed border-slate-300 dark:border-[#263042] bg-slate-50 dark:bg-[#0B0E14] px-3 py-4 text-center text-[11px] text-slate-500">
                    Import PNG, JPG, WebP, GIF, AVIF, or MP4/WebM files to use in Image blocks and backgrounds.
                  </div>
                )}

                {config.customImages.map((item) => {
                  const isVid =
                    item.mediaType === 'video' || /\.(mp4|webm)(\?|$)/i.test(item.url);
                  const selected =
                    activeScreen.backgroundType === 'image' && activeScreen.backgroundImage === item.url;
                  return (
                    <div
                      key={item.id}
                      className={`rounded-md overflow-hidden border bg-slate-50 dark:bg-[#121824] ${
                        selected ? 'border-amber-500' : 'border-slate-200 dark:border-[#263042]'
                      }`}
                    >
                      <div className="relative h-16 bg-black overflow-hidden">
                        {isVid ? (
                          <video
                            src={item.url}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={item.url}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        )}
                        <button
                          onClick={() => handleRemoveMedia(item.id, item.url)}
                          title="Remove from Media Library"
                          className="absolute top-1.5 right-1.5 p-1 rounded bg-black/75 border border-red-900/60 text-red-300 hover:bg-red-950 hover:text-red-200 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      <div className="px-2 py-1.5 border-b border-slate-200 dark:border-[#1F2937]">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleRenameMedia(item.id, e.target.value)}
                          placeholder="Media name"
                          className="w-full px-1.5 py-0.5 rounded bg-white dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-[#1F2937] text-[11px]">
                        {!isVid ? (
                          <button
                            onClick={() =>
                              updateActiveScreen((s) => ({
                                ...s,
                                backgroundType: 'image',
                                backgroundImage: item.url,
                              }))
                            }
                            className="py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#1A2233] hover:text-slate-950 dark:hover:text-white transition-colors"
                          >
                            Screen BG
                          </button>
                        ) : (
                          <span className="py-1.5 text-center text-slate-500">Video Loop</span>
                        )}
                        <button
                          onClick={() => {
                            const created = createWidgetFromType('image_layer', 24, 24);
                            created.title = item.name;
                            created.imageUrl = item.url;
                            created.mediaType = isVid ? 'video' : 'image';
                            updateActiveScreen((scr) => ({...scr, widgets: [...scr.widgets, created]}));
                            setSelectedWidgetId(created.id);
                          }}
                          className="py-1.5 text-amber-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-[#1A2233] transition-colors font-medium"
                        >
                          Add Block
                        </button>
                      </div>
                    </div>
                  );
                })}

                <div className="text-[11px] font-medium text-slate-600 dark:text-slate-400 pt-2">
                  Built-in Backdrops
                </div>
                {PRESET_BACKGROUNDS.map((bg) => {
                  const selected =
                    activeScreen.backgroundType === 'image' && activeScreen.backgroundImage === bg.url;
                  return (
                    <div
                      key={bg.id}
                      className={`rounded-md overflow-hidden border bg-slate-50 dark:bg-[#121824] ${
                        selected ? 'border-amber-500' : 'border-slate-200 dark:border-[#263042]'
                      }`}
                    >
                      <div className="relative h-16 bg-black overflow-hidden">
                        <img
                          src={bg.url}
                          alt={bg.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end px-2 py-1">
                          <span className="text-[11px] font-medium text-slate-100 truncate">{bg.name}</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-[#1F2937] text-[11px]">
                        <button
                          onClick={() =>
                            updateActiveScreen((s) => ({
                              ...s,
                              backgroundType: 'image',
                              backgroundImage: bg.url,
                            }))
                          }
                          className="py-1.5 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#1A2233] hover:text-slate-950 dark:hover:text-white transition-colors"
                        >
                          Screen BG
                        </button>
                        <button
                          onClick={() => {
                            const created = createWidgetFromType('image_layer', 24, 24);
                            created.title = bg.name;
                            created.imageUrl = bg.url;
                            created.mediaType = 'image';
                            updateActiveScreen((scr) => ({...scr, widgets: [...scr.widgets, created]}));
                            setSelectedWidgetId(created.id);
                          }}
                          className="py-1.5 text-amber-700 dark:text-amber-300 hover:bg-slate-200 dark:hover:bg-[#1A2233] transition-colors font-medium"
                        >
                          Add Block
                        </button>
                      </div>
                    </div>
                  );
                })}

                <button
                  onClick={() => updateActiveScreen((s) => ({...s, backgroundType: 'solid'}))}
                  className={`w-full py-2 px-3 rounded-md border text-xs text-left ${
                    activeScreen.backgroundType === 'solid'
                      ? 'border-amber-500 bg-amber-50 dark:bg-[#171F2E] text-slate-900 dark:text-slate-100'
                      : 'border-slate-200 dark:border-[#263042] bg-slate-50 dark:bg-[#121824] text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Plain Solid Background
                </button>
              </div>
            </div>
          )}
        </aside>
        )}

        {/* Center Stage: Live 960x376 Bezel */}
        <main
          ref={stageContainerRef}
          onClick={(e) => {
            if (!justDraggedRef.current && e.target === e.currentTarget) setSelectedWidgetId(null);
          }}
          className="flex-1 bg-slate-200/80 dark:bg-[#080B10] flex flex-col items-center justify-center p-6 overflow-auto relative"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[980px] flex items-center justify-between mb-3 gap-4"
          >
            <span className="text-xs text-slate-600 dark:text-slate-400">
              {isEditing
                ? 'Live preview · Drag blocks or click any block to assign entities, graphs, or styles.'
                : 'Live display preview · Click Edit above to customize blocks, themes, or media.'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void handleOpenServerPreview()}
                disabled={loadingServerPreview}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border bg-white/80 dark:bg-[#111622] border-slate-300 dark:border-[#1F2937] text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
              >
                <Eye className="w-3.5 h-3.5 text-amber-500" />
                {loadingServerPreview ? 'Rendering...' : 'Server Preview'}
              </button>
              {isEditing && (
                <button
                  onClick={() => setShowGrid((g) => !g)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors whitespace-nowrap ${
                    showGrid
                      ? 'bg-white dark:bg-[#1A2233] border-slate-400 dark:border-slate-600 text-slate-900 dark:text-slate-100'
                      : 'bg-white/80 dark:bg-[#111622] border-slate-300 dark:border-[#1F2937] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  <Grid className="w-3.5 h-3.5" />
                  Snap Grid
                </button>
              )}
            </div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="rounded-xl p-4 sm:p-5 bg-gradient-to-b from-slate-100 to-slate-200 dark:from-[#1C222E] dark:to-[#11161F] border border-slate-300 dark:border-[#2C3545] shadow-2xl"
          >
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                Aoostar Display · {activeScreen.name}
              </span>
              <span className="text-[11px] font-mono text-slate-500 tabular-nums">960 × 376 px</span>
            </div>

            <div
              style={{
                width: LCD_WIDTH * fitScale,
                height: LCD_HEIGHT * fitScale,
              }}
              className="relative overflow-hidden rounded border border-black bg-black"
            >
              <div
                ref={canvasRef}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDrop={handleCanvasDrop}
                onClick={(e) => {
                  if (!justDraggedRef.current && e.target === e.currentTarget) setSelectedWidgetId(null);
                }}
                style={{
                  width: LCD_WIDTH,
                  height: LCD_HEIGHT,
                  transform: `scale(${fitScale})`,
                  transformOrigin: 'top left',
                  backgroundColor: activeScreen.backgroundColor,
                }}
                className="relative select-none overflow-hidden"
              >
                {activeScreen.backgroundType === 'image' && activeScreen.backgroundImage && (
                  <img
                    src={activeScreen.backgroundImage}
                    alt={activeScreen.name}
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  />
                )}

                {activeScreen.backgroundType === 'image' && activeScreen.backgroundDim > 0 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{backgroundColor: `rgba(0,0,0,${activeScreen.backgroundDim})`}}
                  />
                )}

                {isEditing && showGrid && (
                  <div
                    className="absolute inset-0 pointer-events-none opacity-20"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.22) 1px, transparent 1px)',
                      backgroundSize: '16px 16px',
                    }}
                  />
                )}

                {activeScreen.widgets.map((widget) => {
                  const isSelected = isEditing && widget.id === selectedWidgetId;
                  return (
                    <div
                      key={widget.id}
                      onPointerDown={
                        isEditing ? (e) => handleWidgetPointerDown(e, widget, 'move') : undefined
                      }
                      onClick={
                        isEditing
                          ? (e) => {
                              e.stopPropagation();
                              setSelectedWidgetId(widget.id);
                            }
                          : undefined
                      }
                      style={{
                        left: widget.x,
                        top: widget.y,
                        width: widget.w,
                        height: widget.h,
                      }}
                      className={`absolute ${
                        isEditing
                          ? `cursor-move group ${
                              isSelected
                                ? 'ring-2 ring-amber-400 z-20'
                                : 'hover:ring-1 hover:ring-slate-400/60 z-10'
                            }`
                          : 'z-10'
                      }`}
                    >
                      <LcdWidgetRenderer
                        widget={widget}
                        telemetry={telemetry}
                        haEntities={haEntities}
                        exposedEntities={exposedEntities}
                        dockerIcons={config.dockerIcons}
                      />

                      {isEditing && (
                        <div
                          onPointerDown={(e) => handleWidgetPointerDown(e, widget, 'resize')}
                          onClick={(e) => e.stopPropagation()}
                          title="Drag corner to resize"
                          className={`absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 ${
                            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-80'
                          }`}
                        >
                          <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-amber-400" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[980px] flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-slate-300 dark:border-[#171E2B]"
          >
            <div className="text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>
                Dwell: <span className="font-mono text-slate-800 dark:text-slate-200">{activeScreen.durationSec}s</span> ·{' '}
                {activeScreen.widgets.length} blocks ·{' '}
              </span>
              {!activeScreen.enabled ? (
                <span className="text-amber-700 dark:text-amber-400">Paused (not on rotation)</span>
              ) : onNavigateToRotationSettings ? (
                <button
                  type="button"
                  onClick={onNavigateToRotationSettings}
                  className="text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  Hardware Auto-Rotate: <span className="font-mono">{config.rotationEnabled ? 'On' : 'Off'}</span> (configure in Settings)
                </button>
              ) : (
                <span className="text-slate-500">
                  Hardware Auto-Rotate: <span className="font-mono">{config.rotationEnabled ? 'On' : 'Off'}</span>
                </span>
              )}
            </div>
            <button
              onClick={() => {
                onUpdateConfig((prev) => {
                  const {nextSavedScreens} = upsertSavedScreen(
                    prev.savedScreens ?? [],
                    activeScreen
                  );
                  return {
                    ...prev,
                    savedScreens: nextSavedScreens,
                  };
                });
                setSavedNotice(true);
                window.setTimeout(() => setSavedNotice(false), 2000);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#141A26] text-slate-800 dark:text-slate-200 hover:border-amber-500/60 transition-colors whitespace-nowrap shrink-0"
            >
              <BookmarkPlus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              {savedNotice ? 'Saved to Library' : 'Save Screen'}
            </button>
          </div>
        </main>

        {/* Right Drawer: Widget Inspector OR Screen Settings (only in Edit mode) */}
        {isEditing && (
        <aside
          data-guide="right-inspector"
          className="border-l border-slate-200 dark:border-[#1F2937] bg-white dark:bg-[#0F131C] overflow-y-auto p-4"
        >
          {selectedWidget ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#1F2937]">
                <div>
                  <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Edit Block</h2>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {WIDGET_CATALOG.find((w) => w.type === selectedWidget.type)?.label ?? selectedWidget.type}
                  </div>
                </div>
                <button
                  onClick={() => {
                    updateActiveScreen((scr) => ({
                      ...scr,
                      widgets: scr.widgets.filter((w) => w.id !== selectedWidget.id),
                    }));
                    setSelectedWidgetId(null);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
                >
                  <Trash2 className="w-3 h-3" />
                  Remove
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Title / Label
                </label>
                <input
                  type="text"
                  value={selectedWidget.title}
                  onChange={(e) => updateWidget(selectedWidget.id, {title: e.target.value})}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              {/* Block Size Preset Dropdown */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Block Size
                </label>
                <select
                  value={
                    BLOCK_SIZE_PRESETS.find(
                      (p) => p.w === selectedWidget.w && p.h === selectedWidget.h
                    )?.id ?? 'custom'
                  }
                  onChange={(e) => {
                    const preset = BLOCK_SIZE_PRESETS.find((p) => p.id === e.target.value);
                    if (!preset) return;
                    const nextW = Math.min(preset.w, LCD_WIDTH - selectedWidget.x);
                    const nextH = Math.min(preset.h, LCD_HEIGHT - selectedWidget.y);
                    updateWidget(selectedWidget.id, {w: nextW, h: nextH});
                  }}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                >
                  <option value="custom">
                    Custom ({selectedWidget.w} × {selectedWidget.h})
                  </option>
                  {BLOCK_SIZE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Single Entity Assignment for Number & Radial Gauge */}
              {(selectedWidget.type === 'entity_number' || selectedWidget.type === 'apex_radial') && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Assign Exposed Entity
                  </label>
                  <select
                    value={selectedWidget.entityId ?? ''}
                    onChange={(e) => {
                      const ent = exposedEntities.find((x) => x.id === e.target.value);
                      updateWidget(selectedWidget.id, {
                        entityId: e.target.value,
                        title: ent ? ent.tag : selectedWidget.title,
                      });
                    }}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                  >
                    <option value="">-- Select Entity --</option>
                    {(selectedWidget.type === 'entity_number' ? allEnabledEntities : numericEntities).map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.tag} ({ent.rawValue}
                        {ent.unit}) — {ent.id}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Area vs Line Variant Toggle for Line / Area Graph */}
              {selectedWidget.type === 'apex_area' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Graph Style
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['area', 'line'] as const).map((variant) => (
                      <button
                        key={variant}
                        onClick={() => updateWidget(selectedWidget.id, {chartVariant: variant})}
                        className={`py-1.5 rounded text-xs font-medium border capitalize transition-colors ${
                          (selectedWidget.chartVariant ?? 'area') === variant
                            ? 'bg-amber-500/20 border-amber-500/60 text-amber-700 dark:text-amber-300'
                            : 'bg-slate-100 dark:bg-[#121824] border-slate-300 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                        }`}
                      >
                        {variant}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Multi-Entity Picker for Number List, Line/Area Graph, Vertical & Horizontal Bars */}
              {(selectedWidget.type === 'entity_list' ||
                selectedWidget.type === 'apex_area' ||
                selectedWidget.type === 'apex_bar' ||
                selectedWidget.type === 'apex_hbar') && (() => {
                const currentIds = selectedWidget.entityIds ?? (selectedWidget.entityId ? [selectedWidget.entityId] : []);
                const candidatePool =
                  selectedWidget.type === 'entity_list' ? allEnabledEntities : numericEntities;
                const availableToAdd = candidatePool.filter((e) => !currentIds.includes(e.id));

                const setIds = (nextIds: string[]) => {
                  updateWidget(selectedWidget.id, {
                    entityIds: nextIds,
                    entityId: nextIds[0] ?? undefined,
                  });
                };

                const moveId = (idx: number, dir: -1 | 1) => {
                  const target = idx + dir;
                  if (target < 0 || target >= currentIds.length) return;
                  const next = [...currentIds];
                  const [moved] = next.splice(idx, 1);
                  next.splice(target, 0, moved);
                  setIds(next);
                };

                return (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Assigned Entities ({currentIds.length})
                      </label>
                    </div>

                    {currentIds.length > 0 && (
                      <div className="space-y-1 max-h-36 overflow-y-auto pr-0.5">
                        {currentIds.map((eid, idx) => {
                          const ent = exposedEntities.find((e) => e.id === eid);
                          return (
                            <div
                              key={eid}
                              className="flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#263042] text-[11px]"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-slate-800 dark:text-slate-200 truncate">{ent?.tag ?? eid}</div>
                                <div className="text-[10px] font-mono text-slate-500 truncate">
                                  {ent ? `${ent.rawValue}${ent.unit}` : eid}
                                </div>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  onClick={() => moveId(idx, -1)}
                                  disabled={idx === 0}
                                  className="p-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25"
                                  title="Move up"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => moveId(idx, 1)}
                                  disabled={idx === currentIds.length - 1}
                                  className="p-0.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25"
                                  title="Move down"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() => setIds(currentIds.filter((id) => id !== eid))}
                                  className="p-0.5 text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                                  title="Remove entity"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <select
                      value=""
                      onChange={(e) => {
                        if (!e.target.value) return;
                        setIds([...currentIds, e.target.value]);
                      }}
                      className="w-full px-2.5 py-1.5 rounded bg-slate-100 dark:bg-[#121824] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200"
                    >
                      <option value="">+ Add Entity to Block...</option>
                      {availableToAdd.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.tag} ({ent.rawValue}
                          {ent.unit}) — {ent.id}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })()}

              {/* Media Layer Controls (Image / GIF / Video) */}
              {selectedWidget.type === 'image_layer' && (
                <div className="space-y-3">
                  <button
                    onClick={() => widgetFileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="w-full py-2 px-3 rounded border border-dashed border-slate-300 dark:border-slate-600 hover:border-amber-500/60 bg-slate-50 dark:bg-[#121824] text-xs text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    {uploadingImage ? 'Uploading...' : 'Import Image, GIF, or Video'}
                  </button>
                  <input
                    ref={widgetFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        void handleUploadMedia(file, {kind: 'widget-media', widgetId: selectedWidget.id});
                      }
                      e.target.value = '';
                    }}
                  />
                  {uploadError && (
                    <div className="px-2.5 py-1.5 rounded border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-[11px] text-red-700 dark:text-red-300">
                      {uploadError}
                    </div>
                  )}
                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                      Select from Media Library
                    </label>
                    <select
                      value={selectedWidget.imageUrl ?? ''}
                      onChange={(e) => {
                        const url = e.target.value;
                        const found = config.customImages.find((m) => m.url === url);
                        const isVid =
                          found?.mediaType === 'video' || /\.(mp4|webm)(\?|$)/i.test(url);
                        updateWidget(selectedWidget.id, {
                          imageUrl: url || undefined,
                          mediaType: isVid ? 'video' : 'image',
                        });
                      }}
                      className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="">-- Choose from Media Library --</option>
                      {config.customImages.length > 0 && (
                        <optgroup label="Imported Media">
                          {config.customImages.map((img) => (
                            <option key={img.id} value={img.url}>
                              {img.name}
                              {img.mediaType === 'video' ? ' (Video)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Built-in Backdrops">
                        {PRESET_BACKGROUNDS.map((img) => (
                          <option key={img.id} value={img.url}>
                            {img.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  {config.customImages.length > 0 && (
                    <div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mb-1.5">
                        Media Library Quick Pick
                      </div>
                      <div className="grid grid-cols-3 gap-1.5 max-h-36 overflow-y-auto pr-0.5">
                        {config.customImages.map((item) => {
                          const isVid =
                            item.mediaType === 'video' || /\.(mp4|webm)(\?|$)/i.test(item.url);
                          const isSelected = selectedWidget.imageUrl === item.url;
                          return (
                            <button
                              key={item.id}
                              onClick={() =>
                                updateWidget(selectedWidget.id, {
                                  imageUrl: item.url,
                                  mediaType: isVid ? 'video' : 'image',
                                })
                              }
                              title={item.name}
                              className={`rounded overflow-hidden border text-left transition-colors ${
                                isSelected
                                  ? 'border-amber-500 ring-1 ring-amber-400/50'
                                  : 'border-slate-300 dark:border-[#263042] hover:border-slate-400 dark:hover:border-slate-500'
                              }`}
                            >
                              <div className="h-10 bg-black overflow-hidden">
                                {isVid ? (
                                  <video
                                    src={item.url}
                                    muted
                                    playsInline
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <img
                                    src={item.url}
                                    alt={item.name}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                )}
                              </div>
                              <div className="px-1 py-0.5 bg-slate-100 dark:bg-[#0B0E14] text-[10px] text-slate-700 dark:text-slate-300 truncate">
                                {item.name}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">Media Fit</label>
                    <select
                      value={selectedWidget.imageFit ?? 'cover'}
                      onChange={(e) =>
                        updateWidget(selectedWidget.id, {imageFit: e.target.value as 'cover' | 'contain'})
                      }
                      className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                    >
                      <option value="cover">Fill Box (Cover)</option>
                      <option value="contain">Fit Inside (Contain)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Docker Container Images (Quick Assign inside Docker List Block) */}
              {selectedWidget.type === 'docker_list' && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Running Docker Images
                    </label>
                  </div>
                  <input
                    ref={dockerIconFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      const targetName = dockerUploadTargetRef.current;
                      if (file && targetName) {
                        void handleUploadMedia(file, {kind: 'docker-icon', containerName: targetName});
                      }
                      e.target.value = '';
                    }}
                  />
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                    {(telemetry?.containers ?? [])
                      .filter((c) => c.state === 'running')
                      .map((c) => {
                        const iconUrl = config.dockerIcons?.[c.name];
                        return (
                          <div
                            key={c.id}
                            className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-200 dark:border-[#263042] text-[11px]"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              {iconUrl ? (
                                <img
                                  src={iconUrl}
                                  alt={c.name}
                                  referrerPolicy="no-referrer"
                                  className="w-5 h-5 rounded-sm object-cover shrink-0"
                                />
                              ) : (
                                <span className="w-5 h-5 rounded-sm bg-slate-200 dark:bg-[#161E2E] text-[9px] font-mono text-slate-600 dark:text-slate-400 flex items-center justify-center shrink-0 uppercase">
                                  {c.name.slice(0, 2)}
                                </span>
                              )}
                              <span className="text-slate-800 dark:text-slate-200 truncate font-mono">{c.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  dockerUploadTargetRef.current = c.name;
                                  dockerIconFileInputRef.current?.click();
                                }}
                                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-[#141A26] border border-slate-300 dark:border-[#263042] text-[10px] text-slate-800 dark:text-slate-200 hover:border-amber-500/60"
                              >
                                Set
                              </button>
                              {iconUrl && (
                                <button
                                  onClick={() =>
                                    onUpdateConfig((prev) => {
                                      const next = {...(prev.dockerIcons || {})};
                                      delete next[c.name];
                                      return {...prev, dockerIcons: next};
                                    })
                                  }
                                  className="p-0.5 text-slate-500 hover:text-red-500 dark:hover:text-red-400"
                                  title="Clear icon"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Custom Text Template */}
              {selectedWidget.type === 'custom_text' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                    Text (supports {"{{entity_id}}"})
                  </label>
                  <input
                    type="text"
                    value={selectedWidget.customText ?? ''}
                    onChange={(e) => updateWidget(selectedWidget.id, {customText: e.target.value})}
                    className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Example: {"{{server.hostname}} · {{server.cpu_percent}}%"}
                  </p>
                </div>
              )}

              {/* Custom HTML / CSS Block Editor */}
              {selectedWidget.type === 'custom_html' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Code2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      Custom HTML &amp; CSS
                    </label>
                    <button
                      onClick={() => updateWidget(selectedWidget.id, {htmlCode: DEFAULT_HTML_CODE})}
                      className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141A26] border border-slate-300 dark:border-[#263042] text-[10px] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
                    >
                      Reset Starter
                    </button>
                  </div>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const current = selectedWidget.htmlCode ?? DEFAULT_HTML_CODE;
                      updateWidget(selectedWidget.id, {
                        htmlCode: `${current}\n<span>{{${e.target.value}}}</span>`,
                      });
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-100 dark:bg-[#121824] border border-slate-300 dark:border-[#263042] text-[11px] text-slate-800 dark:text-slate-200"
                  >
                    <option value="">+ Insert Live Entity Tag...</option>
                    {allEnabledEntities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.tag} — &#123;&#123;{ent.id}&#125;&#125;
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={10}
                    value={selectedWidget.htmlCode ?? DEFAULT_HTML_CODE}
                    onChange={(e) => updateWidget(selectedWidget.id, {htmlCode: e.target.value})}
                    spellCheck={false}
                    className="w-full p-2.5 rounded bg-slate-50 dark:bg-[#090C11] border border-slate-300 dark:border-[#263042] text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500 leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Use <code className="text-slate-700 dark:text-slate-300">&#123;&#123;entity_id&#125;&#125;</code> for live values or{' '}
                    <code className="text-slate-700 dark:text-slate-300">&#123;&#123;tag:entity_id&#125;&#125;</code> for its tag label.
                  </p>
                </div>
              )}

              {/* Custom ApexCharts Code Editor */}
              {selectedWidget.type === 'apex_custom' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                      <Code2 className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      ApexCharts JSON Config
                    </label>
                    <div className="flex gap-1">
                      {(['area', 'radial', 'bar'] as const).map((snip) => (
                        <button
                          key={snip}
                          onClick={() => updateWidget(selectedWidget.id, {apexCode: APEX_SNIPPETS[snip]})}
                          className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141A26] border border-slate-300 dark:border-[#263042] text-[10px] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
                        >
                          {snip}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    rows={10}
                    value={selectedWidget.apexCode ?? DEFAULT_APEX_CODE}
                    onChange={(e) => updateWidget(selectedWidget.id, {apexCode: e.target.value})}
                    spellCheck={false}
                    className="w-full p-2.5 rounded bg-slate-50 dark:bg-[#090C11] border border-slate-300 dark:border-[#263042] text-[11px] font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-amber-500 leading-relaxed"
                  />
                  <p className="text-[10px] text-slate-500 leading-snug">
                    Inject live data with <code className="text-slate-700 dark:text-slate-300">"&#123;&#123;history:server.cpu_percent&#125;&#125;"</code> or scalar <code className="text-slate-700 dark:text-slate-300">"&#123;&#123;server.ram_percent&#125;&#125;"</code>.
                  </p>
                </div>
              )}

              {/* Colors (Swatches + Color Wheel) & Typography */}
              {selectedWidget.type !== 'image_layer' && (
                <div className="space-y-3.5 pt-2 border-t border-slate-200 dark:border-[#1F2937]">
                  {/* Highlight / Accent Color */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                        Highlight Color
                      </label>
                      <span className="text-[10px] font-mono text-slate-500 uppercase">
                        {selectedWidget.accentColor}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {ACCENT_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          onClick={() => updateWidget(selectedWidget.id, {accentColor: hex})}
                          style={{backgroundColor: hex}}
                          className={`w-5 h-5 rounded-full border transition-transform ${
                            selectedWidget.accentColor.toLowerCase() === hex.toLowerCase()
                              ? 'border-amber-500 scale-110 ring-1 ring-amber-400'
                              : 'border-slate-400 dark:border-slate-700'
                          }`}
                        />
                      ))}
                      <label
                        title="Custom accent color wheel"
                        className="w-6 h-6 rounded-full border border-slate-400 dark:border-slate-600 overflow-hidden cursor-pointer shrink-0 relative"
                        style={{backgroundColor: selectedWidget.accentColor}}
                      >
                        <input
                          type="color"
                          value={selectedWidget.accentColor}
                          onChange={(e) => updateWidget(selectedWidget.id, {accentColor: e.target.value})}
                          className="opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Block Background Color, Opacity & Image */}
                  {selectedWidget.type !== 'divider' && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Block Background
                        </label>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">
                          {selectedWidget.bgColor} · {Math.round(selectedWidget.bgOpacity * 100)}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {BG_SWATCHES.map((hex) => (
                          <button
                            key={hex}
                            onClick={() => updateWidget(selectedWidget.id, {bgColor: hex})}
                            style={{backgroundColor: hex}}
                            className={`w-5 h-5 rounded-full border transition-transform ${
                              selectedWidget.bgColor.toLowerCase() === hex.toLowerCase()
                                ? 'border-amber-500 scale-110 ring-1 ring-amber-400'
                                : 'border-slate-400 dark:border-slate-600'
                            }`}
                          />
                        ))}
                        <label
                          title="Custom background color wheel"
                          className="w-6 h-6 rounded-full border border-slate-400 dark:border-slate-600 overflow-hidden cursor-pointer shrink-0"
                          style={{backgroundColor: selectedWidget.bgColor}}
                        >
                          <input
                            type="color"
                            value={selectedWidget.bgColor}
                            onChange={(e) => updateWidget(selectedWidget.id, {bgColor: e.target.value})}
                            className="opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedWidget.bgOpacity}
                        onChange={(e) => updateWidget(selectedWidget.id, {bgOpacity: Number(e.target.value)})}
                        className="w-full accent-amber-500"
                        title="Background color / tint opacity"
                      />

                      {/* Block Background Image */}
                      <div className="pt-1.5 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] text-slate-600 dark:text-slate-400">
                            Block Background Image
                          </label>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => blockBgFileInputRef.current?.click()}
                              className="text-[10px] text-amber-600 dark:text-amber-300 hover:underline"
                            >
                              Upload
                            </button>
                            {selectedWidget.bgImageUrl && (
                              <button
                                onClick={() => updateWidget(selectedWidget.id, {bgImageUrl: undefined})}
                                className="text-[10px] text-red-600 dark:text-red-400 hover:underline"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          ref={blockBgFileInputRef}
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              void handleUploadMedia(file, {kind: 'widget-bg', widgetId: selectedWidget.id});
                            }
                            e.target.value = '';
                          }}
                        />
                        <select
                          value={selectedWidget.bgImageUrl ?? ''}
                          onChange={(e) =>
                            updateWidget(selectedWidget.id, {
                              bgImageUrl: e.target.value || undefined,
                            })
                          }
                          className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-800 dark:text-slate-200"
                        >
                          <option value="">None (Solid / Media Library)</option>
                          {config.customImages.filter((m) => m.mediaType !== 'video').length > 0 && (
                            <optgroup label="Media Library">
                              {config.customImages
                                .filter((m) => m.mediaType !== 'video')
                                .map((img) => (
                                  <option key={img.id} value={img.url}>
                                    {img.name}
                                  </option>
                                ))}
                            </optgroup>
                          )}
                          <optgroup label="Built-in Backdrops">
                            {PRESET_BACKGROUNDS.map((img) => (
                              <option key={img.id} value={img.url}>
                                {img.name}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Text Color */}
                  {selectedWidget.type !== 'divider' && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                          Text Color
                        </label>
                        <span className="text-[10px] font-mono text-slate-500 uppercase">
                          {selectedWidget.textColor}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {TEXT_SWATCHES.map((hex) => (
                          <button
                            key={hex}
                            onClick={() => updateWidget(selectedWidget.id, {textColor: hex})}
                            style={{backgroundColor: hex}}
                            className={`w-5 h-5 rounded-full border transition-transform ${
                              selectedWidget.textColor.toLowerCase() === hex.toLowerCase()
                                ? 'border-amber-500 scale-110 ring-1 ring-amber-400'
                                : 'border-slate-400 dark:border-slate-700'
                            }`}
                          />
                        ))}
                        <label
                          title="Custom text color wheel"
                          className="w-6 h-6 rounded-full border border-slate-400 dark:border-slate-600 overflow-hidden cursor-pointer shrink-0"
                          style={{backgroundColor: selectedWidget.textColor}}
                        >
                          <input
                            type="color"
                            value={selectedWidget.textColor}
                            onChange={(e) => updateWidget(selectedWidget.id, {textColor: e.target.value})}
                            className="opacity-0 w-full h-full cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Typography: Font Family & Font Size */}
                  {selectedWidget.type !== 'divider' && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Font Family
                        </label>
                        <select
                          value={selectedWidget.fontFamily ?? 'mono'}
                          onChange={(e) =>
                            updateWidget(selectedWidget.id, {fontFamily: e.target.value as FontFamilyOption})
                          }
                          className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                        >
                          <option value="mono">Monospace</option>
                          <option value="display">Display Sans</option>
                          <option value="sans">Body Sans</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Text Size
                        </label>
                        <select
                          value={selectedWidget.fontSizePreset ?? 'md'}
                          onChange={(e) =>
                            updateWidget(selectedWidget.id, {fontSizePreset: e.target.value as FontSizePreset})
                          }
                          className="w-full px-2 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                        >
                          <option value="sm">Small</option>
                          <option value="md">Normal</option>
                          <option value="lg">Large</option>
                          <option value="xl">Extra Large</option>
                          <option value="2xl">Display</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Progressive Disclosure for Exact Pixel Coordinates & Borders */}
              <div className="pt-2 border-t border-slate-200 dark:border-[#1F2937]">
                <button
                  onClick={() => setShowAdvancedWidget((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                    Advanced Position &amp; Borders
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${showAdvancedWidget ? 'rotate-180' : ''}`}
                  />
                </button>

                {showAdvancedWidget && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          ['x', 'X', 0, LCD_WIDTH - 40],
                          ['y', 'Y', 0, LCD_HEIGHT - 16],
                          ['w', 'Width', 64, LCD_WIDTH],
                          ['h', 'Height', 16, LCD_HEIGHT],
                        ] as const
                      ).map(([field, label, min, max]) => (
                        <div key={field}>
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                            {label}
                          </label>
                          <input
                            type="number"
                            step={8}
                            min={min}
                            max={max}
                            value={selectedWidget[field]}
                            onChange={(e) =>
                              updateWidget(selectedWidget.id, {
                                [field]: Math.max(min, Math.min(max, Number(e.target.value))),
                              })
                            }
                            className="w-full px-2 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-900 dark:text-slate-100 tabular-nums"
                          />
                        </div>
                      ))}
                    </div>

                    <div>
                      <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-1">
                        Border Opacity ({Math.round(selectedWidget.borderOpacity * 100)}%)
                      </label>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={selectedWidget.borderOpacity}
                        onChange={(e) => updateWidget(selectedWidget.id, {borderOpacity: Number(e.target.value)})}
                        className="w-full accent-amber-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="pb-3 border-b border-slate-200 dark:border-[#1F2937]">
                <h2 className="text-xs font-semibold text-slate-900 dark:text-slate-100">Screen Settings</h2>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Configure display timing and background readability.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  Screen Name
                </label>
                <input
                  type="text"
                  value={activeScreen.name}
                  onChange={(e) => updateActiveScreen((s) => ({...s, name: e.target.value}))}
                  className="w-full px-2.5 py-1.5 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Show This Screen For
                </label>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {QUICK_DURATIONS.map((sec) => (
                    <button
                      key={sec}
                      onClick={() => updateActiveScreen((s) => ({...s, durationSec: sec}))}
                      className={`py-1.5 rounded text-xs font-mono border transition-colors ${
                        activeScreen.durationSec === sec
                          ? 'bg-amber-500/20 border-amber-500/60 text-amber-700 dark:text-amber-300'
                          : 'bg-slate-100 dark:bg-[#121824] border-slate-300 dark:border-[#263042] text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500'
                      }`}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={3}
                  max={600}
                  value={activeScreen.durationSec}
                  onChange={(e) =>
                    updateActiveScreen((s) => ({...s, durationSec: Math.max(3, Number(e.target.value))}))
                  }
                  className="w-full px-2.5 py-1 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs font-mono text-slate-800 dark:text-slate-200"
                />
              </div>

              {activeScreen.backgroundType === 'image' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1 flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" />
                    Darken Background ({Math.round(activeScreen.backgroundDim * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={0.85}
                    step={0.05}
                    value={activeScreen.backgroundDim}
                    onChange={(e) =>
                      updateActiveScreen((s) => ({...s, backgroundDim: Number(e.target.value)}))
                    }
                    className="w-full accent-amber-500"
                  />
                </div>
              )}

              <label className="flex items-center justify-between py-2 px-3 rounded border border-slate-200 dark:border-[#1F2937] bg-slate-50 dark:bg-[#121824] cursor-pointer">
                <span className="text-xs text-slate-800 dark:text-slate-200">Include in Auto-Rotate</span>
                <input
                  type="checkbox"
                  checked={activeScreen.enabled}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    onUpdateConfig((prev) => {
                      const nextScreens = prev.screens.map((s) =>
                        s.id === activeScreen.id ? {...s, enabled: checked} : s
                      );
                      const firstEnabledId = nextScreens.find((s) => s.enabled)?.id ?? '';
                      return {
                        ...prev,
                        screens: nextScreens,
                        activeScreenId: !checked ? firstEnabledId : prev.activeScreenId,
                      };
                    });
                  }}
                  className="accent-amber-500"
                />
              </label>

              <div className="pt-3 border-t border-slate-200 dark:border-[#1F2937] flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleMoveScreen(activeScreenIndex, -1)}
                    disabled={activeScreenIndex <= 0}
                    className="p-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#121824] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white disabled:opacity-30"
                    title="Move earlier"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleMoveScreen(activeScreenIndex, 1)}
                    disabled={activeScreenIndex >= config.screens.length - 1}
                    className="p-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#121824] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white disabled:opacity-30"
                    title="Move later"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => handleDeleteScreen(activeScreen.id)}
                  disabled={config.screens.length <= 1}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-30"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete
                </button>
              </div>
            </div>
          )}
        </aside>
        )}
      </div>
      )}

      {/* Add Screen Modal (3 Options: Blank, Saved, Templates) */}
      {showTemplateModal && (
        <div
          onClick={() => setShowTemplateModal(false)}
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-6 space-y-6 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#1F2937]">
              <div className="flex items-center gap-3">
                {addScreenStep !== 'menu' && (
                  <button
                    onClick={() => setAddScreenStep('menu')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Back
                  </button>
                )}
                <div>
                  <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                    {addScreenStep === 'menu'
                      ? 'Add a New Screen'
                      : addScreenStep === 'saved'
                        ? 'Choose a Saved Screen'
                        : 'Choose a Template'}
                  </h2>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                    {addScreenStep === 'menu'
                      ? 'Choose how you want to create your new display screen.'
                      : addScreenStep === 'saved'
                        ? 'Select a screen from your Saved Screens library.'
                        : 'Pick a ready-made layout to start from.'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {addScreenStep === 'menu' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <button
                  onClick={handleCreateBlankScreen}
                  className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-5 flex flex-col justify-between gap-4 transition-colors"
                >
                  <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-slate-800 dark:text-slate-200">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Blank</div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Start with an empty 960×376 canvas and build from scratch.
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => setAddScreenStep('saved')}
                  className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-5 flex flex-col justify-between gap-4 transition-colors"
                >
                  <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-amber-600 dark:text-amber-400">
                    <BookmarkPlus className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between gap-2">
                      <span>Saved</span>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {(config.savedScreens ?? []).length}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Reuse a screen you previously saved to your library.
                    </p>
                  </div>
                </button>

                <button
                  onClick={() => setAddScreenStep('templates')}
                  className="text-left rounded-lg border border-slate-200 dark:border-[#263042] hover:border-amber-500/70 bg-slate-50 dark:bg-[#121824] p-5 flex flex-col justify-between gap-4 transition-colors"
                >
                  <div className="w-9 h-9 rounded-md border border-slate-300 dark:border-[#263042] bg-white dark:bg-[#0B0E14] flex items-center justify-center text-sky-600 dark:text-sky-400">
                    <Copy className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center justify-between gap-2">
                      <span>Templates</span>
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                        {PREMADE_SCREENS.length}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                      Choose from pre-built dashboard, Docker, and HA layouts.
                    </p>
                  </div>
                </button>
              </div>
            )}

            {addScreenStep === 'saved' && (
              <div>
                {(config.savedScreens ?? []).length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 dark:border-[#263042] bg-slate-50 dark:bg-[#0B0E14] p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                    No saved screens in your library yet. Save a screen first or pick Blank or Templates.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {config.savedScreens.map((saved) => (
                      <button
                        key={saved.id}
                        onClick={() =>
                          handleAddFromPreset({
                            ...saved.screen,
                            name: saved.name,
                            enabled: true,
                          })
                        }
                        className="group text-left rounded-lg border border-slate-200 dark:border-[#263042] bg-slate-50 dark:bg-[#121824] hover:border-amber-500/60 overflow-hidden transition-colors"
                      >
                        <div
                          className="h-20 relative overflow-hidden"
                          style={{backgroundColor: saved.screen.backgroundColor}}
                        >
                          {saved.screen.backgroundType === 'image' && saved.screen.backgroundImage && (
                            <img
                              src={saved.screen.backgroundImage}
                              alt={saved.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover opacity-75 group-hover:opacity-95 transition-opacity"
                            />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-[#121824] via-black/30 to-transparent flex items-end p-3">
                            <span className="text-xs font-semibold text-slate-100 truncate">
                              {saved.name}
                            </span>
                          </div>
                        </div>
                        <div className="px-3 py-2.5 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                          <span className="font-mono tabular-nums">
                            {saved.screen.durationSec}s · {saved.screen.widgets.length} blocks
                          </span>
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                            <Plus className="w-3 h-3" /> Add Saved
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {addScreenStep === 'templates' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {PREMADE_SCREENS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleAddFromPreset(preset)}
                    className="group text-left rounded-lg border border-slate-200 dark:border-[#263042] bg-slate-50 dark:bg-[#121824] hover:border-amber-500/60 overflow-hidden transition-colors"
                  >
                    <div className="h-20 relative bg-black overflow-hidden">
                      {preset.backgroundImage && (
                        <img
                          src={preset.backgroundImage}
                          alt={preset.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover opacity-70 group-hover:opacity-90 transition-opacity"
                        />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-[#121824] via-black/30 to-transparent flex items-end p-3">
                        <span className="text-xs font-semibold text-slate-100">{preset.name}</span>
                      </div>
                    </div>
                    <div className="px-3 py-2.5 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span>{preset.widgets.length} blocks</span>
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                        <Copy className="w-3 h-3" /> Use Template
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save Before Deleting Prompt */}
      {pendingDeleteScreen && (
        <div
          onClick={() => setPendingDeleteScreen(null)}
          className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-[#1F2937]">
              <div>
                <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
                  Save Screen Before Deleting?
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  &ldquo;{pendingDeleteScreen.name}&rdquo; is not saved in your Saved Screens library yet.
                </p>
              </div>
              <button
                onClick={() => setPendingDeleteScreen(null)}
                className="p-1 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                Saved Screen Name
              </label>
              <input
                type="text"
                value={pendingDeleteName}
                onChange={(e) => setPendingDeleteName(e.target.value)}
                className="w-full px-3 py-2 rounded bg-slate-50 dark:bg-[#0B0E14] border border-slate-300 dark:border-[#263042] text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setPendingDeleteScreen(null)}
                className="px-3 py-1.5 rounded border border-slate-300 dark:border-[#263042] bg-slate-100 dark:bg-[#141A26] text-xs text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const targetId = pendingDeleteScreen.id;
                  setPendingDeleteScreen(null);
                  performDeleteScreen(targetId);
                }}
                className="px-3 py-1.5 rounded border border-red-300 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900/40"
              >
                Delete Without Saving
              </button>
              <button
                onClick={() => {
                  const target = pendingDeleteScreen;
                  const chosenName = pendingDeleteName.trim() || target.name;
                  onUpdateConfig((prev) => {
                    const {nextSavedScreens} = upsertSavedScreen(
                      prev.savedScreens ?? [],
                      target,
                      chosenName
                    );
                    const remaining = prev.screens.filter((s) => s.id !== target.id);
                    const nextActive = remaining.find((s) => s.enabled)?.id ?? remaining[0]?.id ?? '';
                    return {
                      ...prev,
                      savedScreens: nextSavedScreens,
                      screens: remaining,
                      activeScreenId: prev.activeScreenId === target.id ? nextActive : prev.activeScreenId,
                    };
                  });
                  setSelectedWidgetId(null);
                  setPendingDeleteScreen(null);
                }}
                className="px-3.5 py-1.5 rounded bg-amber-500 text-slate-950 hover:bg-amber-400 text-xs font-semibold"
              >
                Save &amp; Remove
              </button>
            </div>
          </div>
        </div>
      )}
      {serverPreviewUrl && (
        <div
          onClick={() => {
            URL.revokeObjectURL(serverPreviewUrl);
            setServerPreviewUrl(null);
          }}
          className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[1040px] rounded-xl border border-slate-200 dark:border-[#263042] bg-white dark:bg-[#0F131C] p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#1F2937]">
              <div>
                <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                  Server-Rendered LCD Frame Preview (960×376 PNG)
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Rendered server-side using the headless compositor pushed to hardware.
                </p>
              </div>
              <button
                onClick={() => {
                  URL.revokeObjectURL(serverPreviewUrl);
                  setServerPreviewUrl(null);
                }}
                className="p-1.5 rounded text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-black rounded border border-slate-800 overflow-hidden flex items-center justify-center">
              <img
                src={serverPreviewUrl}
                alt="Server rendered LCD preview"
                className="max-w-full h-auto block"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
