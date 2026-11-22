import type {ExposedEntity, HomeAssistantEntity, LcdScreen, ScreenWidget, TelemetrySnapshot} from '../types.ts';

const LCD_W = 960;
const LCD_H = 376;

const FONT_5X7: Record<string, string[]> = {
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
  '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
  '#': ['01010', '11111', '01010', '01010', '11111', '01010', '00000'],
  '%': ['11001', '11010', '00100', '01000', '10011', '00000', '00000'],
  '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
  '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
  '*': ['00100', '10101', '01110', '11111', '01110', '10101', '00100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '/': ['00001', '00010', '00100', '00100', '01000', '10000', '00000'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ';': ['00000', '01100', '01100', '00000', '01100', '00100', '01000'],
  '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '@': ['01110', '10001', '10111', '10101', '10111', '10000', '01110'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'J': ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  'a': ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
  'b': ['10000', '10000', '11110', '10001', '10001', '10001', '11110'],
  'c': ['00000', '00000', '01110', '10000', '10000', '10001', '01110'],
  'd': ['00001', '00001', '01111', '10001', '10001', '10001', '01111'],
  'e': ['00000', '00000', '01110', '10001', '11111', '10000', '01110'],
  'f': ['00110', '01001', '01000', '11100', '01000', '01000', '01000'],
  'g': ['00000', '01111', '10001', '10001', '01111', '00001', '01110'],
  'h': ['10000', '10000', '11110', '10001', '10001', '10001', '10001'],
  'i': ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
  'j': ['00010', '00000', '00110', '00010', '00010', '10010', '01100'],
  'k': ['10000', '10000', '10010', '10100', '11000', '10100', '10010'],
  'l': ['01100', '00100', '00100', '00100', '00100', '00100', '01110'],
  'm': ['00000', '00000', '11010', '10101', '10101', '10101', '10001'],
  'n': ['00000', '00000', '11110', '10001', '10001', '10001', '10001'],
  'o': ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
  'p': ['00000', '00000', '11110', '10001', '11110', '10000', '10000'],
  'q': ['00000', '00000', '01111', '10001', '01111', '00001', '00001'],
  'r': ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
  's': ['00000', '00000', '01111', '10000', '01110', '00001', '11110'],
  't': ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
  'u': ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
  'v': ['00000', '00000', '10001', '10001', '10001', '01010', '00100'],
  'w': ['00000', '00000', '10001', '10001', '10101', '11011', '10001'],
  'x': ['00000', '00000', '10001', '01010', '00100', '01010', '10001'],
  'y': ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
  'z': ['00000', '00000', '11111', '00010', '00100', '01000', '11111'],
  '°': ['01100', '10010', '10010', '01100', '00000', '00000', '00000'],
  '·': ['00000', '00000', '00000', '00100', '00000', '00000', '00000'],
};

function parseHexRgb(hex: string): [number, number, number] {
  const clean = (hex || '#0F1520').replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 15,
      parseInt(clean[1] + clean[1], 16) || 21,
      parseInt(clean[2] + clean[2], 16) || 32,
    ];
  }
  const num = parseInt(clean.slice(0, 6), 16);
  if (Number.isNaN(num)) return [15, 21, 32];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function blendPixel(buf: Buffer, x: number, y: number, r: number, g: number, b: number, alpha: number) {
  if (x < 0 || y < 0 || x >= LCD_W || y >= LCD_H || alpha <= 0) return;
  const idx = (y * LCD_W + x) * 4;
  if (alpha >= 0.995) {
    buf[idx] = r;
    buf[idx + 1] = g;
    buf[idx + 2] = b;
    buf[idx + 3] = 255;
    return;
  }
  const inv = 1 - alpha;
  buf[idx] = Math.round(r * alpha + buf[idx] * inv);
  buf[idx + 1] = Math.round(g * alpha + buf[idx + 1] * inv);
  buf[idx + 2] = Math.round(b * alpha + buf[idx + 2] * inv);
  buf[idx + 3] = 255;
}

function fillRect(
  buf: Buffer,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  alpha = 1
) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(LCD_W, Math.round(x + w));
  const y1 = Math.min(LCD_H, Math.round(y + h));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      blendPixel(buf, px, py, r, g, b, alpha);
    }
  }
}

function strokeRect(
  buf: Buffer,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
  alpha: number
) {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const x1 = Math.round(x + w - 1);
  const y1 = Math.round(y + h - 1);
  for (let px = x0; px <= x1; px++) {
    blendPixel(buf, px, y0, r, g, b, alpha);
    blendPixel(buf, px, y1, r, g, b, alpha);
  }
  for (let py = y0 + 1; py < y1; py++) {
    blendPixel(buf, x0, py, r, g, b, alpha);
    blendPixel(buf, x1, py, r, g, b, alpha);
  }
}

function drawLine(
  buf: Buffer,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
  alpha = 1
) {
  let ix0 = Math.round(x0);
  let iy0 = Math.round(y0);
  const ix1 = Math.round(x1);
  const iy1 = Math.round(y1);
  const dx = Math.abs(ix1 - ix0);
  const dy = Math.abs(iy1 - iy0);
  const sx = ix0 < ix1 ? 1 : -1;
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    blendPixel(buf, ix0, iy0, r, g, b, alpha);
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      ix0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      iy0 += sy;
    }
  }
}

function drawText(
  buf: Buffer,
  text: string,
  x: number,
  y: number,
  scale: number,
  r: number,
  g: number,
  b: number,
  alpha = 1,
  maxWidth = 960
) {
  let cursorX = Math.round(x);
  const startY = Math.round(y);
  const stepX = 6 * scale;
  const maxX = Math.round(x + maxWidth);

  for (const ch of text) {
    if (cursorX + 5 * scale > maxX) break;
    const glyph = FONT_5X7[ch] ?? FONT_5X7[' '];
    for (let row = 0; row < 7; row++) {
      const bits = glyph[row];
      for (let col = 0; col < 5; col++) {
        if (bits[col] === '1') {
          fillRect(buf, cursorX + col * scale, startY + row * scale, scale, scale, r, g, b, alpha);
        }
      }
    }
    cursorX += stepX;
  }
}

function formatGiB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}G`;
}

function formatTiB(bytes: number): string {
  return `${(bytes / 1024 ** 4).toFixed(1)}T`;
}

function formatUptimeShort(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${m}m`;
}

function resolveTemplate(str: string, exposedEntities: ExposedEntity[]): string {
  return str.replace(/\{\{([^}]+)\}\}/g, (_m, rawKey: string) => {
    const clean = rawKey.trim().replace(/^tag:/, '');
    const ent = exposedEntities.find((e) => e.id === clean);
    return ent ? `${ent.rawValue}${ent.unit}` : clean;
  });
}

function renderWidgetPixels(
  buf: Buffer,
  w: ScreenWidget,
  telemetry: TelemetrySnapshot,
  haEntities: HomeAssistantEntity[],
  exposedEntities: ExposedEntity[]
) {
  const [ar, ag, ab] = parseHexRgb(w.accentColor);
  const [tr, tg, tb] = parseHexRgb(w.textColor);
  const [bgr, bgg, bgb] = parseHexRgb(w.bgColor);

  if (w.type === 'divider') {
    fillRect(buf, w.x, w.y + Math.floor(w.h / 2), w.w, 1, ar, ag, ab, 0.7);
    return;
  }

  fillRect(buf, w.x, w.y, w.w, w.h, bgr, bgg, bgb, w.bgOpacity);
  strokeRect(buf, w.x, w.y, w.w, w.h, 148, 163, 184, w.borderOpacity);

  // Header + accent dot
  drawText(buf, w.title.slice(0, 28), w.x + 10, w.y + 8, 1, tr, tg, tb, 0.72, w.w - 28);
  fillRect(buf, w.x + w.w - 14, w.y + 9, 5, 5, ar, ag, ab, 1);

  const bodyX = w.x + 10;
  const bodyY = w.y + 24;
  const bodyW = Math.max(20, w.w - 20);
  const bodyH = Math.max(16, w.h - 30);

  if (w.type === 'entity_number') {
    const ent = exposedEntities.find((e) => e.id === w.entityId);
    const val = ent ? `${ent.rawValue}${ent.unit}` : '--';
    drawText(buf, val, bodyX, bodyY + 6, w.h >= 100 ? 3 : 2, ar, ag, ab, 1, bodyW);
    drawText(buf, ent?.tag ?? w.entityId ?? '', bodyX, w.y + w.h - 16, 1, tr, tg, tb, 0.68, bodyW);
    return;
  }

  if (w.type === 'entity_list') {
    const ids = w.entityIds ?? [];
    ids.slice(0, Math.max(1, Math.floor(bodyH / 16))).forEach((id, idx) => {
      const ent = exposedEntities.find((e) => e.id === id);
      const rowY = bodyY + idx * 16;
      const label = (ent?.tag ?? id).slice(0, 18);
      const val = ent ? `${ent.rawValue}${ent.unit}` : '--';
      drawText(buf, label, bodyX, rowY, 1, tr, tg, tb, 0.85, bodyW - 60);
      drawText(buf, val, w.x + w.w - 10 - val.length * 6, rowY, 1, ar, ag, ab, 1, 80);
    });
    return;
  }

  if (w.type === 'clock') {
    const now = new Date();
    const timeStr = now.toTimeString().slice(0, 8);
    const dateStr = now.toDateString().slice(0, 10);
    drawText(buf, timeStr, bodyX, bodyY + 6, w.w >= 210 ? 3 : 2, tr, tg, tb, 1, bodyW);
    drawText(
      buf,
      `${dateStr} UP ${formatUptimeShort(telemetry.system.uptimeSeconds)}`,
      bodyX,
      w.y + w.h - 16,
      1,
      tr,
      tg,
      tb,
      0.7,
      bodyW
    );
    return;
  }

  if (w.type === 'cpu_load') {
    drawText(buf, `${telemetry.system.cpuPercent}%`, bodyX, bodyY + 2, 3, ar, ag, ab, 1, bodyW);
    drawText(
      buf,
      `${telemetry.system.cpuTempC}°C ${telemetry.system.cpuPowerW}W`,
      bodyX + 86,
      bodyY + 10,
      1,
      tr,
      tg,
      tb,
      0.8,
      bodyW - 86
    );
    fillRect(buf, bodyX, bodyY + 34, bodyW, 6, 51, 65, 85, 0.7);
    fillRect(
      buf,
      bodyX,
      bodyY + 34,
      Math.round((Math.min(100, telemetry.system.cpuPercent) / 100) * bodyW),
      6,
      ar,
      ag,
      ab,
      1
    );
    return;
  }

  if (w.type === 'memory_bar') {
    const pct = Math.round((telemetry.system.ramUsedBytes / Math.max(1, telemetry.system.ramTotalBytes)) * 100);
    drawText(
      buf,
      `${pct}% ${formatGiB(telemetry.system.ramUsedBytes)}/${formatGiB(telemetry.system.ramTotalBytes)}`,
      bodyX,
      bodyY + 4,
      2,
      tr,
      tg,
      tb,
      1,
      bodyW
    );
    fillRect(buf, bodyX, bodyY + 30, bodyW, 8, 51, 65, 85, 0.7);
    fillRect(buf, bodyX, bodyY + 30, Math.round((pct / 100) * bodyW), 8, ar, ag, ab, 1);
    return;
  }

  if (w.type === 'array_status') {
    const pct = Math.round((telemetry.array.usedBytes / Math.max(1, telemetry.array.totalBytes)) * 100);
    drawText(
      buf,
      `${telemetry.array.state} ${formatTiB(telemetry.array.usedBytes)}/${formatTiB(telemetry.array.totalBytes)}`,
      bodyX,
      bodyY + 4,
      2,
      tr,
      tg,
      tb,
      1,
      bodyW
    );
    fillRect(buf, bodyX, bodyY + 30, bodyW, 8, 51, 65, 85, 0.7);
    fillRect(buf, bodyX, bodyY + 30, Math.round((pct / 100) * bodyW), 8, ar, ag, ab, 1);
    drawText(
      buf,
      `Parity: ${telemetry.array.parityValid ? 'Valid' : 'Degraded'}`,
      bodyX,
      w.y + w.h - 16,
      1,
      tr,
      tg,
      tb,
      0.72,
      bodyW
    );
    return;
  }

  if (w.type === 'docker_list') {
    const running = telemetry.containers.filter((c) => c.state === 'running');
    running.slice(0, Math.max(1, Math.floor(bodyH / 16))).forEach((c, idx) => {
      const rowY = bodyY + idx * 16;
      const stats = `${c.cpuPercent.toFixed(1)}% ${c.memUsedMB}M`;
      drawText(buf, c.name.slice(0, 20), bodyX, rowY, 1, tr, tg, tb, 0.9, bodyW - 80);
      drawText(buf, stats, w.x + w.w - 10 - stats.length * 6, rowY, 1, ar, ag, ab, 0.95, 80);
    });
    return;
  }

  if (w.type === 'active_tasks') {
    telemetry.tasks.slice(0, 3).forEach((t, idx) => {
      const rowY = bodyY + idx * 22;
      drawText(buf, `${t.name.slice(0, 18)} ${t.status === 'running' ? `${t.progressPercent}%` : t.status}`, bodyX, rowY, 1, tr, tg, tb, 0.9, bodyW);
      fillRect(buf, bodyX, rowY + 10, bodyW, 4, 51, 65, 85, 0.6);
      fillRect(buf, bodyX, rowY + 10, Math.round((t.progressPercent / 100) * bodyW), 4, ar, ag, ab, 1);
    });
    return;
  }

  if (w.type === 'active_users') {
    telemetry.sessions.slice(0, 3).forEach((s, idx) => {
      const rowY = bodyY + idx * 16;
      drawText(buf, `${s.username}@${s.clientIp}`, bodyX, rowY, 1, tr, tg, tb, 0.9, bodyW - 60);
      drawText(buf, `${s.protocol}`, w.x + w.w - 50, rowY, 1, ar, ag, ab, 0.9, 45);
    });
    return;
  }

  if (w.type === 'apex_area') {
    const ent = exposedEntities.find((e) => e.id === (w.entityIds?.[0] ?? w.entityId));
    const series = ent?.history.length ? ent.history : telemetry.history.cpuSeries;
    const min = Math.min(...series, 0);
    const max = Math.max(...series, 100);
    const span = Math.max(1, max - min);
    for (let i = 1; i < series.length; i++) {
      const px0 = bodyX + Math.round(((i - 1) / Math.max(1, series.length - 1)) * bodyW);
      const py0 = bodyY + bodyH - Math.round(((series[i - 1] - min) / span) * (bodyH - 12));
      const px1 = bodyX + Math.round((i / Math.max(1, series.length - 1)) * bodyW);
      const py1 = bodyY + bodyH - Math.round(((series[i] - min) / span) * (bodyH - 12));
      drawLine(buf, px0, py0, px1, py1, ar, ag, ab, 1);
      if (w.chartVariant !== 'line') {
        fillRect(buf, px1, py1, 2, bodyY + bodyH - py1, ar, ag, ab, 0.18);
      }
    }
    return;
  }

  if (w.type === 'apex_radial') {
    const ent = exposedEntities.find((e) => e.id === w.entityId);
    const pct = Math.min(100, Math.max(0, ent?.numericValue ?? 50));
    const valStr = `${Math.round(pct)}${ent?.unit || '%'}`;
    drawText(buf, valStr, bodyX + Math.floor(bodyW / 4), bodyY + Math.floor(bodyH / 3), 2, tr, tg, tb, 1, bodyW);
    fillRect(buf, bodyX, bodyY + bodyH - 10, bodyW, 6, 51, 65, 85, 0.6);
    fillRect(buf, bodyX, bodyY + bodyH - 10, Math.round((pct / 100) * bodyW), 6, ar, ag, ab, 1);
    return;
  }

  if (w.type === 'apex_bar' || w.type === 'apex_hbar') {
    const ids = w.entityIds ?? [];
    const items = ids.slice(0, 5).map((id) => {
      const ent = exposedEntities.find((e) => e.id === id);
      return {label: (ent?.tag ?? id).slice(0, 10), val: ent?.numericValue ?? 0, unit: ent?.unit ?? ''};
    });
    const maxVal = Math.max(...items.map((x) => x.val), 100);
    items.forEach((item, idx) => {
      const rowY = bodyY + idx * 18;
      drawText(buf, `${item.label} ${item.val}${item.unit}`, bodyX, rowY, 1, tr, tg, tb, 0.85, bodyW);
      fillRect(buf, bodyX, rowY + 9, bodyW, 5, 51, 65, 85, 0.5);
      fillRect(buf, bodyX, rowY + 9, Math.round((item.val / maxVal) * bodyW), 5, ar, ag, ab, 1);
    });
    return;
  }

  if (w.type === 'ha_entity') {
    const ha = haEntities.find((e) => e.entity_id === w.haEntityId);
    const val = ha ? `${ha.state} ${ha.attributes.unit_of_measurement ?? ''}`.trim() : 'N/A';
    drawText(buf, val, bodyX, bodyY + 8, 2, ar, ag, ab, 1, bodyW);
    return;
  }

  if (w.type === 'custom_text' || w.type === 'custom_html') {
    const raw = w.type === 'custom_html' ? (w.htmlCode || w.title).replace(/<[^>]+>/g, ' ') : (w.customText || w.title);
    const resolved = resolveTemplate(raw, exposedEntities).replace(/\s+/g, ' ').trim();
    drawText(buf, resolved, bodyX, bodyY + 8, 2, tr, tg, tb, 1, bodyW);
  }
}

export function renderScreenToRgbaBuffer(params: {
  screen: LcdScreen;
  telemetry: TelemetrySnapshot;
  haEntities: HomeAssistantEntity[];
  exposedEntities: ExposedEntity[];
  rotation?: 0 | 90 | 180 | 270;
  blank?: boolean;
}): Buffer {
  const buf = Buffer.alloc(LCD_W * LCD_H * 4);
  if (params.blank) {
    for (let i = 3; i < buf.length; i += 4) buf[i] = 255;
    return buf;
  }

  const [sr, sg, sb] = parseHexRgb(params.screen.backgroundColor || '#0B0E14');
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = sr;
    buf[i + 1] = sg;
    buf[i + 2] = sb;
    buf[i + 3] = 255;
  }

  for (const w of params.screen.widgets) {
    renderWidgetPixels(buf, w, params.telemetry, params.haEntities, params.exposedEntities);
  }

  if (params.rotation === 180) {
    const flipped = Buffer.alloc(buf.length);
    const totalPixels = LCD_W * LCD_H;
    for (let i = 0; i < totalPixels; i++) {
      const src = i * 4;
      const dst = (totalPixels - 1 - i) * 4;
      flipped[dst] = buf[src];
      flipped[dst + 1] = buf[src + 1];
      flipped[dst + 2] = buf[src + 2];
      flipped[dst + 3] = 255;
    }
    return flipped;
  }

  return buf;
}
