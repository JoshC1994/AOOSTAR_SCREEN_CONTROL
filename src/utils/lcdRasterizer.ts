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

    if (w.type === 'docker_list' && telemetry?.containers) {
      const running = telemetry.containers.filter((c) => c.state === 'running').slice(0, w.maxItems ?? 5);
      let rowY = w.y + 34;
      for (const c of running) {
        const iconUrl = dockerIcons[c.name];
        if (iconUrl) {
          const iconImg = await loadImageSafe(iconUrl);
          if (iconImg) {
            ctx.drawImage(iconImg, w.x + 10, rowY - 10, 12, 12);
          }
        }
        ctx.fillStyle = w.textColor;
        ctx.font = '500 11px "JetBrains Mono", monospace';
        ctx.fillText(c.name, w.x + (iconUrl ? 26 : 10), rowY, w.w - 90);
        rowY += 16;
      }
    }

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 10px "Public Sans", sans-serif';
    ctx.fillText(w.title, w.x + 10, w.y + 18, w.w - 28);

    ctx.fillStyle = w.accentColor;
    ctx.beginPath();
    ctx.arc(w.x + w.w - 12, w.y + 14, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = w.textColor;
    ctx.font = '700 22px "JetBrains Mono", monospace';
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

    ctx.fillText(valueText, w.x + 10, w.y + Math.min(w.h - 14, 52), w.w - 20);
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
