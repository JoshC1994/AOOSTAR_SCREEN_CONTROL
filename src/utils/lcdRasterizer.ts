import {LCD_HEIGHT, LCD_WIDTH} from '../presets.ts';
import type {ExposedEntity, HomeAssistantEntity, LcdScreen, TelemetrySnapshot} from '../types.ts';
import {formatBytes, hexToRgba} from './format.ts';

async function loadImageSafe(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function rasterizeScreenToRgbaBase64(
  screen: LcdScreen,
  telemetry: TelemetrySnapshot | null,
  haEntities: HomeAssistantEntity[],
  exposedEntities: ExposedEntity[] = [],
  dockerIcons: Record<string, string> = {},
  rotation: 0 | 90 | 180 | 270 = 0
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = LCD_WIDTH;
  canvas.height = LCD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  if (rotation === 180) {
    ctx.translate(LCD_WIDTH, LCD_HEIGHT);
    ctx.rotate(Math.PI);
  } else if (rotation === 90) {
    ctx.translate(LCD_WIDTH, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 270) {
    ctx.translate(0, LCD_HEIGHT);
    ctx.rotate(-Math.PI / 2);
  }

  ctx.fillStyle = screen.backgroundColor || '#0B0E14';
  ctx.fillRect(0, 0, LCD_WIDTH, LCD_HEIGHT);

  if (screen.backgroundType === 'image' && screen.backgroundImage) {
    const img = await loadImageSafe(screen.backgroundImage);
    if (img) {
      const scale = Math.max(LCD_WIDTH / img.width, LCD_HEIGHT / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (LCD_WIDTH - dw) / 2, (LCD_HEIGHT - dh) / 2, dw, dh);
    }
    if (screen.backgroundDim > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${screen.backgroundDim})`;
      ctx.fillRect(0, 0, LCD_WIDTH, LCD_HEIGHT);
    }
  }

  for (const w of screen.widgets) {
    if (w.type === 'divider') {
      ctx.strokeStyle = w.accentColor;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y + w.h / 2);
      ctx.lineTo(w.x + w.w, w.y + w.h / 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      continue;
    }

    if (w.type === 'image_layer' && w.imageUrl) {
      const img = await loadImageSafe(w.imageUrl);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 4);
        ctx.clip();
        ctx.drawImage(img, w.x, w.y, w.w, w.h);
        ctx.restore();
      }
      continue;
    }

    if (w.bgImageUrl) {
      const bgImg = await loadImageSafe(w.bgImageUrl);
      if (bgImg) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(w.x, w.y, w.w, w.h, 4);
        ctx.clip();
        ctx.globalAlpha = w.bgImageOpacity ?? 1;
        ctx.drawImage(bgImg, w.x, w.y, w.w, w.h);
        ctx.restore();
      }
    }

    ctx.fillStyle = hexToRgba(w.bgColor, w.bgOpacity);
    ctx.strokeStyle = `rgba(148, 163, 184, ${w.borderOpacity})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(w.x, w.y, w.w, w.h, 4);
    ctx.fill();
    ctx.stroke();

    const presetMult =
      w.fontSizePreset === 'sm'
        ? 0.85
        : w.fontSizePreset === 'lg'
          ? 1.2
          : w.fontSizePreset === 'xl'
            ? 1.45
            : w.fontSizePreset === '2xl'
              ? 1.75
              : 1;
    const scale = Math.max(0.5, Math.min(2.5, (w.fontScale || 1) * presetMult));
    const uiScale = Math.min(1.35, scale);
    const titleSize = Number((13.5 * Math.min(1.3, scale)).toFixed(1));
    const headerBottom = Math.round(w.y + 11 + titleSize * 0.85 + 10);

    if (w.type === 'docker_list' && telemetry?.containers) {
      const itemSize = Math.round(14 * Math.min(1.25, scale));
      const iconSize = Math.round(itemSize * 1.15);
      const rowStep = Math.round(itemSize * 1.6);
      const maxRows = Math.min(w.maxItems ?? 5, Math.max(1, Math.floor((w.h - (headerBottom - w.y) - 8) / rowStep)));
      const running = telemetry.containers.filter((c) => c.state === 'running').slice(0, maxRows);
      let rowY = headerBottom + itemSize + 2;
      for (const c of running) {
        const iconUrl = dockerIcons[c.name];
        if (iconUrl) {
          const iconImg = await loadImageSafe(iconUrl);
          if (iconImg) {
            ctx.drawImage(iconImg, w.x + 12, rowY - iconSize + 2, iconSize, iconSize);
          }
        }
        ctx.fillStyle = w.textColor;
        ctx.font = `500 ${itemSize}px "JetBrains Mono", monospace`;
        ctx.fillText(c.name, w.x + (iconUrl ? 18 + iconSize : 12), rowY, w.w - 104);
        rowY += rowStep;
      }
    }

    ctx.fillStyle = '#94A3B8';
    ctx.font = `600 ${titleSize}px "Public Sans", sans-serif`;
    ctx.fillText(w.title, w.x + 12, Math.round(w.y + 11 + titleSize * 0.85), w.w - 34);

    ctx.fillStyle = w.accentColor;
    ctx.beginPath();
    ctx.arc(w.x + w.w - 14, Math.round(w.y + 11 + titleSize * 0.45), 4, 0, Math.PI * 2);
    ctx.fill();

    if (w.type === 'docker_list') continue;

    const valSize = Math.round(Math.max(24, Math.min(42, (w.h - (headerBottom - w.y) - 18) * 0.55)) * uiScale);
    ctx.fillStyle = w.textColor;
    ctx.font = `700 ${valSize}px "JetBrains Mono", monospace`;
    let valueText = '';

    if (w.type === 'entity_number') {
      const ent = exposedEntities.find((e) => e.id === w.entityId);
      valueText = ent ? `${ent.rawValue}${ent.unit ? ` ${ent.unit}` : ''}` : '—';
    } else if (w.type === 'entity_list' || w.type === 'apex_hbar' || w.type === 'apex_bar') {
      const ids = w.entityIds ?? [];
      const firstEnt = exposedEntities.find((e) => e.id === ids[0]);
      valueText = firstEnt
        ? `${firstEnt.tag}: ${firstEnt.rawValue}${firstEnt.unit}${ids.length > 1 ? ` (+${ids.length - 1})` : ''}`
        : w.title;
    } else if (w.type === 'custom_html') {
      const resolved = (w.htmlCode || w.title).replace(/\{\{([^}]+)\}\}/g, (_m, id: string) => {
        const clean = id.trim().replace(/^tag:/, '');
        const ent = exposedEntities.find((e) => e.id === clean);
        return ent ? `${ent.rawValue}${ent.unit}` : clean;
      });
      valueText = resolved.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 42) || w.title;
    } else if (w.type === 'clock') {
      valueText = new Date().toLocaleTimeString('en-US', {hour12: false});
    } else if (w.type === 'cpu_load') {
      valueText = `${telemetry?.system?.cpuPercent ?? 0}% · ${telemetry?.system?.cpuTempC ?? 0}C`;
    } else if (w.type === 'memory_bar') {
      const pct = Math.round(
        ((telemetry?.system?.ramUsedBytes ?? 0) / Math.max(1, telemetry?.system?.ramTotalBytes ?? 1)) * 100
      );
      valueText = `${pct}% (${formatBytes(telemetry?.system?.ramUsedBytes ?? 0, 1)})`;
    } else if (w.type === 'array_status') {
      valueText = `${telemetry?.array?.state ?? 'STARTED'} · ${formatBytes(telemetry?.array?.usedBytes ?? 0, 1)}`;
    } else if (w.type === 'ha_entity') {
      const ent = haEntities.find((e) => e.entity_id === w.haEntityId);
      valueText = ent ? `${ent.state} ${ent.attributes.unit_of_measurement ?? ''}`.trim() : 'N/A';
    } else if (w.type === 'custom_text') {
      valueText = (w.customText || w.title).replace(/\{\{([^}]+)\}\}/g, (_m, id: string) => {
        const ent = exposedEntities.find((e) => e.id === id.trim());
        return ent ? `${ent.rawValue}${ent.unit}` : id.trim();
      });
    } else {
      valueText = w.title;
    }

    ctx.fillText(valueText, w.x + 12, Math.min(w.y + w.h - 14, headerBottom + valSize + 6), w.w - 24);
  }

  const imageData = ctx.getImageData(0, 0, LCD_WIDTH, LCD_HEIGHT);
  const bytes = new Uint8Array(imageData.data.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
