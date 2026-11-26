import fs from 'node:fs';
import path from 'node:path';
import {Resvg} from '@resvg/resvg-js';
import type {
  ExposedEntity,
  FontFamilyOption,
  FontSizePreset,
  HomeAssistantEntity,
  LcdScreen,
  ScreenWidget,
  TelemetrySnapshot,
} from '../types.ts';
import {
  applyBrightnessScaleRgba,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  encodePngRgba,
} from './aoostar/protocol.ts';

const LCD_W = DISPLAY_WIDTH; // 960
const LCD_H = DISPLAY_HEIGHT; // 376

const MULTI_SERIES_PALETTE = ['#F59E0B', '#38BDF8', '#10B981', '#A78BFA', '#F43F5E', '#FB923C'];

const FONT_SIZE_MULTIPLIER: Record<FontSizePreset, number> = {
  sm: 0.85,
  md: 1,
  lg: 1.2,
  xl: 1.45,
  '2xl': 1.75,
};

let cachedFontFiles: string[] | null = null;

function discoverFontFiles(): string[] {
  if (cachedFontFiles) return cachedFontFiles;
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf',
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Regular.ttf',
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Medium.ttf',
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-SemiBold.ttf',
    '/usr/share/fonts/truetype/jetbrains-mono/JetBrainsMono-Bold.ttf',
    '/app/asterctl-fonts/DejaVuSans.ttf',
    '/app/asterctl-fonts/JetBrainsMono-Regular.ttf',
  ];
  const found: string[] = [];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) found.push(p);
    } catch {
      // ignore
    }
  }
  cachedFontFiles = found;
  return found;
}

const imageDataUriCache = new Map<string, {mtimeMs: number; dataUri: string}>();

function resolveLocalImageDataUri(rawUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const url = rawUrl.trim();
  if (!url) return null;

  // Allow safe raster data URIs directly (explicitly block SVG data URIs)
  if (/^data:image\/(png|jpeg|jpg|webp|gif|avif);base64,[a-z0-9+/=\s]+$/i.test(url)) {
    return url;
  }

  let diskPath: string | null = null;
  const cwd = process.cwd();

  if (url.startsWith('/uploads/')) {
    const uploadsRoot = path.resolve(cwd, 'data', 'uploads');
    const candidate = path.resolve(uploadsRoot, path.basename(url.split('?')[0]));
    if (candidate.startsWith(uploadsRoot + path.sep)) {
      diskPath = candidate;
    }
  } else if (url.startsWith('/src/assets/images/')) {
    const baseName = path.basename(url.split('?')[0]);
    const assetsRoot = path.resolve(cwd, 'src', 'assets', 'images');
    const candidate = path.resolve(assetsRoot, baseName);
    if (candidate.startsWith(assetsRoot + path.sep) && fs.existsSync(candidate)) {
      diskPath = candidate;
    } else {
      const distAssetsRoot = path.resolve(cwd, 'dist', 'assets');
      if (fs.existsSync(distAssetsRoot)) {
        const parsed = path.parse(baseName);
        try {
          const matched = fs
            .readdirSync(distAssetsRoot)
            .find(
              (f) =>
                f === baseName ||
                (f.startsWith(`${parsed.name}-`) && f.endsWith(parsed.ext))
            );
          if (matched) {
            const distCandidate = path.resolve(distAssetsRoot, matched);
            if (distCandidate.startsWith(distAssetsRoot + path.sep)) {
              diskPath = distCandidate;
            }
          }
        } catch {
          // ignore
        }
      }
    }
  } else if (url.startsWith('/assets/')) {
    const distAssetsRoot = path.resolve(cwd, 'dist', 'assets');
    const candidate = path.resolve(distAssetsRoot, path.basename(url.split('?')[0]));
    if (candidate.startsWith(distAssetsRoot + path.sep)) {
      diskPath = candidate;
    }
  }

  if (!diskPath) return null;

  try {
    const st = fs.statSync(diskPath);
    if (!st.isFile() || st.size <= 0 || st.size > 16 * 1024 * 1024) return null;

    const cached = imageDataUriCache.get(diskPath);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      return cached.dataUri;
    }

    const ext = path.extname(diskPath).toLowerCase();
    const mime =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.avif'
                ? 'image/avif'
                : null;
    if (!mime) return null;

    const b64 = fs.readFileSync(diskPath).toString('base64');
    const dataUri = `data:${mime};base64,${b64}`;
    if (imageDataUriCache.size > 64) imageDataUriCache.clear();
    imageDataUriCache.set(diskPath, {mtimeMs: st.mtimeMs, dataUri});
    return dataUri;
  } catch {
    return null;
  }
}

function escapeXml(raw: string | number | null | undefined): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeColor(raw: string | undefined, fallback = '#0F1520'): string {
  const val = (raw || '').trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}|[0-9a-fA-F]{5})?$/.test(val)) return val;
  if (/^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(\s*,\s*[\d.]+)?\s*\)$/i.test(val)) return val;
  return fallback;
}

function formatBytesCompact(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

function formatUptimeShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}

function fontForOption(option?: FontFamilyOption): string {
  if (option === 'display' || option === 'sans') {
    return 'DejaVu Sans, sans-serif';
  }
  return 'JetBrains Mono, DejaVu Sans Mono, monospace';
}

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

function isVideoMedia(url?: string, mediaType?: 'image' | 'video'): boolean {
  if (mediaType === 'video') return true;
  if (!url) return false;
  return /\.(mp4|webm)(\?|$)/i.test(url) || url.startsWith('data:video/');
}

function truncateChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1)}…`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): {x: number; y: number} {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const clampedEnd = Math.min(startDeg + 359.6, endDeg);
  const start = polarToCartesian(cx, cy, r, clampedEnd);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArcFlag = clampedEnd - startDeg <= 180 ? '0' : '1';
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function renderLineAreaSeriesSvg(params: {
  x: number;
  y: number;
  w: number;
  h: number;
  seriesList: Array<{name: string; color: string; data: number[]}>;
  isArea: boolean;
  isSmooth: boolean;
  unit: string;
  textColor: string;
  uid: string;
  yMinOverride?: number;
  yMaxOverride?: number;
}): string {
  const {x, y, w, h, seriesList, isArea, isSmooth, unit, textColor, uid} = params;
  if (w < 24 || h < 24) return '';

  const nonEmpty = seriesList.filter((s) => s.data.length > 0);
  if (nonEmpty.length === 0) {
    return `<text x="${x + w / 2}" y="${y + h / 2 + 4}" text-anchor="middle" font-size="11" fill="#94A3B8">Collecting telemetry samples…</text>`;
  }

  const allVals = nonEmpty.flatMap((s) => s.data);
  let minV = params.yMinOverride !== undefined ? params.yMinOverride : Math.min(...allVals);
  let maxV = params.yMaxOverride !== undefined ? params.yMaxOverride : Math.max(...allVals);
  if (minV === maxV) {
    minV = Math.max(0, minV - 5);
    maxV = maxV + 5;
  }
  const span = Math.max(0.001, maxV - minV);

  const legendH = nonEmpty.length > 1 ? 14 : 0;
  const padLeft = 28;
  const padRight = 6;
  const padTop = 6 + legendH;
  const padBottom = 8;
  const plotX = x + padLeft;
  const plotY = y + padTop;
  const plotW = Math.max(16, w - padLeft - padRight);
  const plotH = Math.max(16, h - padTop - padBottom);

  const parts: string[] = [];

  // Legend
  if (nonEmpty.length > 1) {
    let lx = x + w - 4;
    for (let i = nonEmpty.length - 1; i >= 0; i--) {
      const s = nonEmpty[i];
      const lbl = truncateChars(s.name, 14);
      const estW = lbl.length * 5.6 + 14;
      lx -= estW;
      if (lx < x + 4) break;
      parts.push(`<circle cx="${lx + 4}" cy="${y + 7}" r="3" fill="${safeColor(s.color)}" />`);
      parts.push(
        `<text x="${lx + 10}" y="${y + 10}" font-size="9" fill="${textColor}" fill-opacity="0.82">${escapeXml(lbl)}</text>`
      );
    }
  }

  // Horizontal dashed gridlines & Y labels
  for (let g = 0; g <= 2; g++) {
    const frac = g / 2;
    const gy = plotY + frac * plotH;
    const valAtLine = Math.round(maxV - frac * span);
    parts.push(
      `<line x1="${plotX}" y1="${gy.toFixed(1)}" x2="${plotX + plotW}" y2="${gy.toFixed(1)}" stroke="#94A3B8" stroke-opacity="0.18" stroke-dasharray="3 3" stroke-width="1" />`
    );
    parts.push(
      `<text x="${plotX - 4}" y="${(gy + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="#94A3B8">${escapeXml(
        `${valAtLine}${unit}`
      )}</text>`
    );
  }

  nonEmpty.forEach((s, idx) => {
    const ptsRaw = s.data.length === 1 ? [s.data[0], s.data[0]] : s.data;
    const pts = ptsRaw.map((v, i) => {
      const px = plotX + (i / Math.max(1, ptsRaw.length - 1)) * plotW;
      const py = plotY + plotH - ((v - minV) / span) * plotH;
      return {x: px, y: Math.max(plotY, Math.min(plotY + plotH, py))};
    });

    let lineD = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    if (isSmooth && pts.length > 2) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i + 1];
        const midX = ((p0.x + p1.x) / 2).toFixed(1);
        lineD += ` C ${midX} ${p0.y.toFixed(1)}, ${midX} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
      }
    } else {
      for (let i = 1; i < pts.length; i++) {
        lineD += ` L ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
      }
    }

    const col = safeColor(s.color, '#F59E0B');
    if (isArea) {
      const gradId = `grad-${uid}-${idx}`;
      parts.push(
        `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${col}" stop-opacity="0.38" /><stop offset="100%" stop-color="${col}" stop-opacity="0.03" /></linearGradient></defs>`
      );
      const areaD = `${lineD} L ${pts[pts.length - 1].x.toFixed(1)} ${(plotY + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(plotY + plotH).toFixed(1)} Z`;
      parts.push(`<path d="${areaD}" fill="url(#${gradId})" />`);
    }
    parts.push(`<path d="${lineD}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`);
  });

  return parts.join('');
}

function renderWidgetSvg(params: {
  w: ScreenWidget;
  telemetry: TelemetrySnapshot;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  dockerIcons: Record<string, string>;
  index: number;
  now: Date;
}): string {
  const {w, telemetry, haEntities, exposedEntities, dockerIcons, index, now} = params;
  const uid = `w${index}`;
  const accent = safeColor(w.accentColor, '#F59E0B');
  const textCol = safeColor(w.textColor, '#F8FAFC');
  const bgCol = safeColor(w.bgColor, '#0D131D');
  const bgOpacity = Math.max(0, Math.min(1, w.bgOpacity ?? 0.78));
  const borderOpacity = Math.max(0, Math.min(1, w.borderOpacity ?? 0.25));
  const fontFamily = fontForOption(w.fontFamily);
  const fontPresetScale = FONT_SIZE_MULTIPLIER[w.fontSizePreset ?? 'md'] ?? 1;
  const scale = Math.max(0.5, Math.min(2.5, (w.fontScale || 1) * fontPresetScale));

  if (w.type === 'divider') {
    const cy = w.y + w.h / 2;
    return `<line x1="${w.x + 4}" y1="${cy}" x2="${w.x + w.w - 4}" y2="${cy}" stroke="${accent}" stroke-opacity="0.65" stroke-width="1.2" />`;
  }

  const clipId = `clip-${uid}`;
  const parts: string[] = [
    `<defs><clipPath id="${clipId}"><rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" /></clipPath></defs>`,
    `<g font-family="${fontFamily}" clip-path="url(#${clipId})">`,
  ];

  const bgImageData = resolveLocalImageDataUri(w.bgImageUrl);
  if (bgImageData) {
    const par = w.bgImageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
    const bgImgOp = Math.max(0, Math.min(1, w.bgImageOpacity ?? 1));
    parts.push(
      `<image href="${bgImageData}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" preserveAspectRatio="${par}" opacity="${bgImgOp}" />`
    );
  }

  if (w.type === 'image_layer') {
    parts.push(
      `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" fill="${bgCol}" fill-opacity="${bgOpacity}" />`
    );
    if (isVideoMedia(w.imageUrl, w.mediaType)) {
      parts.push(
        `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 - 4}" text-anchor="middle" font-size="11" font-weight="600" fill="${accent}">VIDEO LAYER</text>`
      );
      parts.push(
        `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 + 13}" text-anchor="middle" font-size="10" fill="#94A3B8">${escapeXml(
          truncateChars(w.title || 'Looping Media', 24)
        )}</text>`
      );
    } else {
      const layerData = resolveLocalImageDataUri(w.imageUrl);
      if (layerData) {
        const par = w.imageFit === 'contain' ? 'xMidYMid meet' : 'xMidYMid slice';
        parts.push(
          `<image href="${layerData}" x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" preserveAspectRatio="${par}" />`
        );
      } else {
        parts.push(
          `<text x="${w.x + w.w / 2}" y="${w.y + w.h / 2 + 4}" text-anchor="middle" font-size="11" fill="#94A3B8">No image selected</text>`
        );
      }
    }
    parts.push(
      `<rect x="${w.x + 0.5}" y="${w.y + 0.5}" width="${Math.max(0, w.w - 1)}" height="${Math.max(
        0,
        w.h - 1
      )}" rx="4" ry="4" fill="none" stroke="#94A3B8" stroke-opacity="${borderOpacity}" stroke-width="1" />`
    );
    parts.push('</g>');
    return parts.join('');
  }

  // Card background & border
  parts.push(
    `<rect x="${w.x}" y="${w.y}" width="${w.w}" height="${w.h}" rx="4" ry="4" fill="${bgCol}" fill-opacity="${bgOpacity}" stroke="#94A3B8" stroke-opacity="${borderOpacity}" stroke-width="1" />`
  );

  if (w.type === 'custom_text') {
    const renderedText = resolveTemplateText(w.customText || w.title, exposedEntities);
    const fsPx = Math.round(14 * scale);
    parts.push(
      `<text x="${w.x + 12}" y="${w.y + w.h / 2 + fsPx * 0.35}" font-size="${fsPx}" font-weight="600" fill="${textCol}">${escapeXml(
        truncateChars(renderedText, Math.max(8, Math.floor((w.w - 24) / (fsPx * 0.6))))
      )}</text>`
    );
    parts.push('</g>');
    return parts.join('');
  }

  if (w.type === 'custom_html') {
    const resolved = resolveTemplateText(w.htmlCode || w.title, exposedEntities)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ');
    const lines = resolved
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 6);
    const bodyLines = lines.length > 0 ? lines : [w.title];
    bodyLines.forEach((line, idx) => {
      const ly = w.y + 22 + idx * 18;
      if (ly > w.y + w.h - 6) return;
      const isHighlight = idx === 1;
      parts.push(
        `<text x="${w.x + 12}" y="${ly}" font-size="${isHighlight ? 16 : 11}" font-weight="${
          isHighlight ? 700 : 500
        }" fill="${isHighlight ? accent : textCol}">${escapeXml(truncateChars(line, 44))}</text>`
      );
    });
    parts.push('</g>');
    return parts.join('');
  }

  const boundEntity = exposedEntities.find((e) => e.id === w.entityId);
  const boundIds =
    w.entityIds && w.entityIds.length > 0 ? w.entityIds : w.entityId ? [w.entityId] : [];
  const boundEntities = boundIds
    .map((id) => exposedEntities.find((e) => e.id === id))
    .filter((e): e is ExposedEntity => Boolean(e));

  const displayTitle =
    boundEntity && w.type === 'entity_number' ? w.title || boundEntity.tag : w.title;

  // Header row + accent indicator dot
  parts.push(
    `<text x="${w.x + 10}" y="${w.y + 18}" font-size="10.5" font-weight="600" fill="${textCol}" fill-opacity="0.76">${escapeXml(
      truncateChars(displayTitle, Math.max(8, Math.floor((w.w - 30) / 6.2)))
    )}</text>`
  );
  parts.push(`<circle cx="${w.x + w.w - 13}" cy="${w.y + 14}" r="3.2" fill="${accent}" />`);

  const bodyX = w.x + 10;
  const bodyY = w.y + 28;
  const bodyW = Math.max(20, w.w - 20);
  const bodyH = Math.max(16, w.h - 36);

  if (w.type === 'entity_number') {
    const valStr = boundEntity ? String(boundEntity.rawValue) : '—';
    const unitStr = boundEntity?.unit ?? '';
    const tagStr = boundEntity?.tag ?? w.entityId ?? 'Unbound';
    const numSize = Math.round((w.h >= 110 ? 28 : 24) * Math.min(1.5, scale));
    const centerY = bodyY + bodyH * 0.48;
    parts.push(
      `<text x="${bodyX}" y="${centerY.toFixed(1)}" font-size="${numSize}" font-weight="700" fill="${accent}">${escapeXml(
        valStr
      )}${
        unitStr
          ? `<tspan font-size="${Math.round(numSize * 0.56)}" font-weight="500" fill="${accent}" fill-opacity="0.88"> ${escapeXml(
              unitStr
            )}</tspan>`
          : ''
      }</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.65">${escapeXml(
        truncateChars(tagStr, Math.max(10, Math.floor(bodyW / 6)))
      )}</text>`
    );
  } else if (w.type === 'entity_list') {
    const maxRows = Math.min(w.maxItems ?? 6, Math.max(1, Math.floor(bodyH / 17)));
    if (boundEntities.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 14}" font-size="11" fill="${textCol}" fill-opacity="0.6">No bound entities</text>`
      );
    } else {
      boundEntities.slice(0, maxRows).forEach((ent, idx) => {
        const ry = bodyY + 13 + idx * 17;
        const valText = `${ent.rawValue}${ent.unit ? ent.unit : ''}`;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="11" fill="${textCol}" fill-opacity="0.86">${escapeXml(
            truncateChars(ent.tag, Math.max(8, Math.floor((bodyW - 64) / 6.5)))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 10}" y="${ry}" text-anchor="end" font-size="11" font-weight="700" fill="${accent}">${escapeXml(
            valText
          )}</text>`
        );
      });
    }
  } else if (w.type === 'clock') {
    const timeStr = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const dateStr = now.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const clockSize = Math.round((w.w >= 260 && w.h >= 120 ? 34 : 26) * Math.min(1.6, scale));
    parts.push(
      `<text x="${bodyX}" y="${(bodyY + bodyH * 0.5).toFixed(1)}" font-size="${clockSize}" font-weight="700" fill="${textCol}">${escapeXml(
        timeStr
      )}</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.72">${escapeXml(
        dateStr
      )}</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${w.y + w.h - 10}" text-anchor="end" font-size="10" fill="${textCol}" fill-opacity="0.72">UP ${escapeXml(
        formatUptimeShort(telemetry.system.uptimeSeconds)
      )}</text>`
    );
  } else if (w.type === 'cpu_load') {
    const cpuPct = Math.max(0, Math.min(100, telemetry.system.cpuPercent));
    parts.push(
      `<text x="${bodyX}" y="${bodyY + 22}" font-size="24" font-weight="700" fill="${accent}">${cpuPct}%</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${bodyY + 20}" text-anchor="end" font-size="11" fill="${textCol}" fill-opacity="0.82">${telemetry.system.cpuTempC}°C · ${telemetry.system.cpuPowerW}W</text>`
    );
    const barY = bodyY + 32;
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="6" rx="2" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round((cpuPct / 100) * bodyW)}" height="6" rx="2" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.7">LOAD</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${w.y + w.h - 10}" text-anchor="end" font-size="10" fill="${textCol}" fill-opacity="0.7">${escapeXml(
        telemetry.system.loadAvg.join(' / ')
      )}</text>`
    );
  } else if (w.type === 'memory_bar') {
    const total = Math.max(1, telemetry.system.ramTotalBytes);
    const used = telemetry.system.ramUsedBytes;
    const pct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
    parts.push(
      `<text x="${bodyX}" y="${bodyY + 22}" font-size="22" font-weight="700" fill="${textCol}">${pct}%</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${bodyY + 20}" text-anchor="end" font-size="10.5" fill="${textCol}" fill-opacity="0.82">${escapeXml(
        `${formatBytesCompact(used, 1)} / ${formatBytesCompact(total, 0)}`
      )}</text>`
    );
    const barY = bodyY + 32;
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="8" rx="2" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round((pct / 100) * bodyW)}" height="8" rx="2" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.7">ARC / Cache</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${w.y + w.h - 10}" text-anchor="end" font-size="10" fill="${textCol}" fill-opacity="0.7">${escapeXml(
        formatBytesCompact(telemetry.system.ramCachedBytes, 1)
      )}</text>`
    );
  } else if (w.type === 'array_status') {
    const total = Math.max(1, telemetry.array.totalBytes);
    const used = telemetry.array.usedBytes;
    const pct = Math.min(100, Math.max(0, Math.round((used / total) * 100)));
    const stateColor = telemetry.array.parityValid ? '#10B981' : '#EF4444';
    parts.push(
      `<text x="${bodyX}" y="${bodyY + 18}" font-size="14" font-weight="700" fill="${stateColor}">${escapeXml(
        telemetry.array.state
      )}</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${bodyY + 18}" text-anchor="end" font-size="12" fill="${textCol}" fill-opacity="0.86">${escapeXml(
        `${formatBytesCompact(used, 1)} / ${formatBytesCompact(total, 1)}`
      )}</text>`
    );
    const barY = bodyY + Math.max(28, bodyH * 0.44);
    parts.push(`<rect x="${bodyX}" y="${barY}" width="${bodyW}" height="8" rx="2" fill="#1E293B" />`);
    parts.push(
      `<rect x="${bodyX}" y="${barY}" width="${Math.round((pct / 100) * bodyW)}" height="8" rx="2" fill="${accent}" />`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.72">Parity: ${
        telemetry.array.parityValid ? 'Valid' : 'Degraded'
      }</text>`
    );
    parts.push(
      `<text x="${w.x + w.w - 10}" y="${w.y + w.h - 10}" text-anchor="end" font-size="10" fill="${textCol}" fill-opacity="0.72">Free: ${escapeXml(
        formatBytesCompact(telemetry.array.freeBytes, 1)
      )}</text>`
    );
  } else if (w.type === 'docker_list') {
    const running = telemetry.containers.filter((c) => c.state === 'running');
    const maxRows = Math.min(w.maxItems ?? 5, Math.max(1, Math.floor(bodyH / 20)));
    if (running.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 16}" font-size="11" fill="${textCol}" fill-opacity="0.6">No running containers</text>`
      );
    } else {
      running.slice(0, maxRows).forEach((c, idx) => {
        const ry = bodyY + 14 + idx * 20;
        const iconData = resolveLocalImageDataUri(dockerIcons[c.name]);
        if (iconData) {
          parts.push(
            `<image href="${iconData}" x="${bodyX}" y="${ry - 11}" width="14" height="14" preserveAspectRatio="xMidYMid slice" />`
          );
        } else {
          parts.push(
            `<rect x="${bodyX}" y="${ry - 11}" width="14" height="14" rx="2" fill="#94A3B8" fill-opacity="0.2" />`
          );
          parts.push(
            `<text x="${bodyX + 7}" y="${ry - 1}" text-anchor="middle" font-size="7.5" font-weight="700" fill="${accent}">${escapeXml(
              c.name.slice(0, 2).toUpperCase()
            )}</text>`
          );
        }
        parts.push(
          `<text x="${bodyX + 20}" y="${ry}" font-size="11" fill="${textCol}" fill-opacity="0.94">${escapeXml(
            truncateChars(c.name, Math.max(8, Math.floor((bodyW - 110) / 6.5)))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 10}" y="${ry}" text-anchor="end" font-size="10.5" fill="${textCol}" fill-opacity="0.72">${c.cpuPercent.toFixed(
            1
          )}% · ${c.memUsedMB}M</text>`
        );
      });
    }
  } else if (w.type === 'active_tasks') {
    const tasks = telemetry.tasks.slice(0, w.maxItems ?? 3);
    if (tasks.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 16}" font-size="11" fill="${textCol}" fill-opacity="0.6">No active tasks</text>`
      );
    } else {
      tasks.forEach((tk, idx) => {
        const ry = bodyY + 12 + idx * 24;
        const pct = tk.status === 'running' ? tk.progressPercent : tk.status === 'idle' ? 100 : 0;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="10.5" fill="${textCol}" fill-opacity="0.9">${escapeXml(
            truncateChars(tk.name, Math.max(10, Math.floor((bodyW - 55) / 6)))
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 10}" y="${ry}" text-anchor="end" font-size="10.5" fill="${
            tk.status === 'running' ? accent : '#94A3B8'
          }">${escapeXml(tk.status === 'running' ? `${tk.progressPercent}%` : tk.status)}</text>`
        );
        parts.push(`<rect x="${bodyX}" y="${ry + 4}" width="${bodyW}" height="4" rx="2" fill="#1E293B" />`);
        parts.push(
          `<rect x="${bodyX}" y="${ry + 4}" width="${Math.round((Math.min(100, Math.max(0, pct)) / 100) * bodyW)}" height="4" rx="2" fill="${
            tk.status === 'running' ? accent : '#334155'
          }" />`
        );
      });
    }
  } else if (w.type === 'active_users') {
    const sessions = telemetry.sessions.slice(0, w.maxItems ?? 3);
    if (sessions.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 16}" font-size="11" fill="${textCol}" fill-opacity="0.6">No active SMB/SSH sessions</text>`
      );
    } else {
      sessions.forEach((s, idx) => {
        const ry = bodyY + 13 + idx * 18;
        parts.push(
          `<text x="${bodyX}" y="${ry}" font-size="10.5" fill="${textCol}" fill-opacity="0.9">${escapeXml(
            truncateChars(`${s.username}@${s.clientIp}`, 22)
          )}</text>`
        );
        parts.push(
          `<text x="${w.x + w.w - 10}" y="${ry}" text-anchor="end" font-size="10" fill="${textCol}" fill-opacity="0.72">${escapeXml(
            `${s.protocol} · ${s.throughputMBps.toFixed(1)} MB/s`
          )}</text>`
        );
      });
    }
  } else if (w.type === 'disk_thermals') {
    const disks = telemetry.disks.slice(0, w.maxItems ?? 6);
    const colW = (bodyW - 12) / 2;
    disks.forEach((d, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const dx = bodyX + col * (colW + 12);
      const dy = bodyY + 13 + row * 18;
      if (dy > w.y + w.h - 6) return;
      const tempCol = d.tempC >= 48 ? '#EF4444' : d.spinState === 'standby' ? '#64748B' : '#10B981';
      parts.push(
        `<text x="${dx}" y="${dy}" font-size="10" fill="${textCol}" fill-opacity="0.86">${escapeXml(
          truncateChars(d.name, 11)
        )}</text>`
      );
      parts.push(
        `<text x="${dx + colW}" y="${dy}" text-anchor="end" font-size="10" font-weight="600" fill="${tempCol}">${
          d.spinState === 'standby' ? 'STBY' : `${d.tempC}°C`
        }</text>`
      );
    });
  } else if (w.type === 'ha_entity') {
    const ha = haEntities.find((e) => e.entity_id === w.haEntityId);
    const unit = ha?.attributes.unit_of_measurement ?? '';
    const friendly =
      ha?.attributes.friendly_name ??
      (w.haEntityId || (haEntities.length === 0 ? 'Connect Home Assistant' : 'Select HA Entity'));
    const valStr = ha ? `${ha.state}${unit ? ` ${unit}` : ''}` : 'HA Offline';
    parts.push(
      `<text x="${bodyX}" y="${(bodyY + bodyH * 0.48).toFixed(1)}" font-size="22" font-weight="700" fill="${accent}">${escapeXml(
        truncateChars(valStr, 18)
      )}</text>`
    );
    parts.push(
      `<text x="${bodyX}" y="${w.y + w.h - 10}" font-size="10" fill="${textCol}" fill-opacity="0.7">${escapeXml(
        truncateChars(friendly, Math.max(10, Math.floor(bodyW / 6)))
      )}</text>`
    );
  } else if (w.type === 'apex_area') {
    const palette = [
      accent,
      ...MULTI_SERIES_PALETTE.filter((c) => c.toLowerCase() !== accent.toLowerCase()),
    ];
    let seriesList: Array<{name: string; color: string; data: number[]}> = [];
    let unit = '';
    let yMin: number | undefined;
    let yMax: number | undefined;

    const numericEntities = boundEntities.filter((e) => e.history.length > 0 || e.numericValue !== null);
    if (numericEntities.length > 0) {
      const allPct = numericEntities.every((e) => e.unit === '%');
      unit = numericEntities.length === 1 ? numericEntities[0].unit : '';
      if (allPct) {
        yMin = 0;
        yMax = 100;
      }
      seriesList = numericEntities.map((ent, idx) => ({
        name: ent.tag,
        color: palette[idx % palette.length],
        data: ent.history.length > 0 ? ent.history : [ent.numericValue ?? 0, ent.numericValue ?? 0],
      }));
    } else {
      const binding = w.binding ?? 'cpu_percent';
      if (binding === 'net_rx_tx') {
        seriesList = [
          {name: 'RX Mbps', color: accent, data: telemetry.history.netRxSeries},
          {name: 'TX Mbps', color: '#38BDF8', data: telemetry.history.netTxSeries},
        ];
        yMin = 0;
      } else if (binding === 'ram_percent') {
        seriesList = [{name: 'Memory %', color: accent, data: telemetry.history.ramSeries}];
        unit = '%';
        yMin = 0;
        yMax = 100;
      } else {
        seriesList = [{name: 'CPU %', color: accent, data: telemetry.history.cpuSeries}];
        unit = '%';
        yMin = 0;
        yMax = 100;
      }
    }

    parts.push(
      renderLineAreaSeriesSvg({
        x: bodyX,
        y: bodyY,
        w: bodyW,
        h: bodyH,
        seriesList,
        isArea: w.chartVariant !== 'line',
        isSmooth: w.chartSmooth !== false,
        unit,
        textColor: textCol,
        uid,
        yMinOverride: yMin,
        yMaxOverride: yMax,
      })
    );
  } else if (w.type === 'apex_radial') {
    let value: number | null = null;
    let unit = '%';
    let label = 'Value';
    if (boundEntity && boundEntity.numericValue !== null) {
      value = boundEntity.numericValue;
      unit = boundEntity.unit || '%';
      label = boundEntity.tag.slice(0, 14);
    } else if (w.binding === 'cpu_percent') {
      value = telemetry.system.cpuPercent;
      label = 'CPU';
    } else if (w.binding === 'ram_percent') {
      value = Math.round((telemetry.system.ramUsedBytes / Math.max(1, telemetry.system.ramTotalBytes)) * 100);
      label = 'RAM';
    } else if (w.binding === 'ups_load') {
      value = telemetry.ups.loadPercent;
      label = `${telemetry.ups.currentPowerW}W`;
    } else if (w.binding === 'array_percent') {
      value = Math.round((telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes)) * 100);
      label = 'ARRAY';
    } else if (!w.entityId) {
      value = Math.round((telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes)) * 100);
      label = 'ARRAY';
    }

    const cx = bodyX + bodyW / 2;
    const cy = bodyY + bodyH / 2 + 2;
    const r = Math.max(18, Math.min(bodyW, bodyH) * 0.42);
    const strokeW = Math.max(6, Math.round(r * 0.22));
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#94A3B8" stroke-opacity="0.18" stroke-width="${strokeW}" />`
    );
    if (value !== null) {
      const clamped = Math.min(100, Math.max(0, value));
      if (clamped > 0.5) {
        parts.push(
          `<path d="${describeArc(cx, cy, r, 0, (clamped / 100) * 360)}" fill="none" stroke="${accent}" stroke-width="${strokeW}" stroke-linecap="round" />`
        );
      }
    }
    const centerVal = value === null ? '—' : `${Math.round(value)}${unit}`;
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + 3).toFixed(1)}" text-anchor="middle" font-size="18" font-weight="700" fill="${textCol}">${escapeXml(
        centerVal
      )}</text>`
    );
    parts.push(
      `<text x="${cx.toFixed(1)}" y="${(cy + 18).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="#94A3B8">${escapeXml(
        label
      )}</text>`
    );
  } else if (w.type === 'apex_bar' || w.type === 'apex_hbar') {
    const items =
      boundEntities.length > 0
        ? boundEntities.slice(0, 6).map((e) => ({
            label: truncateChars(e.tag, 10),
            val: e.numericValue ?? 0,
            unit: e.unit || '',
          }))
        : telemetry.disks.slice(0, 6).map((d) => ({
            label: truncateChars(d.name, 10),
            val: d.tempC,
            unit: '°',
          }));

    if (items.length === 0) {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 16}" font-size="11" fill="#94A3B8">No bar data available</text>`
      );
    } else {
      const maxVal = Math.max(10, ...items.map((i) => i.val));
      if (w.type === 'apex_hbar') {
        const rowH = Math.min(26, Math.max(16, Math.floor(bodyH / items.length)));
        items.forEach((it, idx) => {
          const ry = bodyY + 4 + idx * rowH;
          const labelW = Math.min(82, Math.round(bodyW * 0.34));
          const trackX = bodyX + labelW;
          const trackW = Math.max(20, bodyW - labelW - 42);
          const barW = Math.max(2, Math.round((Math.max(0, it.val) / maxVal) * trackW));
          parts.push(
            `<text x="${bodyX}" y="${ry + 11}" font-size="9.5" fill="${textCol}" fill-opacity="0.86">${escapeXml(
              it.label
            )}</text>`
          );
          parts.push(
            `<rect x="${trackX}" y="${ry + 3}" width="${trackW}" height="10" rx="2" fill="#1E293B" />`
          );
          parts.push(
            `<rect x="${trackX}" y="${ry + 3}" width="${barW}" height="10" rx="2" fill="${accent}" />`
          );
          parts.push(
            `<text x="${w.x + w.w - 10}" y="${ry + 11}" text-anchor="end" font-size="9.5" font-weight="600" fill="${textCol}">${escapeXml(
              `${Math.round(it.val)}${it.unit}`
            )}</text>`
          );
        });
      } else {
        const colStep = bodyW / items.length;
        const barW = Math.max(10, Math.min(44, colStep * 0.56));
        const chartBaseY = bodyY + bodyH - 16;
        const maxBarH = Math.max(16, bodyH - 34);
        items.forEach((it, idx) => {
          const cx = bodyX + idx * colStep + colStep / 2;
          const bh = Math.max(2, Math.round((Math.max(0, it.val) / maxVal) * maxBarH));
          const bx = cx - barW / 2;
          const by = chartBaseY - bh;
          parts.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh}" rx="2" fill="${accent}" />`);
          parts.push(
            `<text x="${cx.toFixed(1)}" y="${(by - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="600" fill="${textCol}">${escapeXml(
              `${Math.round(it.val)}${it.unit}`
            )}</text>`
          );
          parts.push(
            `<text x="${cx.toFixed(1)}" y="${bodyY + bodyH - 3}" text-anchor="middle" font-size="8.5" fill="#94A3B8">${escapeXml(
              truncateChars(it.label, 8)
            )}</text>`
          );
        });
      }
    }
  } else if (w.type === 'apex_custom') {
    try {
      let hydrated = (w.apexCode || '{}').replace(/"\{\{history:([^}]+)\}\}"/g, (_m, id: string) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.history ?? []);
      });
      hydrated = hydrated.replace(/"\{\{([^}]+)\}\}"/g, (_m, id: string) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return JSON.stringify(ent?.numericValue ?? ent?.rawValue ?? 0);
      });
      const parsed = JSON.parse(hydrated) as {
        chart?: {type?: string};
        colors?: string[];
        stroke?: {curve?: string};
        series?: Array<{name?: string; data?: number[]} | number>;
      };
      const chartType = parsed.chart?.type || 'area';
      const cols = Array.isArray(parsed.colors) && parsed.colors.length > 0 ? parsed.colors : [accent];
      if (chartType === 'radialBar' || chartType === 'donut') {
        const firstVal = typeof parsed.series?.[0] === 'number' ? parsed.series[0] : 0;
        const cx = bodyX + bodyW / 2;
        const cy = bodyY + bodyH / 2 + 2;
        const r = Math.max(18, Math.min(bodyW, bodyH) * 0.42);
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#94A3B8" stroke-opacity="0.18" stroke-width="8" />`
        );
        if (firstVal > 0) {
          parts.push(
            `<path d="${describeArc(cx, cy, r, 0, (Math.min(100, firstVal) / 100) * 360)}" fill="none" stroke="${safeColor(
              cols[0],
              accent
            )}" stroke-width="8" stroke-linecap="round" />`
          );
        }
        parts.push(
          `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="17" font-weight="700" fill="${textCol}">${Math.round(
            firstVal
          )}%</text>`
        );
      } else {
        const seriesList = Array.isArray(parsed.series)
          ? parsed.series
              .filter((s): s is {name?: string; data?: number[]} => typeof s === 'object' && s !== null)
              .map((s, idx) => ({
                name: s.name || `Series ${idx + 1}`,
                color: safeColor(cols[idx % cols.length], accent),
                data: Array.isArray(s.data) ? s.data.map(Number).filter((n) => Number.isFinite(n)) : [],
              }))
          : [];
        parts.push(
          renderLineAreaSeriesSvg({
            x: bodyX,
            y: bodyY,
            w: bodyW,
            h: bodyH,
            seriesList,
            isArea: chartType !== 'line',
            isSmooth: parsed.stroke?.curve !== 'straight',
            unit: '',
            textColor: textCol,
            uid,
          })
        );
      }
    } catch {
      parts.push(
        `<text x="${bodyX}" y="${bodyY + 18}" font-size="11" fill="#F87171">Invalid ApexCharts JSON</text>`
      );
    }
  }

  parts.push('</g>');
  return parts.join('');
}

function buildPortraitReflowWidgets(widgets: ScreenWidget[]): ScreenWidget[] {
  const portW = LCD_H; // 376
  const portH = LCD_W; // 960
  const pad = 10;
  const colW = portW - pad * 2; // 356

  const sorted = [...widgets]
    .filter((w) => w.type !== 'divider')
    .sort((a, b) => Math.round(a.y / 36) - Math.round(b.y / 36) || a.x - b.x);

  if (sorted.length === 0) return [];
  const gap = 8;
  const availableH = portH - pad * 2 - gap * Math.max(0, sorted.length - 1);
  const rawTotalH = sorted.reduce((acc, w) => acc + Math.max(48, w.h), 0);
  const scaleH = rawTotalH > availableH ? availableH / rawTotalH : 1;

  let curY = pad;
  return sorted.map((w) => {
    const h = Math.max(46, Math.round(Math.max(48, w.h) * scaleH));
    const cloned: ScreenWidget = {
      ...w,
      x: pad,
      y: curY,
      w: colW,
      h,
    };
    curY += h + gap;
    return cloned;
  });
}

function buildScreenSvgDocument(params: {
  screen: LcdScreen;
  telemetry: TelemetrySnapshot;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  dockerIcons: Record<string, string>;
  rotation: 0 | 90 | 180 | 270;
  now?: Date;
}): {svg: string; canvasW: number; canvasH: number} {
  const {screen, telemetry, haEntities, exposedEntities, dockerIcons, rotation} = params;
  const now = params.now ?? new Date();
  const isPortrait = rotation === 90 || rotation === 270;
  const canvasW = isPortrait ? LCD_H : LCD_W;
  const canvasH = isPortrait ? LCD_W : LCD_H;
  const bgCol = safeColor(screen.backgroundColor, '#0B0E14');

  const bodyParts: string[] = [
    `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="${bgCol}" />`,
  ];

  if (screen.backgroundType === 'image' && screen.backgroundImage) {
    const bgData = resolveLocalImageDataUri(screen.backgroundImage);
    if (bgData) {
      bodyParts.push(
        `<image href="${bgData}" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice" />`
      );
    }
    const dim = Math.max(0, Math.min(1, screen.backgroundDim ?? 0));
    if (dim > 0) {
      bodyParts.push(
        `<rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="#000000" fill-opacity="${dim}" />`
      );
    }
  }

  const widgetsToRender = isPortrait ? buildPortraitReflowWidgets(screen.widgets) : screen.widgets;
  widgetsToRender.forEach((w, idx) => {
    bodyParts.push(
      renderWidgetSvg({
        w,
        telemetry,
        haEntities,
        exposedEntities,
        dockerIcons,
        index: idx,
        now,
      })
    );
  });

  const innerContent =
    rotation === 180
      ? `<g transform="rotate(180 ${canvasW / 2} ${canvasH / 2})">${bodyParts.join('')}</g>`
      : bodyParts.join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}">${innerContent}</svg>`;
  return {svg, canvasW, canvasH};
}

function rotatePortraitRgbaToPhysicalLcd(
  portraitBuf: Uint8Array,
  rotation: 90 | 270
): Buffer {
  // portraitBuf has dimensions LCD_H (376) x LCD_W (960)
  const out = Buffer.allocUnsafe(LCD_W * LCD_H * 4);
  for (let sy = 0; sy < LCD_W; sy++) {
    for (let sx = 0; sx < LCD_H; sx++) {
      const srcIdx = (sy * LCD_H + sx) * 4;
      const dstX = rotation === 90 ? LCD_W - 1 - sy : sy;
      const dstY = rotation === 90 ? sx : LCD_H - 1 - sx;
      const dstIdx = (dstY * LCD_W + dstX) * 4;
      out[dstIdx] = portraitBuf[srcIdx];
      out[dstIdx + 1] = portraitBuf[srcIdx + 1];
      out[dstIdx + 2] = portraitBuf[srcIdx + 2];
      out[dstIdx + 3] = portraitBuf[srcIdx + 3];
    }
  }
  return out;
}

export function renderScreenToRgbaBuffer(params: {
  screen: LcdScreen;
  telemetry: TelemetrySnapshot;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  dockerIcons?: Record<string, string>;
  rotation?: 0 | 90 | 180 | 270;
  brightnessPercent?: number;
  blank?: boolean;
  now?: Date;
}): Buffer {
  if (params.blank) {
    const black = Buffer.alloc(LCD_W * LCD_H * 4);
    for (let i = 3; i < black.length; i += 4) black[i] = 255;
    return black;
  }

  const rotation = params.rotation ?? 0;
  const {svg} = buildScreenSvgDocument({
    screen: params.screen,
    telemetry: params.telemetry,
    haEntities: params.haEntities,
    exposedEntities: params.exposedEntities,
    dockerIcons: params.dockerIcons ?? {},
    rotation,
    now: params.now,
  });

  const fontFiles = discoverFontFiles();
  const resvg = new Resvg(svg, {
    fitTo: {mode: 'original'},
    font: {
      fontFiles,
      loadSystemFonts: fontFiles.length === 0,
      defaultFontFamily: 'DejaVu Sans',
      sansSerifFamily: 'DejaVu Sans',
      monospaceFamily: 'JetBrains Mono',
    },
  });
  const rendered = resvg.render();
  const rawPixels = rendered.pixels;

  let physicalRgba: Buffer;
  if (rotation === 90 || rotation === 270) {
    physicalRgba = rotatePortraitRgbaToPhysicalLcd(rawPixels, rotation);
  } else {
    physicalRgba = Buffer.from(rawPixels.buffer, rawPixels.byteOffset, rawPixels.byteLength);
  }

  if (params.brightnessPercent !== undefined && params.brightnessPercent < 100) {
    return applyBrightnessScaleRgba(physicalRgba, params.brightnessPercent, LCD_W, LCD_H);
  }

  return physicalRgba;
}

export function renderScreenToPngBuffer(params: {
  screen: LcdScreen;
  telemetry: TelemetrySnapshot;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  dockerIcons?: Record<string, string>;
  rotation?: 0 | 90 | 180 | 270;
  brightnessPercent?: number;
  blank?: boolean;
  now?: Date;
}): Buffer {
  const rgba = renderScreenToRgbaBuffer(params);
  return encodePngRgba(rgba, LCD_W, LCD_H);
}
