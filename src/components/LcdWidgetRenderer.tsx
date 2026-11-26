import {useEffect, useMemo, useState} from 'react';
import type {ApexOptions} from 'apexcharts';
import type {
  ExposedEntity,
  FontFamilyOption,
  FontSizePreset,
  HomeAssistantEntity,
  ScreenWidget,
  TelemetrySnapshot,
} from '../types.ts';
import {formatBytes, formatUptime, hexToRgba} from '../utils/format.ts';
import {ApexChartBox} from './ApexChartBox.tsx';

interface LcdWidgetRendererProps {
  widget: ScreenWidget;
  telemetry: TelemetrySnapshot | null;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  dockerIcons?: Record<string, string>;
}

function isVideoMedia(url?: string, mediaType?: 'image' | 'video'): boolean {
  if (mediaType === 'video') return true;
  if (!url) return false;
  return /\.(mp4|webm)(\?|$)/i.test(url) || url.startsWith('data:video/');
}

const MULTI_SERIES_PALETTE = ['#F59E0B', '#38BDF8', '#10B981', '#A78BFA', '#F43F5E', '#FB923C'];

const FONT_FAMILY_CSS: Record<FontFamilyOption, string> = {
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  display: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  sans: "'Public Sans', system-ui, -apple-system, sans-serif",
};

const FONT_SIZE_MULTIPLIER: Record<FontSizePreset, number> = {
  sm: 0.85,
  md: 1,
  lg: 1.2,
  xl: 1.45,
  '2xl': 1.75,
};

function resolveTemplateText(template: string, exposedEntities: ExposedEntity[]): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, rawKey: string) => {
    const cleanKey = rawKey.trim();
    if (cleanKey.startsWith('tag:')) {
      const id = cleanKey.slice(4).trim();
      const found = exposedEntities.find((e) => e.id === id);
      return found ? found.tag : id;
    }
    const found = exposedEntities.find((e) => e.id === cleanKey);
    if (!found) return cleanKey;
    return `${found.rawValue}${found.unit ? found.unit : ''}`;
  });
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(iframe|object|embed|link|meta|base)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
}

export function LcdWidgetRenderer({
  widget,
  telemetry,
  haEntities,
  exposedEntities,
  dockerIcons,
}: LcdWidgetRendererProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (widget.type !== 'clock') return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [widget.type]);

  const fontPresetScale = FONT_SIZE_MULTIPLIER[widget.fontSizePreset ?? 'md'] ?? 1;
  const effectiveFontScale = (widget.fontScale || 1) * fontPresetScale;
  const scale = Math.max(0.5, Math.min(2.5, effectiveFontScale));
  const uiScale = Math.min(1.35, scale);
  const titleSize = Number((13.5 * Math.min(1.3, scale)).toFixed(1));
  const headerHeightEstimate = Math.round(titleSize * 1.25 + 8);
  const bodyW = Math.max(24, widget.w - 24);
  const bodyH = Math.max(20, widget.h - 21 - headerHeightEstimate);
  const resolvedFontFamily = FONT_FAMILY_CSS[widget.fontFamily ?? 'mono'];

  const containerStyle = {
    backgroundColor: widget.type === 'divider' || widget.bgImageUrl ? 'transparent' : hexToRgba(widget.bgColor, widget.bgOpacity),
    borderColor: widget.type === 'divider' ? 'transparent' : `rgba(148, 163, 184, ${widget.borderOpacity})`,
    color: widget.textColor,
    fontFamily: resolvedFontFamily,
  };

  const chartHeight = Math.max(60, widget.h - 24 - headerHeightEstimate);

  const boundEntity = useMemo(
    () => exposedEntities.find((e) => e.id === widget.entityId),
    [exposedEntities, widget.entityId]
  );

  const boundEntities = useMemo(() => {
    const ids = widget.entityIds && widget.entityIds.length > 0
      ? widget.entityIds
      : widget.entityId
        ? [widget.entityId]
        : [];
    return ids
      .map((id) => exposedEntities.find((e) => e.id === id))
      .filter((e): e is ExposedEntity => Boolean(e));
  }, [exposedEntities, widget.entityIds, widget.entityId]);

  const areaConfig = useMemo<{
    chartType: 'area' | 'line';
    options: ApexOptions;
    series: ApexOptions['series'];
  }>(() => {
    const hist = telemetry?.history;
    const chartType: 'area' | 'line' = widget.chartVariant === 'line' ? 'line' : 'area';
    const numericEntities = boundEntities.filter((e) => e.history.length > 0 || e.numericValue !== null);

    if (numericEntities.length > 0) {
      const palette = [
        widget.accentColor,
        ...MULTI_SERIES_PALETTE.filter((c) => c.toLowerCase() !== widget.accentColor.toLowerCase()),
      ].slice(0, numericEntities.length);

      const allPct = numericEntities.every((e) => e.unit === '%');
      const primaryUnit = numericEntities.length === 1 ? numericEntities[0].unit : '';
      const series = numericEntities.map((ent) => ({
        name: ent.tag,
        data: ent.history.length > 0 ? ent.history : [ent.numericValue ?? 0, ent.numericValue ?? 0],
      }));

      const maxLen = Math.max(...series.map((s) => s.data.length), 1);

      const chartFontSize = `${Math.round(11.5 * Math.max(0.75, Math.min(1.35, uiScale)))}px`;

      return {
        chartType,
        options: {
          chart: {fontFamily: resolvedFontFamily},
          colors: palette,
          stroke: {curve: widget.chartSmooth !== false ? 'smooth' : 'straight', width: 2.5},
          fill:
            chartType === 'area'
              ? {type: 'gradient', gradient: {opacityFrom: 0.38, opacityTo: 0.04}}
              : {type: 'solid', opacity: 1},
          dataLabels: {enabled: false},
          grid: {
            borderColor: 'rgba(148,163,184,0.14)',
            strokeDashArray: 3,
            padding: {left: 4, right: 6, top: -4, bottom: -4},
          },
          xaxis: {
            categories: hist?.timestamps.slice(-maxLen) ?? [],
            labels: {show: false},
            axisBorder: {show: false},
            axisTicks: {show: false},
          },
          yaxis: {
            min: allPct ? 0 : undefined,
            max: allPct ? 100 : undefined,
            labels: {
              style: {colors: '#94A3B8', fontSize: chartFontSize},
              formatter: (val) => `${Math.round(val)}${primaryUnit}`,
            },
          },
          legend: {
            show: series.length > 1,
            position: 'top',
            horizontalAlign: 'right',
            fontSize: chartFontSize,
            labels: {colors: widget.textColor || '#CBD5E1'},
            markers: {size: 6},
          },
          tooltip: {enabled: false},
        },
        series,
      };
    }

    const binding = widget.binding ?? 'cpu_percent';
    const isNet = binding === 'net_rx_tx';
    const isRam = binding === 'ram_percent';
    const chartFontSize = `${Math.round(11.5 * Math.max(0.75, Math.min(1.35, uiScale)))}px`;
    const series = isNet
      ? [
          {name: 'RX Mbps', data: hist?.netRxSeries ?? []},
          {name: 'TX Mbps', data: hist?.netTxSeries ?? []},
        ]
      : [
          {
            name: isRam ? 'Memory %' : 'CPU %',
            data: isRam ? hist?.ramSeries ?? [] : hist?.cpuSeries ?? [],
          },
        ];

    const options: ApexOptions = {
      chart: {fontFamily: resolvedFontFamily},
      colors: isNet ? [widget.accentColor, '#38BDF8'] : [widget.accentColor],
      stroke: {curve: widget.chartSmooth !== false ? 'smooth' : 'straight', width: 2.5},
      fill:
        chartType === 'area'
          ? {type: 'gradient', gradient: {opacityFrom: 0.42, opacityTo: 0.04}}
          : {type: 'solid', opacity: 1},
      dataLabels: {enabled: false},
      grid: {borderColor: 'rgba(148,163,184,0.14)', strokeDashArray: 3, padding: {left: 4, right: 6, top: -4, bottom: -4}},
      xaxis: {
        categories: hist?.timestamps ?? [],
        labels: {show: false},
        axisBorder: {show: false},
        axisTicks: {show: false},
      },
      yaxis: {
        min: 0,
        max: isNet ? undefined : 100,
        labels: {
          style: {colors: '#94A3B8', fontSize: chartFontSize},
          formatter: (val) => (isNet ? `${Math.round(val)}` : `${Math.round(val)}%`),
        },
      },
      legend: {
        show: isNet,
        position: 'top',
        horizontalAlign: 'right',
        fontSize: chartFontSize,
        labels: {colors: widget.textColor || '#CBD5E1'},
        markers: {size: 6},
      },
      tooltip: {enabled: false},
    };
    return {chartType, options, series};
  }, [boundEntities, telemetry, widget.binding, widget.accentColor, widget.textColor, widget.chartSmooth, widget.chartVariant, resolvedFontFamily, uiScale]);

  const radialConfig = useMemo<{options: ApexOptions; series: number[]}>(() => {
    let value = 0;
    let label = 'Value';
    if (boundEntity && boundEntity.numericValue !== null) {
      value = boundEntity.numericValue;
      label = boundEntity.tag.slice(0, 14);
    } else if (telemetry) {
      const binding = widget.binding ?? 'array_percent';
      if (binding === 'cpu_percent') {
        value = telemetry.system?.cpuPercent ?? 0;
        label = 'CPU';
      } else if (binding === 'ram_percent') {
        value = Math.round(((telemetry.system?.ramUsedBytes ?? 0) / Math.max(1, telemetry.system?.ramTotalBytes ?? 1)) * 100);
        label = 'RAM';
      } else if (binding === 'ups_load') {
        value = telemetry.ups?.loadPercent ?? 0;
        label = `${telemetry.ups?.currentPowerW ?? 0}W`;
      } else {
        value = Math.round(((telemetry.array?.usedBytes ?? 0) / Math.max(1, telemetry.array?.totalBytes ?? 1)) * 100);
        label = 'ARRAY';
      }
    }
    const r = Math.max(20, Math.min(bodyW, bodyH) * 0.43);
    const valPx = Math.round(Math.max(22, Math.min(34, r * 0.52)) * Math.min(1.25, scale));
    const lblPx = Math.round(Math.max(11.5, Math.min(15, r * 0.22)) * Math.min(1.25, scale));
    const options: ApexOptions = {
      chart: {fontFamily: resolvedFontFamily},
      colors: [widget.accentColor],
      plotOptions: {
        radialBar: {
          hollow: {size: '56%'},
          track: {background: 'rgba(148,163,184,0.18)'},
          dataLabels: {
            name: {show: true, fontSize: `${lblPx}px`, color: '#94A3B8', offsetY: 18},
            value: {
              show: true,
              fontSize: `${valPx}px`,
              fontWeight: 700,
              color: widget.textColor,
              offsetY: -10,
              formatter: (v) => `${Math.round(v)}${boundEntity?.unit || '%'}`,
            },
          },
        },
      },
      labels: [label],
    };
    return {options, series: [Math.min(100, Math.max(0, value))]};
  }, [boundEntity, telemetry, widget.binding, widget.accentColor, widget.textColor, resolvedFontFamily, bodyW, bodyH, scale]);

  const barConfig = useMemo<{options: ApexOptions; series: ApexOptions['series']}>(() => {
    const isHorizontal = widget.type === 'apex_hbar';
    const valPx = `${Math.round(12 * Math.min(1.25, scale))}px`;
    const lblPx = `${Math.round(11.5 * Math.min(1.2, scale))}px`;

    if (boundEntities.length > 0) {
      const categories = boundEntities.map((e) => e.tag.slice(0, 14));
      const data = boundEntities.map((e) => Number((e.numericValue ?? 0).toFixed(1)));
      const commonUnit = boundEntities.every((e) => e.unit === boundEntities[0].unit) ? boundEntities[0].unit : '';
      const allPct = boundEntities.every((e) => e.unit === '%');

      const options: ApexOptions = {
        chart: {fontFamily: resolvedFontFamily},
        colors: [widget.accentColor],
        plotOptions: {
          bar: isHorizontal
            ? {horizontal: true, borderRadius: 3, barHeight: '62%'}
            : {horizontal: false, borderRadius: 3, columnWidth: '58%'},
        },
        dataLabels: {
          enabled: true,
          style: {fontSize: valPx, colors: [widget.textColor || '#F8FAFC']},
          formatter: (v) => `${v}${commonUnit}`,
        },
        grid: {borderColor: 'rgba(148,163,184,0.12)', padding: {top: -6, bottom: -4, left: 6, right: 8}},
        xaxis: {
          categories,
          labels: {style: {colors: '#94A3B8', fontSize: lblPx}},
          axisBorder: {show: false},
          axisTicks: {show: false},
        },
        yaxis: isHorizontal
          ? {
              min: 0,
              max: allPct ? 100 : undefined,
              labels: {style: {colors: widget.textColor || '#CBD5E1', fontSize: valPx}},
            }
          : {min: 0, max: allPct ? 100 : undefined, labels: {show: false}},
        tooltip: {enabled: false},
      };
      return {options, series: [{name: widget.title || 'Value', data}]};
    }

    const disks = (telemetry?.disks ?? []).slice(0, 6);
    const categories = disks.map((d) => d.name.replace('Cache NVMe 1', 'NVMe0').replace('ZFS Pool NVMe', 'NVMe1'));
    const data = disks.map((d) => d.tempC);
    const options: ApexOptions = {
      chart: {fontFamily: resolvedFontFamily},
      colors: [widget.accentColor],
      plotOptions: {
        bar: isHorizontal
          ? {horizontal: true, borderRadius: 3, barHeight: '62%'}
          : {horizontal: false, borderRadius: 3, columnWidth: '58%'},
      },
      dataLabels: {
        enabled: true,
        style: {fontSize: valPx, colors: [widget.textColor || '#F8FAFC']},
        formatter: (v) => `${v}°`,
      },
      grid: {borderColor: 'rgba(148,163,184,0.12)', padding: {top: -6, bottom: -4, left: 4, right: 6}},
      xaxis: {
        categories,
        labels: {style: {colors: '#94A3B8', fontSize: lblPx}},
        axisBorder: {show: false},
        axisTicks: {show: false},
      },
      yaxis: isHorizontal
        ? {min: 0, max: 65, labels: {style: {colors: widget.textColor || '#CBD5E1', fontSize: valPx}}}
        : {min: 0, max: 65, labels: {show: false}},
      tooltip: {enabled: false},
    };
    return {options, series: [{name: 'Temp C', data}]};
  }, [boundEntities, telemetry, widget.type, widget.title, widget.accentColor, widget.textColor, resolvedFontFamily, scale]);

  const customApexParsed = useMemo<{
    error: string | null;
    type: 'area' | 'line' | 'bar' | 'radialBar' | 'donut';
    options: ApexOptions;
    series: ApexOptions['series'];
  }>(() => {
    const raw = widget.apexCode || '{}';
    try {
      let hydrated = raw.replace(/"\{\{history:([^}]+)\}\}"/g, (_m, id: string) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.history ?? []);
      });
      hydrated = hydrated.replace(/"\{\{([^}]+)\}\}"/g, (_m, id: string) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.numericValue ?? ent?.rawValue ?? 0);
      });
      const parsed = JSON.parse(hydrated) as ApexOptions & {
        chart?: {type?: 'area' | 'line' | 'bar' | 'radialBar' | 'donut'};
      };
      const chartType = parsed.chart?.type ?? 'area';
      const series = parsed.series ?? [];
      return {error: null, type: chartType, options: parsed, series};
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Invalid ApexCharts JSON',
        type: 'area',
        options: {},
        series: [],
      };
    }
  }, [widget.apexCode, exposedEntities]);

  const customHtmlRendered = useMemo(() => {
    if (widget.type !== 'custom_html') return '';
    const interpolated = resolveTemplateText(widget.htmlCode || '', exposedEntities);
    return sanitizeHtml(interpolated);
  }, [widget.type, widget.htmlCode, exposedEntities]);

  if (widget.type === 'divider') {
    return (
      <div className="w-full h-full flex items-center px-1">
        <div className="w-full h-px" style={{backgroundColor: widget.accentColor, opacity: 0.65}} />
      </div>
    );
  }

  if (widget.type === 'image_layer') {
    const isVideo = isVideoMedia(widget.imageUrl, widget.mediaType);
    return (
      <div className="w-full h-full rounded border overflow-hidden relative" style={containerStyle}>
        {widget.bgImageUrl && (
          <img
            src={widget.bgImageUrl}
            alt=""
            referrerPolicy="no-referrer"
            style={{opacity: widget.bgImageOpacity ?? 1}}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          />
        )}
        {widget.imageUrl ? (
          isVideo ? (
            <video
              src={widget.imageUrl}
              autoPlay
              loop
              muted
              playsInline
              className={`relative z-10 w-full h-full pointer-events-none ${
                widget.imageFit === 'contain' ? 'object-contain' : 'object-cover'
              }`}
            />
          ) : (
            <img
              src={widget.imageUrl}
              alt={widget.title}
              referrerPolicy="no-referrer"
              className={`relative z-10 w-full h-full pointer-events-none ${
                widget.imageFit === 'contain' ? 'object-contain' : 'object-cover'
              }`}
            />
          )
        ) : (
          <div className="relative z-10 w-full h-full flex items-center justify-center text-xs opacity-60">
            No image, GIF, or video selected
          </div>
        )}
      </div>
    );
  }

  const blockBgLayers = (
    <>
      {widget.bgImageUrl && (
        <img
          src={widget.bgImageUrl}
          alt=""
          referrerPolicy="no-referrer"
          style={{opacity: widget.bgImageOpacity ?? 1}}
          className={`absolute inset-0 w-full h-full pointer-events-none ${
            widget.bgImageFit === 'contain' ? 'object-contain' : 'object-cover'
          }`}
        />
      )}
      {widget.bgImageUrl && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{backgroundColor: hexToRgba(widget.bgColor, widget.bgOpacity)}}
        />
      )}
    </>
  );

  if (widget.type === 'custom_html') {
    return (
      <div
        className="w-full h-full rounded border overflow-hidden relative"
        style={{...containerStyle, fontSize: `${Math.min(1.4, scale)}em`}}
      >
        {blockBgLayers}
        <div
          className="relative z-10 w-full h-full overflow-hidden"
          dangerouslySetInnerHTML={{__html: customHtmlRendered}}
        />
      </div>
    );
  }

  if (widget.type === 'custom_text') {
    const renderedText = resolveTemplateText(widget.customText || widget.title, exposedEntities);
    return (
      <div
        className="w-full h-full rounded border px-3.5 py-2 flex items-center justify-between overflow-hidden relative"
        style={containerStyle}
      >
        {blockBgLayers}
        <span
          className="relative z-10 font-semibold tracking-tight truncate"
          style={{fontSize: `${Math.round(18 * scale)}px`, lineHeight: 1.2}}
        >
          {renderedText}
        </span>
      </div>
    );
  }

  const displayTitle = boundEntity && widget.type === 'entity_number'
    ? widget.title || boundEntity.tag
    : widget.title;

  const header = (
    <div className="relative z-10 flex items-center justify-between gap-2 mb-1.5 shrink-0">
      <span
        className="font-semibold tracking-wide opacity-80 truncate"
        style={{fontSize: `${titleSize}px`, lineHeight: 1.15}}
      >
        {displayTitle}
      </span>
      <span className="w-2 h-2 rounded-full shrink-0" style={{backgroundColor: widget.accentColor}} />
    </div>
  );

  return (
    <div
      className="w-full h-full rounded border px-3 py-2.5 flex flex-col justify-between overflow-hidden relative"
      style={containerStyle}
    >
      {blockBgLayers}
      {header}
      <div className="relative z-10 flex flex-col justify-between flex-1 min-h-0">

      {widget.type === 'entity_number' && (() => {
        const val = boundEntity ? String(boundEntity.rawValue) : '—';
        const unit = boundEntity?.unit ?? '';
        const tag = boundEntity?.tag ?? widget.entityId ?? 'Unbound';
        const subSize = Math.round(13 * uiScale);
        const availH = Math.max(24, bodyH - subSize - 6);
        const baseNum = Math.max(28, Math.min(54, availH * 0.72));
        const charUnits = Math.max(1.5, val.length + (unit ? unit.length * 0.62 + 0.5 : 0));
        const maxFitW = bodyW / (charUnits * 0.64);
        const numSize = Math.round(Math.max(22, Math.min(baseNum * uiScale, maxFitW)));
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex-1 flex items-center min-h-0">
              <div
                className="font-bold tabular-nums leading-none truncate"
                style={{color: widget.accentColor, fontSize: `${numSize}px`}}
              >
                {val}
                {unit ? (
                  <span
                    className="font-semibold ml-1.5 opacity-88"
                    style={{fontSize: `${Math.round(numSize * 0.55)}px`}}
                  >
                    {unit}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="opacity-70 truncate leading-tight" style={{fontSize: `${subSize}px`}}>
              {tag}
            </div>
          </div>
        );
      })()}

      {widget.type === 'entity_list' && (() => {
        const itemSize = Math.round(Math.max(12.5, Math.min(16, bodyH * 0.145)) * Math.min(1.25, scale));
        const rowStep = Math.round(itemSize * 1.58);
        const maxRows = Math.min(widget.maxItems ?? 5, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
        return (
          <div className="flex flex-col justify-center gap-1.5 flex-1 min-h-0 overflow-hidden">
            {boundEntities.length === 0 ? (
              <div className="opacity-60" style={{fontSize: `${itemSize}px`}}>Add entities in block settings</div>
            ) : (
              boundEntities.slice(0, maxRows).map((ent) => (
                <div
                  key={ent.id}
                  className="flex items-center justify-between gap-2 leading-tight"
                  style={{fontSize: `${itemSize}px`}}
                >
                  <span className="truncate opacity-90">{ent.tag}</span>
                  <span className="font-bold tabular-nums shrink-0" style={{color: widget.accentColor}}>
                    {ent.rawValue}
                    {ent.unit ? (
                      <span className="font-medium ml-0.5 opacity-85" style={{fontSize: `${Math.round(itemSize * 0.88)}px`}}>
                        {ent.unit}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))
            )}
          </div>
        );
      })()}

      {widget.type === 'clock' && (() => {
        const footerSize = Math.round(13 * uiScale);
        const availH = Math.max(28, bodyH - footerSize - 8);
        const maxByWidth = bodyW / 4.95;
        const maxByHeight = availH * 0.78;
        const clockSize = Math.round(Math.max(26, Math.min(maxByWidth, Math.min(80, maxByHeight * uiScale))));
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex-1 flex items-center min-h-0">
              <div
                className="leading-none font-bold tracking-tight tabular-nums"
                style={{fontSize: `${clockSize}px`}}
              >
                {now.toLocaleTimeString('en-US', {hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'})}
              </div>
            </div>
            <div
              className="flex items-center justify-between opacity-75 leading-tight"
              style={{fontSize: `${footerSize}px`}}
            >
              <span>{now.toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric'})}</span>
              <span>UP {formatUptime(telemetry?.system?.uptimeSeconds ?? 0)}</span>
            </div>
          </div>
        );
      })()}

      {widget.type === 'cpu_load' && (() => {
        const heroSize = Math.round(Math.max(26, Math.min(44, bodyH * 0.42)) * uiScale);
        const metaSize = Math.round(14 * uiScale);
        const footerSize = Math.round(13 * uiScale);
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="font-bold tabular-nums leading-none"
                style={{color: widget.accentColor, fontSize: `${heroSize}px`}}
              >
                {telemetry?.system?.cpuPercent ?? 0}%
              </span>
              <span className="opacity-85 tabular-nums truncate" style={{fontSize: `${metaSize}px`}}>
                {telemetry?.system?.cpuTempC ?? 0}°C · {telemetry?.system?.cpuPowerW ?? 0}W
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-[3px] overflow-hidden my-1">
              <div
                className="h-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, telemetry?.system?.cpuPercent ?? 0)}%`,
                  backgroundColor: widget.accentColor,
                }}
              />
            </div>
            <div className="opacity-72 flex justify-between tabular-nums leading-tight" style={{fontSize: `${footerSize}px`}}>
              <span>LOAD</span>
              <span>{(telemetry?.system?.loadAvg ?? [0, 0, 0]).join(' / ')}</span>
            </div>
          </div>
        );
      })()}

      {widget.type === 'memory_bar' && (() => {
        const total = telemetry?.system?.ramTotalBytes ?? 1;
        const used = telemetry?.system?.ramUsedBytes ?? 0;
        const cached = telemetry?.system?.ramCachedBytes ?? 0;
        const pct = Math.round((used / Math.max(1, total)) * 100);
        const heroSize = Math.round(Math.max(24, Math.min(40, bodyH * 0.4)) * uiScale);
        const metaSize = Math.round(13.5 * uiScale);
        const footerSize = Math.round(13 * uiScale);
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-bold tabular-nums leading-none" style={{fontSize: `${heroSize}px`}}>{pct}%</span>
              <span className="opacity-85 tabular-nums truncate" style={{fontSize: `${metaSize}px`}}>
                {formatBytes(used, 1)} / {formatBytes(total, 0)}
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-800 rounded-[3px] overflow-hidden flex my-1">
              <div style={{width: `${pct}%`, backgroundColor: widget.accentColor}} className="h-full" />
            </div>
            <div className="flex justify-between opacity-72 tabular-nums leading-tight" style={{fontSize: `${footerSize}px`}}>
              <span>ARC / Cache</span>
              <span>{formatBytes(cached, 1)}</span>
            </div>
          </div>
        );
      })()}

      {widget.type === 'array_status' && (() => {
        const arr = telemetry?.array;
        const total = arr?.totalBytes ?? 1;
        const used = arr?.usedBytes ?? 0;
        const pct = Math.round((used / Math.max(1, total)) * 100);
        const stateSize = Math.round(19 * uiScale);
        const capSize = Math.round(16 * uiScale);
        const footerSize = Math.round(13 * uiScale);
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2">
              <span
                className="font-bold leading-none"
                style={{color: arr?.parityValid ? '#10B981' : '#EF4444', fontSize: `${stateSize}px`}}
              >
                {arr?.state ?? 'STARTED'}
              </span>
              <span className="font-semibold opacity-90 tabular-nums" style={{fontSize: `${capSize}px`}}>
                {formatBytes(used, 1)} / {formatBytes(total, 1)}
              </span>
            </div>
            <div className="w-full h-[11px] bg-slate-800 rounded-[3px] overflow-hidden my-1">
              <div style={{width: `${pct}%`, backgroundColor: widget.accentColor}} className="h-full" />
            </div>
            <div className="flex justify-between opacity-75 leading-tight" style={{fontSize: `${footerSize}px`}}>
              <span>Parity: {arr?.parityValid ? 'Valid' : 'Degraded'}</span>
              <span>Free: {formatBytes(arr?.freeBytes ?? 0, 1)}</span>
            </div>
          </div>
        );
      })()}

      {widget.type === 'docker_list' && (() => {
        const itemSize = Math.round(14 * Math.min(1.25, scale));
        const statSize = Math.round(13 * Math.min(1.25, scale));
        const iconSize = Math.round(itemSize * 1.28);
        const rowStep = Math.round(itemSize * 1.85);
        const maxRows = Math.min(widget.maxItems ?? 5, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
        const running = (telemetry?.containers ?? []).filter((c) => c.state === 'running').slice(0, maxRows);
        return (
          <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-hidden">
            {running.length === 0 ? (
              <div className="opacity-60" style={{fontSize: `${itemSize}px`}}>No running containers</div>
            ) : (
              running.map((c) => {
                const iconUrl = dockerIcons?.[c.name];
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 leading-tight"
                    style={{fontSize: `${itemSize}px`, minHeight: `${Math.max(iconSize, itemSize + 4)}px`}}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {iconUrl ? (
                        <img
                          src={iconUrl}
                          alt={c.name}
                          referrerPolicy="no-referrer"
                          style={{width: `${iconSize}px`, height: `${iconSize}px`}}
                          className="rounded-sm object-cover shrink-0"
                        />
                      ) : (
                        <span
                          className="rounded-sm font-bold uppercase flex items-center justify-center shrink-0"
                          style={{
                            width: `${iconSize}px`,
                            height: `${iconSize}px`,
                            fontSize: `${Math.round(iconSize * 0.5)}px`,
                            backgroundColor: 'rgba(148,163,184,0.2)',
                            color: widget.accentColor,
                          }}
                        >
                          {c.name.slice(0, 2)}
                        </span>
                      )}
                      <span className="truncate opacity-95">{c.name}</span>
                    </div>
                    <span className="opacity-75 tabular-nums shrink-0" style={{fontSize: `${statSize}px`}}>
                      {c.cpuPercent.toFixed(1)}% · {c.memUsedMB}M
                    </span>
                  </div>
                );
              })
            )}
          </div>
        );
      })()}

      {widget.type === 'active_tasks' && (() => {
        const itemSize = Math.round(13.5 * Math.min(1.25, scale));
        const rowStep = Math.round(itemSize * 2.15);
        const maxRows = Math.min(widget.maxItems ?? 3, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
        const tasks = (telemetry?.tasks ?? []).slice(0, maxRows);
        return (
          <div className="flex flex-col gap-2 flex-1 min-h-0 overflow-hidden">
            {tasks.length === 0 ? (
              <div className="opacity-60" style={{fontSize: `${itemSize}px`}}>No active tasks</div>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between leading-tight" style={{fontSize: `${itemSize}px`}}>
                    <span className="truncate opacity-92 max-w-[68%]">{task.name}</span>
                    <span
                      className="tabular-nums font-semibold"
                      style={{color: task.status === 'running' ? widget.accentColor : '#94A3B8'}}
                    >
                      {task.status === 'running' ? `${task.progressPercent}%` : task.status}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-[3px] overflow-hidden">
                    <div
                      className="h-full"
                      style={{
                        width: `${task.status === 'running' ? task.progressPercent : task.status === 'idle' ? 100 : 0}%`,
                        backgroundColor: task.status === 'running' ? widget.accentColor : '#334155',
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        );
      })()}

      {widget.type === 'active_users' && (() => {
        const itemSize = Math.round(13.5 * Math.min(1.25, scale));
        const statSize = Math.round(itemSize * 0.92);
        const rowStep = Math.round(itemSize * 1.7);
        const maxRows = Math.min(widget.maxItems ?? 3, Math.max(1, Math.floor((bodyH + 2) / rowStep)));
        const sessions = (telemetry?.sessions ?? []).slice(0, maxRows);
        return (
          <div className="flex flex-col gap-1.5 flex-1 min-h-0 overflow-hidden">
            {sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between leading-tight" style={{fontSize: `${itemSize}px`}}>
                <span className="opacity-92 truncate max-w-[58%]">
                  {s.username}@{s.clientIp}
                </span>
                <span className="opacity-75 tabular-nums" style={{fontSize: `${statSize}px`}}>
                  {s.protocol} · {s.throughputMBps.toFixed(1)} MB/s
                </span>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="opacity-60" style={{fontSize: `${itemSize}px`}}>No active SMB/SSH sessions</div>
            )}
          </div>
        );
      })()}

      {widget.type === 'disk_thermals' && (() => {
        const itemSize = Math.round(13.5 * Math.min(1.25, scale));
        const rowStep = Math.round(itemSize * 1.7);
        const maxRows = Math.max(1, Math.floor((bodyH + 2) / rowStep));
        const disks = (telemetry?.disks ?? []).slice(0, Math.min(widget.maxItems ?? 6, 2 * maxRows));
        return (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 flex-1 min-h-0 overflow-hidden">
            {disks.map((d) => (
              <div key={d.id} className="flex items-center justify-between leading-tight" style={{fontSize: `${itemSize}px`}}>
                <span className="opacity-88 truncate">{d.name}</span>
                <span
                  className="tabular-nums font-bold"
                  style={{color: d.tempC >= 48 ? '#EF4444' : d.spinState === 'standby' ? '#64748B' : '#10B981'}}
                >
                  {d.spinState === 'standby' ? 'STBY' : `${d.tempC}°C`}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {widget.type === 'ha_entity' && (() => {
        const entity = haEntities.find((e) => e.entity_id === widget.haEntityId);
        const unit = entity?.attributes.unit_of_measurement ?? '';
        const friendly =
          entity?.attributes.friendly_name ??
          (widget.haEntityId || (haEntities.length === 0 ? 'Connect Home Assistant in Connections' : 'Select HA Entity'));
        const valStr = entity ? `${entity.state}${unit ? ` ${unit}` : ''}` : 'HA Offline';
        const subSize = Math.round(13 * uiScale);
        const availH = Math.max(24, bodyH - subSize - 6);
        const baseNum = Math.max(24, Math.min(46, availH * 0.68));
        const maxFitW = bodyW / (Math.max(2, valStr.length) * 0.64);
        const valSize = Math.round(Math.max(18, Math.min(baseNum * uiScale, maxFitW)));
        return (
          <div className="flex flex-col justify-between flex-1 min-h-0">
            <div className="flex-1 flex items-center min-h-0">
              <div
                className="font-bold tabular-nums leading-none truncate"
                style={{color: widget.accentColor, fontSize: `${valSize}px`}}
              >
                {valStr}
              </div>
            </div>
            <div className="opacity-72 truncate leading-tight" style={{fontSize: `${subSize}px`}}>{friendly}</div>
          </div>
        );
      })()}

      {widget.type === 'apex_area' && (
        <div className="flex-1 min-h-0 -mx-1">
          <ApexChartBox
            type={areaConfig.chartType}
            options={areaConfig.options}
            series={areaConfig.series}
            height={chartHeight}
          />
        </div>
      )}

      {widget.type === 'apex_radial' && (
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <ApexChartBox type="radialBar" options={radialConfig.options} series={radialConfig.series} height={chartHeight} />
        </div>
      )}

      {(widget.type === 'apex_bar' || widget.type === 'apex_hbar') && (
        <div className="flex-1 min-h-0 -mx-1">
          <ApexChartBox type="bar" options={barConfig.options} series={barConfig.series} height={chartHeight} />
        </div>
      )}

      {widget.type === 'apex_custom' && (
        <div className="flex-1 min-h-0 -mx-1 flex items-center justify-center">
          {customApexParsed.error ? (
            <div className="text-[10px] text-red-400 px-2 text-center">
              JSON Error: {customApexParsed.error}
            </div>
          ) : (
            <ApexChartBox
              type={customApexParsed.type}
              options={customApexParsed.options}
              series={customApexParsed.series}
              height={chartHeight}
            />
          )}
        </div>
      )}
      </div>
    </div>
  );
}
