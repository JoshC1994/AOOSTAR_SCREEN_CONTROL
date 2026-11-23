import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {createServer as createViteServer} from 'vite';
import {DEFAULT_CONFIG} from './src/presets.ts';
import type {StudioConfig} from './src/types.ts';
import {
  encodeAndPushRgb565Frame,
  getLastFrameBuffer,
  getLastFrameMeta,
  scanUsbSerialDevices,
} from './src/server/hardware.ts';
import {
  getDaemonStatus,
  resetDaemonRotation,
  runHardwareDaemonTick,
  startHardwareDaemon,
} from './src/server/hardwareDaemon.ts';
import {
  buildExposedEntities,
  fetchHomeAssistantEntities,
  pollCustomConnections,
  resolveTelemetry,
  triggerTaskState,
} from './src/server/telemetry.ts';
import {
  generateDockerCompose,
  generateUnraidCommunityAppsXml,
  generateUnraidPluginPlg,
} from './src/server/unraidDeploy.ts';

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CONFIG_PATH = path.join(DATA_DIR, 'studio-config.json');

fs.mkdirSync(UPLOADS_DIR, {recursive: true});

function loadConfig(): StudioConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Partial<StudioConfig>;
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        hardware: {...DEFAULT_CONFIG.hardware, ...(parsed.hardware || {})},
        integrations: {
          ...DEFAULT_CONFIG.integrations,
          ...(parsed.integrations || {}),
          customConnections: Array.isArray(parsed.integrations?.customConnections)
            ? parsed.integrations.customConnections
            : [],
        },
        entityOverrides: parsed.entityOverrides || {},
        dockerIcons: parsed.dockerIcons || {},
        screens: Array.isArray(parsed.screens) && parsed.screens.length > 0 ? parsed.screens : DEFAULT_CONFIG.screens,
        savedScreens: Array.isArray(parsed.savedScreens) ? parsed.savedScreens : DEFAULT_CONFIG.savedScreens,
        hardwareDeploy: {
          ...DEFAULT_CONFIG.hardwareDeploy,
          ...(parsed.hardwareDeploy || {}),
          screens:
            Array.isArray(parsed.hardwareDeploy?.screens) && parsed.hardwareDeploy.screens.length > 0
              ? parsed.hardwareDeploy.screens
              : DEFAULT_CONFIG.screens,
        },
        customImages: Array.isArray(parsed.customImages) ? parsed.customImages : [],
      };
    }
  } catch {
    // fallback to defaults
  }
  return structuredClone(DEFAULT_CONFIG);
}

function saveConfig(config: StudioConfig) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

let currentConfig: StudioConfig = loadConfig();

async function bootstrap() {
  const app = express();
  app.use(express.json({limit: '100mb'}));

  app.use('/uploads', express.static(UPLOADS_DIR));

  app.get('/api/config', (_req, res) => {
    res.json(currentConfig);
  });

  app.post('/api/config', (req, res) => {
    const body = req.body as Partial<StudioConfig>;
    const prevDeployedScreenId = currentConfig.hardwareDeploy.currentScreenId;
    currentConfig = {
      ...currentConfig,
      ...body,
      hardware: {...currentConfig.hardware, ...(body.hardware || {})},
      integrations: {
        ...currentConfig.integrations,
        ...(body.integrations || {}),
        customConnections: Array.isArray(body.integrations?.customConnections)
          ? body.integrations.customConnections
          : currentConfig.integrations.customConnections,
      },
      entityOverrides: body.entityOverrides ?? currentConfig.entityOverrides,
      dockerIcons: body.dockerIcons ?? currentConfig.dockerIcons,
      savedScreens: Array.isArray(body.savedScreens) ? body.savedScreens : currentConfig.savedScreens,
      hardwareDeploy: body.hardwareDeploy
        ? {...currentConfig.hardwareDeploy, ...body.hardwareDeploy}
        : currentConfig.hardwareDeploy,
    };

    if (Array.isArray(body.screens)) {
      const enabledPlaylist = currentConfig.screens.filter((s) => s.enabled);
      const nextIndex = Math.max(
        0,
        Math.min(
          Math.max(0, enabledPlaylist.length - 1),
          currentConfig.hardwareDeploy.activeIndex ?? 0
        )
      );
      currentConfig.hardwareDeploy = {
        ...currentConfig.hardwareDeploy,
        activeIndex: nextIndex,
        currentScreenId: enabledPlaylist[nextIndex]?.id ?? null,
        currentScreenName: enabledPlaylist[nextIndex]?.name ?? null,
        screens: structuredClone(enabledPlaylist),
      };
      if (
        prevDeployedScreenId &&
        !enabledPlaylist.some((s) => s.id === prevDeployedScreenId)
      ) {
        resetDaemonRotation(0);
        void runHardwareDaemonTick(
          () => currentConfig,
          (patch) => {
            currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
          }
        );
      }
    }

    saveConfig(currentConfig);
    res.json(currentConfig);
  });

  function resolveMediaTypeAndExt(
    mimeRaw: string,
    filename: string
  ): {kind: 'image' | 'video'; ext: string} | null {
    const mime = mimeRaw.toLowerCase().trim();
    const lowerName = filename.toLowerCase();
    if (mime === 'image/gif' || lowerName.endsWith('.gif')) return {kind: 'image', ext: 'gif'};
    if (mime === 'image/png' || lowerName.endsWith('.png')) return {kind: 'image', ext: 'png'};
    if (
      mime === 'image/jpeg' ||
      mime === 'image/jpg' ||
      lowerName.endsWith('.jpg') ||
      lowerName.endsWith('.jpeg')
    ) {
      return {kind: 'image', ext: 'jpg'};
    }
    if (mime === 'image/webp' || lowerName.endsWith('.webp')) return {kind: 'image', ext: 'webp'};
    if (mime === 'image/svg+xml' || lowerName.endsWith('.svg')) return {kind: 'image', ext: 'svg'};
    if (mime === 'image/avif' || lowerName.endsWith('.avif')) return {kind: 'image', ext: 'avif'};
    if (mime === 'video/mp4' || lowerName.endsWith('.mp4')) return {kind: 'video', ext: 'mp4'};
    if (mime === 'video/webm' || lowerName.endsWith('.webm')) return {kind: 'video', ext: 'webm'};
    return null;
  }

  const pendingUploads = new Map<
    string,
    {id: string; name: string; kind: 'image' | 'video'; ext: string; tmpPath: string; bytes: number}
  >();

  app.post('/api/uploads/init', (req, res) => {
    const {name, mimeType} = req.body as {name?: string; mimeType?: string};
    const resolved = resolveMediaTypeAndExt(mimeType || '', name || '');
    if (!resolved) {
      res
        .status(400)
        .json({error: 'Unsupported media format. Use PNG, JPG, WEBP, GIF, SVG, AVIF, MP4, or WebM.'});
      return;
    }
    const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const tmpPath = path.join(UPLOADS_DIR, `${id}.part`);
    fs.writeFileSync(tmpPath, Buffer.alloc(0));
    pendingUploads.set(id, {
      id,
      name: (name || 'Imported Media').replace(/\.[^/.]+$/, '').slice(0, 48) || 'Imported Media',
      kind: resolved.kind,
      ext: resolved.ext,
      tmpPath,
      bytes: 0,
    });
    res.json({uploadId: id});
  });

  app.post(
    '/api/uploads/chunk/:uploadId',
    express.raw({type: 'application/octet-stream', limit: '8mb'}),
    (req, res) => {
      const session = pendingUploads.get(req.params.uploadId);
      if (!session) {
        res.status(404).json({error: 'Upload session not found.'});
        return;
      }
      const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
      fs.appendFileSync(session.tmpPath, chunk);
      session.bytes += chunk.length;
      res.json({ok: true, bytesReceived: session.bytes});
    }
  );

  app.post('/api/uploads/finish/:uploadId', (req, res) => {
    const session = pendingUploads.get(req.params.uploadId);
    if (!session) {
      res.status(404).json({error: 'Upload session not found.'});
      return;
    }
    pendingUploads.delete(req.params.uploadId);
    const filename = `${session.id}.${session.ext}`;
    fs.renameSync(session.tmpPath, path.join(UPLOADS_DIR, filename));

    const record = {
      id: session.id,
      name: session.name,
      url: `/uploads/${filename}`,
      mediaType: session.kind,
      createdAt: new Date().toISOString(),
    };
    currentConfig.customImages = [record, ...currentConfig.customImages];
    saveConfig(currentConfig);
    res.json(record);
  });

  app.post('/api/uploads', (req, res) => {
    const {name, dataUrl} = req.body as {name?: string; dataUrl?: string};
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({error: 'Expected a valid image, GIF, or video data URL.'});
      return;
    }
    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]+)*;base64,([\s\S]+)$/i);
    if (!match) {
      res.status(400).json({error: 'Invalid base64 upload payload.'});
      return;
    }

    const resolved = resolveMediaTypeAndExt(match[1], name || '');
    if (!resolved) {
      res
        .status(400)
        .json({error: 'Unsupported media format. Use PNG, JPG, WEBP, GIF, SVG, AVIF, MP4, or WebM.'});
      return;
    }

    const cleanBase64 = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const id = `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const filename = `${id}.${resolved.ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), buffer);

    const record = {
      id,
      name: (name || 'Imported Media').replace(/\.[^/.]+$/, '').slice(0, 48) || 'Imported Media',
      url: `/uploads/${filename}`,
      mediaType: resolved.kind,
      createdAt: new Date().toISOString(),
    };
    currentConfig.customImages = [record, ...currentConfig.customImages];
    saveConfig(currentConfig);
    res.json(record);
  });

  app.delete('/api/uploads/:id', (req, res) => {
    const {id} = req.params;
    const existing = currentConfig.customImages.find((item) => item.id === id);
    if (existing?.url.startsWith('/uploads/')) {
      const filePath = path.join(UPLOADS_DIR, path.basename(existing.url));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore unlink errors
        }
      }
    }
    currentConfig.customImages = currentConfig.customImages.filter((item) => item.id !== id);
    saveConfig(currentConfig);
    res.json({ok: true});
  });

  // Unified real-time endpoint: always pulls server stats + HA + custom HTTP sources + Exposed Entities
  app.get('/api/telemetry', async (_req, res) => {
    const {sourceMode, agentEnabled, agentUrl, agentToken, haEnabled, haUrl, haToken, customConnections} =
      currentConfig.integrations;

    const [haRes, polledCustom] = await Promise.all([
      fetchHomeAssistantEntities(haEnabled, haUrl, haToken),
      pollCustomConnections(customConnections),
    ]);

    currentConfig.integrations.customConnections = polledCustom;

    const snapshot = await resolveTelemetry(
      sourceMode,
      agentEnabled,
      agentUrl,
      agentToken,
      haRes.connected
    );

    const exposedEntities = buildExposedEntities(
      snapshot,
      haRes.entities,
      polledCustom,
      currentConfig.entityOverrides
    );

    res.json({
      snapshot,
      haConnected: haRes.connected,
      haEntities: haRes.entities,
      exposedEntities,
      customConnections: polledCustom,
    });
  });

  app.post('/api/tasks/trigger', (req, res) => {
    const {taskId, action} = req.body as {taskId: string; action: 'start' | 'stop'};
    if (!taskId || (action !== 'start' && action !== 'stop')) {
      res.status(400).json({error: 'Invalid task trigger payload.'});
      return;
    }
    triggerTaskState(taskId, action);
    res.json({ok: true});
  });

  app.post('/api/integrations/test-agent', async (req, res) => {
    const {agentUrl, agentToken} = req.body as {agentUrl: string; agentToken?: string};
    if (!agentUrl) {
      res.status(400).json({ok: false, message: 'Agent URL is required.'});
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const headers: Record<string, string> = {};
      if (agentToken) headers.Authorization = `Bearer ${agentToken}`;
      const r = await fetch(`${agentUrl.replace(/\/+$/, '')}/api/v1/health`, {
        headers,
        signal: controller.signal,
      });
      if (!r.ok) {
        res.json({ok: false, message: `HTTP ${r.status} from ${agentUrl}`});
        return;
      }
      const data = await r.json();
      res.json({ok: true, message: 'Connected to Unraid Management Agent', data});
    } catch (err) {
      res.json({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach Unraid Management Agent',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  app.post('/api/integrations/test-ha', async (req, res) => {
    const {haUrl, haToken} = req.body as {haUrl: string; haToken: string};
    if (!haUrl || !haToken) {
      res.status(400).json({ok: false, message: 'Home Assistant URL and Long-Lived Token are required.'});
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const r = await fetch(`${haUrl.replace(/\/+$/, '')}/api/`, {
        headers: {Authorization: `Bearer ${haToken}`},
        signal: controller.signal,
      });
      if (!r.ok) {
        res.json({ok: false, message: `HTTP ${r.status} from Home Assistant`});
        return;
      }
      const data = await r.json();
      res.json({ok: true, message: 'Connected to Home Assistant API', data});
    } catch (err) {
      res.json({
        ok: false,
        message: err instanceof Error ? err.message : 'Unable to reach Home Assistant',
      });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/ha/entities', async (_req, res) => {
    const {haEnabled, haUrl, haToken} = currentConfig.integrations;
    const result = await fetchHomeAssistantEntities(haEnabled, haUrl, haToken);
    res.json(result);
  });

  app.get('/api/hardware/devices', (_req, res) => {
    const devices = scanUsbSerialDevices();
    res.json({
      devices,
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
    });
  });

  app.get('/api/hardware/status', (_req, res) => {
    res.json({
      devices: scanUsbSerialDevices(),
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
    });
  });

  app.post('/api/hardware/deploy', async (req, res) => {
    const {screens, rgbaBase64, activeScreenId} = req.body as {
      screens?: StudioConfig['screens'];
      rgbaBase64?: string;
      activeScreenId?: string;
    };

    const targetScreens =
      Array.isArray(screens) && screens.length > 0
        ? screens
        : currentConfig.screens.filter((s) => s.enabled);

    const startIndex = activeScreenId
      ? Math.max(0, targetScreens.findIndex((s) => s.id === activeScreenId))
      : 0;

    currentConfig.hardwareDeploy = {
      ...currentConfig.hardwareDeploy,
      deployed: true,
      deployedAt: new Date().toISOString(),
      activeIndex: startIndex,
      currentScreenId: targetScreens[startIndex]?.id ?? null,
      currentScreenName: targetScreens[startIndex]?.name ?? null,
      screens: structuredClone(targetScreens),
    };
    saveConfig(currentConfig);

    resetDaemonRotation(startIndex);
    const meta = await runHardwareDaemonTick(
      () => currentConfig,
      (patch) => {
        currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
      },
      rgbaBase64,
      true
    );

    res.json({
      meta: meta ?? getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
    });
  });

  app.post('/api/hardware/push-frame', (req, res) => {
    const {rgbaBase64, screenId, screenName} = req.body as {
      rgbaBase64?: string;
      screenId?: string;
      screenName?: string;
    };
    const meta = encodeAndPushRgb565Frame({
      rgbaBase64,
      screenId: screenId || currentConfig.activeScreenId,
      screenName: screenName || 'Active Screen',
      devicePath: currentConfig.hardware.devicePath,
      brightness: currentConfig.hardware.brightness,
      forceFull: true,
    });
    res.json(meta);
  });

  app.get('/api/hardware/last-frame.rgb565', (_req, res) => {
    const buf = getLastFrameBuffer();
    if (!buf) {
      res.status(404).json({error: 'No frame pushed yet.'});
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="aoostar-960x376.rgb565"');
    res.send(buf);
  });

  app.get('/api/export/unraid-xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.send(generateUnraidCommunityAppsXml(PORT));
  });

  app.get('/api/export/unraid-plg', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.send(generateUnraidPluginPlg(3088));
  });

  app.get('/api/export/docker-compose', (_req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    res.send(generateDockerCompose());
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aoostar Display Studio listening on http://0.0.0.0:${PORT}`);
    startHardwareDaemon(
      () => currentConfig,
      (patch) => {
        currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
      }
    );
  });
}

bootstrap();
