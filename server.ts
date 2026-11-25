import crypto from 'node:crypto';
import express, {type Express} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {DEFAULT_CONFIG} from './src/presets.ts';
import type {StudioConfig} from './src/types.ts';
import {detectAsterctlBinary} from './src/server/aoostar/asterctl.ts';
import {
  buildDiagnosticsSnapshot,
  clearEmergencyStop,
  dryRunScreenFrame,
  getLastFrameBuffer,
  getLastFrameMeta,
  isSerialWritesActive,
  isSerialWritesEnvLocked,
  pushHardwareFrame,
  resetFrameDiffCache,
  runSafeHardwareTest,
  scanUsbSerialDevices,
  setConfigSerialWritesEnabled,
  testAsterctlIntegration,
} from './src/server/hardware.ts';
import {
  armSessionPush,
  emergencyStopDaemon,
  forceFullRefreshNow,
  getDaemonStatus,
  gracefulShutdownHardware,
  isSessionPushArmed,
  resetDaemonBackoff,
  resetDaemonRotation,
  runHardwareDaemonTick,
  startHardwareDaemon,
  turnDisplayOffManual,
  turnDisplayOnManual,
} from './src/server/hardwareDaemon.ts';
import {renderScreenToPngBuffer, renderScreenToRgbaBuffer} from './src/server/frameRenderer.ts';
import {
  AuthRateLimiter,
  ChangeCredentialsSchema,
  clearSessionCookie,
  createCredentialStore,
  type CredentialStore,
  isDefaultPasswordPublicBlocked,
  LoginRequestSchema,
  PUBLIC_DEFAULT_PW_ERROR,
  ResetDefaultSchema,
  resolveClientIp,
  sendSessionCookie,
} from './src/server/auth.ts';
import {
  AuthSessionSchema,
  ConfigPatchSchema,
  createHostAndAuthMiddleware,
  createSecurityHeadersMiddleware,
  DEFAULT_UPSTREAM_MAX_BYTES,
  DeployRequestSchema,
  extractBearerToken,
  extractIndexHtmlInlineScriptHashes,
  getDirectorySizeBytes,
  maskConfigForClient,
  MAX_PENDING_UPLOADS,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOADS_TOTAL_BYTES,
  mergeIncomingConfig,
  PENDING_UPLOAD_TTL_MS,
  PushFrameRequestSchema,
  readJsonWithBackupFallback,
  resolveRasterOrVideoType,
  SafeTestRequestSchema,
  safeOutboundFetch,
  SerialWritesToggleSchema,
  signSessionCookieValue,
  TaskTriggerSchema,
  TestAgentSchema,
  TestHaSchema,
  UploadDataUrlSchema,
  UploadInitSchema,
  validateMediaMagicBytes,
  verifySessionCookieValue,
  writeFileAtomic0600,
} from './src/server/security.ts';
import {
  buildExposedEntities,
  fetchHomeAssistantEntities,
  getCachedOrRefreshIntegrations,
  refreshIntegrationsCache,
  resolveTelemetry,
  startIntegrationPoller,
  stopIntegrationPoller,
  triggerTaskState,
} from './src/server/telemetry.ts';
import {generateDockerCompose, generateUnraidCommunityAppsXml} from './src/server/unraidDeploy.ts';

function readAppVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')) as {
      version?: string;
    };
    if (pkg.version) return pkg.version;
  } catch {
    // fallback
  }
  return '1.0.5';
}

export const APP_VERSION = readAppVersion();

function normalizeLoadedConfig(parsed: Partial<StudioConfig> | null): StudioConfig {
  if (!parsed) return structuredClone(DEFAULT_CONFIG);
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

export interface StudioAppContext {
  app: Express;
  dataDir: string;
  bindHost: string;
  port: number;
  getCredentialStore: () => CredentialStore;
  getConfig: () => StudioConfig;
  startBackgroundDaemons: () => void;
  shutdown: () => Promise<void>;
}

export function createStudioApp(options?: {
  dataDir?: string;
  bindHost?: string;
  port?: number;
}): StudioAppContext {
  const port = options?.port ?? Number(process.env.PORT || 3000);
  const bindHost = options?.bindHost ?? (process.env.AOOSTAR_BIND || '127.0.0.1');
  const dataDir = options?.dataDir ? path.resolve(options.dataDir) : path.resolve(process.cwd(), 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  const configPath = path.join(dataDir, 'studio-config.json');

  fs.mkdirSync(dataDir, {recursive: true, mode: 0o700});
  fs.mkdirSync(uploadsDir, {recursive: true, mode: 0o755});

  // Remove any leftover orphan .part files from prior crashed upload sessions
  try {
    for (const file of fs.readdirSync(uploadsDir)) {
      if (file.endsWith('.part')) {
        fs.unlinkSync(path.join(uploadsDir, file));
      }
    }
  } catch {
    // ignore startup cleanup issues
  }

  const credentialStore = createCredentialStore(dataDir);
  const authRateLimiter = new AuthRateLimiter();

  const loaded = readJsonWithBackupFallback<Partial<StudioConfig>>(configPath);
  let currentConfig: StudioConfig = normalizeLoadedConfig(loaded.data);
  if (loaded.recoveredFromBackup) {
    writeFileAtomic0600(configPath, JSON.stringify(currentConfig, null, 2), false);
  }

  setConfigSerialWritesEnabled(Boolean(currentConfig.hardware.serialWritesEnabled));

  function saveConfig(config: StudioConfig) {
    writeFileAtomic0600(configPath, JSON.stringify(config, null, 2), true);
  }

  const app = express();
  app.disable('x-powered-by');
  if (process.env.AOOSTAR_TRUST_PROXY === 'true' || process.env.DISABLE_HMR === 'true') {
    app.set('trust proxy', 1);
  }

  const prodHtml = path.resolve(process.cwd(), 'dist', 'index.html');
  const devHtml = path.resolve(process.cwd(), 'index.html');
  const htmlPath = process.env.NODE_ENV === 'production' && fs.existsSync(prodHtml) ? prodHtml : devHtml;
  const inlineScriptHashes = extractIndexHtmlInlineScriptHashes(htmlPath);

  app.use(createSecurityHeadersMiddleware(inlineScriptHashes));
  app.use(
    createHostAndAuthMiddleware({
      getSessionSecret: () => credentialStore.getSessionSecret(),
      verifyApiToken: (tok) => credentialStore.verifyApiToken(tok),
      rateLimiter: authRateLimiter,
      getClientIp: resolveClientIp,
      bindHost,
    })
  );

  // Explicit 16mb JSON body limit only on frame/dataUrl routes; 2mb default elsewhere
  const largeJsonRoutes = new Set([
    '/api/uploads',
    '/api/hardware/deploy',
    '/api/hardware/push-frame',
    '/api/hardware/dry-run',
    '/api/hardware/safe-test',
  ]);
  const defaultJson = express.json({limit: '2mb'});
  const largeJson = express.json({limit: '16mb'});
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/uploads/chunk/')) {
      next();
      return;
    }
    if (largeJsonRoutes.has(req.path)) {
      largeJson(req, res, next);
      return;
    }
    defaultJson(req, res, next);
  });

  app.use(
    '/uploads',
    express.static(uploadsDir, {
      dotfiles: 'deny',
      index: false,
    })
  );

  app.get('/api/auth/status', (req, res) => {
    const bearer = extractBearerToken(req);
    const hasBearer = bearer !== null && credentialStore.verifyApiToken(bearer);
    const hasCookie = verifySessionCookieValue(credentialStore.getSessionSecret(), req.headers.cookie);
    const authenticated = hasBearer || hasCookie;
    const tokenMeta = credentialStore.getApiTokenMeta();

    res.json({
      authenticated,
      username: authenticated ? credentialStore.getEffectiveUsername() : null,
      usingDefaultPassword: credentialStore.isUsingDefaultPassword(),
      envOverrideActive: credentialStore.isEnvOverrideActive(),
      defaultPasswordPublicBlocked: isDefaultPasswordPublicBlocked(req, credentialStore),
      ...(authenticated
        ? {
            apiTokenConfigured: tokenMeta.configured,
            apiTokenPrefix: tokenMeta.prefix,
            apiTokenCreatedAt: tokenMeta.createdAt,
            envApiTokenConfigured: Boolean((process.env.AOOSTAR_API_TOKEN || '').trim()),
          }
        : {}),
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const parsed = LoginRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Username and password are required.'});
      return;
    }

    const clientIp = resolveClientIp(req);
    const rate = authRateLimiter.check(clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: `Too many failed login attempts. Try again in ${rate.retryAfterSec}s.`,
        retryAfterSec: rate.retryAfterSec,
      });
      return;
    }

    if (isDefaultPasswordPublicBlocked(req, credentialStore)) {
      res.status(403).json({
        error: PUBLIC_DEFAULT_PW_ERROR,
        publicBlocked: true,
      });
      return;
    }

    const valid = credentialStore.verifyLogin(parsed.data.username, parsed.data.password);
    if (!valid) {
      const fail = authRateLimiter.recordFailure(clientIp, 'login');
      await authRateLimiter.applyFailureDelay(fail.attemptsInWindow);
      if (fail.locked) {
        res.setHeader('Retry-After', String(fail.retryAfterSec));
        res.status(429).json({
          error: `Too many failed login attempts. Try again in ${fail.retryAfterSec}s.`,
          retryAfterSec: fail.retryAfterSec,
        });
        return;
      }
      res.status(401).json({error: 'Invalid username or password.'});
      return;
    }

    authRateLimiter.recordSuccess(clientIp);
    const usingDefault = credentialStore.isUsingDefaultPassword();
    if (usingDefault) {
      console.warn(
        `[aoostar-auth] WARNING: Default-credential login (admin/admin) from ${clientIp}. Change the password in Settings > Security.`
      );
    }

    const cookieVal = signSessionCookieValue(credentialStore.getSessionSecret());
    sendSessionCookie(res, req, cookieVal);
    res.json({
      ok: true,
      username: credentialStore.getEffectiveUsername(),
      usingDefaultPassword: usingDefault,
      envOverrideActive: credentialStore.isEnvOverrideActive(),
    });
  });

  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookie(res, req);
    res.json({ok: true});
  });

  app.post('/api/auth/session', async (req, res) => {
    const parsed = AuthSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Token is required.'});
      return;
    }
    const clientIp = resolveClientIp(req);
    const rate = authRateLimiter.check(clientIp);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({
        error: `Too many failed API token attempts. Try again in ${rate.retryAfterSec}s.`,
        retryAfterSec: rate.retryAfterSec,
      });
      return;
    }
    if (!credentialStore.verifyApiToken(parsed.data.token.trim())) {
      const fail = authRateLimiter.recordFailure(clientIp, 'api-token');
      await authRateLimiter.applyFailureDelay(fail.attemptsInWindow);
      if (fail.locked) {
        res.setHeader('Retry-After', String(fail.retryAfterSec));
        res.status(429).json({
          error: `Too many failed API token attempts. Try again in ${fail.retryAfterSec}s.`,
          retryAfterSec: fail.retryAfterSec,
        });
        return;
      }
      res.status(401).json({error: 'Invalid API token.'});
      return;
    }
    authRateLimiter.recordSuccess(clientIp);
    const cookieVal = signSessionCookieValue(credentialStore.getSessionSecret());
    sendSessionCookie(res, req, cookieVal);
    res.json({ok: true});
  });

  app.post('/api/auth/change-credentials', (req, res) => {
    const parsed = ChangeCredentialsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid credential change payload.',
      });
      return;
    }

    try {
      const updated = credentialStore.changeCredentials({
        currentPassword: parsed.data.currentPassword,
        newUsername: parsed.data.newUsername,
        newPassword: parsed.data.newPassword,
      });
      // Re-issue cookie for the active caller while invalidating all other sessions
      sendSessionCookie(res, req, signSessionCookieValue(updated.sessionSecret));
      res.json({
        ok: true,
        username: updated.username,
        usingDefaultPassword: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('incorrect') ? 401 : 400;
      res.status(status).json({error: msg});
    }
  });

  app.post('/api/auth/reset-default', (req, res) => {
    const parsed = ResetDefaultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Explicit confirmation is required to reset credentials.'});
      return;
    }
    try {
      const resetRes = credentialStore.resetToDefault();
      sendSessionCookie(res, req, signSessionCookieValue(resetRes.sessionSecret));
      res.json({
        ok: true,
        username: resetRes.username,
        usingDefaultPassword: true,
      });
    } catch (err) {
      res.status(400).json({error: err instanceof Error ? err.message : String(err)});
    }
  });

  app.post('/api/auth/logout-all', (req, res) => {
    credentialStore.rotateSessionSecret();
    clearSessionCookie(res, req);
    res.json({ok: true});
  });

  app.post('/api/auth/api-token/rotate', (_req, res) => {
    const rotated = credentialStore.rotateApiToken();
    res.json({
      ok: true,
      token: rotated.token,
      prefix: rotated.prefix,
      createdAt: rotated.createdAt,
    });
  });

  app.delete('/api/auth/api-token', (_req, res) => {
    credentialStore.revokeApiToken();
    res.json({ok: true});
  });

  app.get('/api/info', (_req, res) => {
    res.json({name: 'Aoostar Display Studio', version: APP_VERSION});
  });

  app.get('/api/config', (_req, res) => {
    res.json(maskConfigForClient(currentConfig));
  });

  app.post('/api/config', (req, res) => {
    const parsed = ConfigPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid configuration payload.',
        issues: parsed.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
      return;
    }

    const body = parsed.data as Parameters<typeof mergeIncomingConfig>[1];
    const prevHw = currentConfig.hardware;
    const prevDeployedScreenId = currentConfig.hardwareDeploy.currentScreenId;
    currentConfig = mergeIncomingConfig(currentConfig, body);

    if (body.hardware && typeof body.hardware.serialWritesEnabled === 'boolean') {
      if (isSerialWritesEnvLocked()) {
        currentConfig.hardware.serialWritesEnabled = false;
      }
      setConfigSerialWritesEnabled(Boolean(currentConfig.hardware.serialWritesEnabled));
    }

    if (
      body.hardware &&
      (currentConfig.hardware.brightness !== prevHw.brightness ||
        currentConfig.hardware.rotation !== prevHw.rotation ||
        currentConfig.hardware.devicePath !== prevHw.devicePath ||
        currentConfig.hardware.sleepMode !== prevHw.sleepMode ||
        currentConfig.hardware.sleepDimPercent !== prevHw.sleepDimPercent)
    ) {
      resetFrameDiffCache();
    }

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
        !enabledPlaylist.some((s) => s.id === prevDeployedScreenId) &&
        isSessionPushArmed() &&
        isSerialWritesActive()
      ) {
        resetDaemonRotation(0);
        void runHardwareDaemonTick(
          () => currentConfig,
          (patch) => {
            currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
          },
          undefined,
          {forceFullRefresh: true}
        ).catch((err) => {
          console.error('[aoostar-config-sync] Failed to sync screen change:', err);
        });
      }
    }

    if (body.integrations) {
      void refreshIntegrationsCache(currentConfig).catch(() => {});
    }

    saveConfig(currentConfig);
    res.json(maskConfigForClient(currentConfig));
  });

  app.post('/api/hardware/serial-writes', (req, res) => {
    const parsed = SerialWritesToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid serial-writes toggle payload.'});
      return;
    }
    if (isSerialWritesEnvLocked()) {
      res.status(403).json({
        error: 'Serial writes are locked off by environment variable AOOSTAR_LOCK_SERIAL_WRITES=true.',
      });
      return;
    }
    if (parsed.data.enabled && !parsed.data.confirmed) {
      res.status(400).json({
        error: 'Explicit confirmation (confirmed: true) is required to unlock serial writes.',
      });
      return;
    }

    currentConfig.hardware.serialWritesEnabled = parsed.data.enabled;
    setConfigSerialWritesEnabled(parsed.data.enabled);
    if (!parsed.data.enabled) {
      armSessionPush(false);
    }
    saveConfig(currentConfig);

    res.json({
      ok: true,
      serialWritesEnabled: isSerialWritesActive(),
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      ),
    });
  });

  // ==========================================
  // Hardened Uploads (Raster + Video Only, Magic Byte Verified, Quota Bounded)
  // ==========================================

  const pendingUploads = new Map<
    string,
    {
      id: string;
      name: string;
      kind: 'image' | 'video';
      ext: 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'mp4' | 'webm';
      tmpPath: string;
      bytes: number;
      createdAtMs: number;
    }
  >();

  function sweepExpiredUploads() {
    const now = Date.now();
    for (const [id, session] of pendingUploads.entries()) {
      if (now - session.createdAtMs > PENDING_UPLOAD_TTL_MS) {
        pendingUploads.delete(id);
        try {
          if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath);
        } catch {
          // ignore
        }
      }
    }
  }

  const sweepTimer = setInterval(sweepExpiredUploads, 60_000);
  sweepTimer.unref?.();

  app.post('/api/uploads/init', (req, res) => {
    sweepExpiredUploads();
    if (pendingUploads.size >= MAX_PENDING_UPLOADS) {
      res.status(429).json({error: 'Too many concurrent upload sessions. Wait or cancel active uploads.'});
      return;
    }

    const parsed = UploadInitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid upload initialization payload.'});
      return;
    }

    const {name, mimeType} = parsed.data;
    const resolved = resolveRasterOrVideoType(mimeType || '', name || '');
    if (!resolved) {
      res.status(400).json({
        error: 'Unsupported media format. SVG is blocked; use PNG, JPG, WebP, GIF, AVIF, MP4, or WebM.',
      });
      return;
    }

    if (getDirectorySizeBytes(uploadsDir) >= MAX_UPLOADS_TOTAL_BYTES) {
      res.status(413).json({error: 'Uploads storage quota (250 MiB) exceeded. Delete unused media first.'});
      return;
    }

    const id = `media-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const tmpPath = path.join(uploadsDir, `${id}.part`);
    fs.writeFileSync(tmpPath, Buffer.alloc(0));
    pendingUploads.set(id, {
      id,
      name: (name || 'Imported Media').replace(/\.[^/.]+$/, '').slice(0, 48) || 'Imported Media',
      kind: resolved.kind,
      ext: resolved.ext,
      tmpPath,
      bytes: 0,
      createdAtMs: Date.now(),
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
      if (session.bytes + chunk.length > MAX_UPLOAD_FILE_BYTES) {
        pendingUploads.delete(session.id);
        try {
          if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath);
        } catch {
          // ignore
        }
        res.status(413).json({error: 'Upload exceeds 25 MiB per-file limit.'});
        return;
      }
      if (getDirectorySizeBytes(uploadsDir) + chunk.length > MAX_UPLOADS_TOTAL_BYTES) {
        pendingUploads.delete(session.id);
        try {
          if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath);
        } catch {
          // ignore
        }
        res.status(413).json({error: 'Uploads storage quota (250 MiB) exceeded.'});
        return;
      }

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

    try {
      const fileBuf = fs.readFileSync(session.tmpPath);
      const magic = validateMediaMagicBytes(fileBuf, session.ext);
      if (!magic.ok) {
        try {
          fs.unlinkSync(session.tmpPath);
        } catch {
          // ignore
        }
        res.status(400).json({error: magic.error || 'Media file content failed magic-header verification.'});
        return;
      }

      const filename = `${session.id}.${session.ext}`;
      fs.renameSync(session.tmpPath, path.join(uploadsDir, filename));

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
    } catch (err) {
      try {
        if (fs.existsSync(session.tmpPath)) fs.unlinkSync(session.tmpPath);
      } catch {
        // ignore
      }
      res.status(500).json({error: err instanceof Error ? err.message : 'Failed to finalize upload.'});
    }
  });

  app.post('/api/uploads', (req, res) => {
    const parsed = UploadDataUrlSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Expected a valid image, GIF, or video data URL.'});
      return;
    }

    const {name, dataUrl} = parsed.data;
    const match = dataUrl.match(/^data:([^;,]+)(?:;[^,]+)*;base64,([\s\S]+)$/i);
    if (!match) {
      res.status(400).json({error: 'Invalid base64 upload payload.'});
      return;
    }

    const resolved = resolveRasterOrVideoType(match[1], name || '');
    if (!resolved) {
      res.status(400).json({
        error: 'Unsupported media format. SVG is blocked; use PNG, JPG, WebP, GIF, AVIF, MP4, or WebM.',
      });
      return;
    }

    const cleanBase64 = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    if (buffer.length > MAX_UPLOAD_FILE_BYTES) {
      res.status(413).json({error: 'Upload exceeds 25 MiB per-file limit.'});
      return;
    }
    if (getDirectorySizeBytes(uploadsDir) + buffer.length > MAX_UPLOADS_TOTAL_BYTES) {
      res.status(413).json({error: 'Uploads storage quota (250 MiB) exceeded.'});
      return;
    }

    const magic = validateMediaMagicBytes(buffer, resolved.ext);
    if (!magic.ok) {
      res.status(400).json({error: magic.error || 'Uploaded data does not match declared file header.'});
      return;
    }

    const id = `media-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const filename = `${id}.${resolved.ext}`;
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);

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
      const filePath = path.join(uploadsDir, path.basename(existing.url));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore
        }
      }
    }
    currentConfig.customImages = currentConfig.customImages.filter((item) => item.id !== id);
    saveConfig(currentConfig);
    res.json({ok: true});
  });

  // ==========================================
  // Telemetry & SSRF-Protected Integration Tests
  // ==========================================

  app.get('/api/telemetry', async (_req, res) => {
    const {sourceMode, agentEnabled, agentUrl, agentToken} = currentConfig.integrations;
    const integ = await getCachedOrRefreshIntegrations(currentConfig);

    const snapshot = await resolveTelemetry(
      sourceMode,
      agentEnabled,
      agentUrl,
      agentToken,
      integ.haConnected
    );

    const exposedEntities = buildExposedEntities(
      snapshot,
      integ.haEntities,
      integ.customConnections,
      currentConfig.entityOverrides
    );

    const maskedCustom = integ.customConnections.map((cc) => ({
      ...cc,
      token: '',
      tokenSet: Boolean(cc.token),
    }));

    res.json({
      snapshot,
      haConnected: integ.haConnected,
      haEntities: integ.haEntities,
      exposedEntities,
      customConnections: maskedCustom,
    });
  });

  app.post('/api/tasks/trigger', (req, res) => {
    const parsed = TaskTriggerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid task trigger payload.'});
      return;
    }
    triggerTaskState(parsed.data.taskId, parsed.data.action);
    res.json({ok: true});
  });

  app.post('/api/integrations/test-agent', async (req, res) => {
    const parsed = TestAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ok: false, message: 'Valid Agent URL is required.'});
      return;
    }

    const tokenToUse = parsed.data.agentToken?.trim() || currentConfig.integrations.agentToken;
    const targetUrl = `${parsed.data.agentUrl.replace(/\/+$/, '')}/api/v1/health`;
    try {
      const headers: Record<string, string> = {Accept: 'application/json'};
      if (tokenToUse) headers.Authorization = `Bearer ${tokenToUse}`;
      const r = await safeOutboundFetch(targetUrl, {
        headers,
        timeoutMs: 2500,
        maxBytes: DEFAULT_UPSTREAM_MAX_BYTES,
      });
      if (!r.ok) {
        res.json({ok: false, status: r.status, message: `Upstream responded with HTTP ${r.status}`});
        return;
      }
      res.json({ok: true, status: r.status, message: 'Connected to Unraid Management Agent'});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach Unraid Management Agent';
      const status = msg.includes('SSRF') || msg.includes('blocked') || msg.includes('scheme') ? 403 : 502;
      res.status(status).json({ok: false, message: msg});
    }
  });

  app.post('/api/integrations/test-ha', async (req, res) => {
    const parsed = TestHaSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ok: false, message: 'Home Assistant URL is required.'});
      return;
    }

    const tokenToUse = parsed.data.haToken?.trim() || currentConfig.integrations.haToken;
    if (!tokenToUse) {
      res.status(400).json({ok: false, message: 'Home Assistant Long-Lived Token is required.'});
      return;
    }

    const targetUrl = `${parsed.data.haUrl.replace(/\/+$/, '')}/api/`;
    try {
      const r = await safeOutboundFetch(targetUrl, {
        headers: {Authorization: `Bearer ${tokenToUse}`, Accept: 'application/json'},
        timeoutMs: 2500,
        maxBytes: DEFAULT_UPSTREAM_MAX_BYTES,
      });
      if (!r.ok) {
        res.json({ok: false, status: r.status, message: `Home Assistant responded with HTTP ${r.status}`});
        return;
      }
      res.json({ok: true, status: r.status, message: 'Connected to Home Assistant API'});
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to reach Home Assistant';
      const status = msg.includes('SSRF') || msg.includes('blocked') || msg.includes('scheme') ? 403 : 502;
      res.status(status).json({ok: false, message: msg});
    }
  });

  app.get('/api/ha/entities', async (_req, res) => {
    const {haEnabled, haUrl, haToken} = currentConfig.integrations;
    const result = await fetchHomeAssistantEntities(haEnabled, haUrl, haToken);
    res.json(result);
  });

  // ==========================================
  // Hardware Diagnostics, Preview & Display Controls
  // ==========================================

  app.get('/api/hardware/devices', (_req, res) => {
    const devices = scanUsbSerialDevices();
    res.json({
      devices,
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      ),
    });
  });

  app.get('/api/hardware/status', (_req, res) => {
    res.json({
      devices: scanUsbSerialDevices(),
      lastFrame: getLastFrameMeta(),
      daemonStatus: getDaemonStatus(),
      hardwareDeploy: currentConfig.hardwareDeploy,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      ),
    });
  });

  app.get('/api/diagnostics', (_req, res) => {
    res.json(
      buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      )
    );
  });

  app.get('/api/hardware/preview.png', async (req, res) => {
    try {
      const requestedId = typeof req.query.screenId === 'string' ? req.query.screenId : undefined;
      const scr =
        currentConfig.screens.find((s) => s.id === (requestedId || currentConfig.activeScreenId)) ||
        currentConfig.screens[0];
      if (!scr) {
        res.status(404).json({error: 'No screen configured.'});
        return;
      }

      const integ = await getCachedOrRefreshIntegrations(currentConfig);
      const {sourceMode, agentEnabled, agentUrl, agentToken} = currentConfig.integrations;
      const snapshot = await resolveTelemetry(
        sourceMode,
        agentEnabled,
        agentUrl,
        agentToken,
        integ.haConnected
      );
      const exposedEntities = buildExposedEntities(
        snapshot,
        integ.haEntities,
        integ.customConnections,
        currentConfig.entityOverrides
      );

      const png = renderScreenToPngBuffer({
        screen: scr,
        telemetry: snapshot,
        haEntities: integ.haEntities,
        exposedEntities,
        dockerIcons: currentConfig.dockerIcons,
        rotation: currentConfig.hardware.rotation,
        brightnessPercent: currentConfig.hardware.brightness,
        blank: false,
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.send(png);
    } catch (err) {
      res.status(500).json({error: err instanceof Error ? err.message : 'Preview render failed'});
    }
  });

  app.post('/api/hardware/dry-run', async (req, res) => {
    const {screenId, rgbaBase64} = (req.body || {}) as {screenId?: string; rgbaBase64?: string};
    try {
      const scr =
        currentConfig.screens.find((s) => s.id === (screenId || currentConfig.activeScreenId)) ||
        currentConfig.screens[0];

      let rgbaBuffer: Buffer;
      if (rgbaBase64) {
        rgbaBuffer = Buffer.from(rgbaBase64, 'base64');
      } else {
        const integ = await getCachedOrRefreshIntegrations(currentConfig);
        const {sourceMode, agentEnabled, agentUrl, agentToken} = currentConfig.integrations;
        const snapshot = await resolveTelemetry(
          sourceMode,
          agentEnabled,
          agentUrl,
          agentToken,
          integ.haConnected
        );
        const exposedEntities = buildExposedEntities(
          snapshot,
          integ.haEntities,
          integ.customConnections,
          currentConfig.entityOverrides
        );
        rgbaBuffer = renderScreenToRgbaBuffer({
          screen: scr,
          telemetry: snapshot,
          haEntities: integ.haEntities,
          exposedEntities,
          dockerIcons: currentConfig.dockerIcons,
          rotation: currentConfig.hardware.rotation,
          brightnessPercent: currentConfig.hardware.brightness,
          blank: false,
        });
      }

      const result = dryRunScreenFrame({
        rgbaBuffer,
        screenId: scr?.id || 'dry-run',
        screenName: scr?.name || 'Dry Run Screen',
      });

      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    }
  });

  app.post('/api/hardware/test-asterctl', async (req, res) => {
    const {testRealDevice, action, confirmed} = (req.body || {}) as {
      testRealDevice?: boolean;
      action?: 'simulate' | 'on' | 'off';
      confirmed?: boolean;
    };
    try {
      const result = await testAsterctlIntegration({
        requestedDevicePath: currentConfig.hardware.devicePath,
        testRealDevice: Boolean(testRealDevice),
        action,
        confirmed: Boolean(confirmed),
      });
      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({
        ok: false,
        error: msg,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    }
  });

  app.post('/api/hardware/safe-test', async (req, res) => {
    const parsed = SafeTestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Explicit confirmation (confirmed: true) is required before writing to the physical LCD.',
      });
      return;
    }

    try {
      const result = await runSafeHardwareTest({
        confirmed: true,
        mode: parsed.data.mode,
        devicePath: currentConfig.hardware.devicePath,
        rgbaBuffer: parsed.data.rgbaBase64 ? Buffer.from(parsed.data.rgbaBase64, 'base64') : undefined,
      });
      res.json({
        ...result,
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('Serial writes') || msg.includes('Emergency stop') ? 403 : 500;
      res.status(status).json({
        ok: false,
        error: msg,
        lastFrame: getLastFrameMeta(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    }
  });

  app.post('/api/display/on', async (_req, res) => {
    try {
      const meta = await turnDisplayOnManual(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
        }
      );
      res.json({
        ok: true,
        meta,
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('Serial writes') || msg.includes('Emergency stop') ? 403 : 500;
      res.status(status).json({ok: false, error: msg});
    }
  });

  app.post('/api/display/off', async (_req, res) => {
    try {
      const meta = await turnDisplayOffManual(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
        }
      );
      res.json({
        ok: true,
        meta,
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('Serial writes') || msg.includes('Emergency stop') ? 403 : 500;
      res.status(status).json({ok: false, error: msg});
    }
  });

  app.post('/api/hardware/force-refresh', async (_req, res) => {
    try {
      const meta = await forceFullRefreshNow(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
        }
      );
      res.json({
        ok: true,
        meta: meta ?? getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('Serial writes') || msg.includes('Emergency stop') ? 403 : 500;
      res.status(status).json({ok: false, error: msg});
    }
  });

  app.post('/api/hardware/stop-serial', async (_req, res) => {
    await emergencyStopDaemon(
      Boolean(currentConfig.hardware.powerOffOnEmergencyStop),
      currentConfig.hardware.devicePath
    );
    currentConfig.hardware.autoPushEnabled = false;
    currentConfig.hardwareDeploy.deployed = false;
    currentConfig.hardwareDeploy.daemonState = 'stopped';
    saveConfig(currentConfig);
    res.json({
      ok: true,
      message: 'Emergency stop activated: closed serial port, stopped asterctl, and disabled auto-push.',
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      ),
    });
  });

  app.post('/api/hardware/clear-emergency-stop', (_req, res) => {
    clearEmergencyStop();
    resetDaemonBackoff();
    res.json({
      ok: true,
      diagnostics: buildDiagnosticsSnapshot(
        isSessionPushArmed(),
        currentConfig.hardware.devicePath,
        getDaemonStatus().daemonState
      ),
    });
  });

  app.post('/api/hardware/deploy', async (req, res) => {
    const parsed = DeployRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid deploy payload.'});
      return;
    }

    const {screens, activeScreenId} = parsed.data;
    if (Array.isArray(screens) && screens.length > 0) {
      const incomingById = new Map((screens as StudioConfig['screens']).map((s) => [s.id, s]));
      const mergedScreens = currentConfig.screens.map((s) => incomingById.get(s.id) ?? s);
      for (const s of screens as StudioConfig['screens']) {
        if (!mergedScreens.some((existing) => existing.id === s.id)) {
          mergedScreens.push(s);
        }
      }
      currentConfig.screens = mergedScreens;
    }

    const enabledPlaylist = currentConfig.screens.filter((s) => s.enabled);
    const targetScreens = enabledPlaylist.length > 0 ? enabledPlaylist : currentConfig.screens;

    const startIndex = activeScreenId
      ? Math.max(0, targetScreens.findIndex((s) => s.id === activeScreenId))
      : 0;

    if (!isSerialWritesActive()) {
      res.status(403).json({
        error:
          'Serial writes are disabled. Validate packets via Diagnostics -> Dry run first, then set AOOSTAR_ENABLE_SERIAL_WRITES=true or unlock serial writes in Settings.',
        meta: getLastFrameMeta(),
        diagnostics: buildDiagnosticsSnapshot(
          isSessionPushArmed(),
          currentConfig.hardware.devicePath,
          getDaemonStatus().daemonState
        ),
      });
      return;
    }

    currentConfig.hardwareDeploy = {
      ...currentConfig.hardwareDeploy,
      deployed: true,
      deployedAt: new Date().toISOString(),
      activeIndex: startIndex,
      currentScreenId: targetScreens[startIndex]?.id ?? null,
      currentScreenName: targetScreens[startIndex]?.name ?? null,
      daemonState: 'active',
      lastError: null,
      screens: structuredClone(targetScreens),
    };
    saveConfig(currentConfig);

    armSessionPush(true);
    resetDaemonRotation(startIndex);
    resetDaemonBackoff();
    resetFrameDiffCache();

    try {
      // Unified server-side @resvg/resvg-js render: pixel-identical across preview, manual deploy, and auto-push
      const meta = await runHardwareDaemonTick(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
        },
        undefined,
        {forceFullRefresh: true}
      );

      res.json({
        meta: meta ?? getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        hardwareDeploy: currentConfig.hardwareDeploy,
      });
    } catch (err) {
      armSessionPush(false);
      currentConfig.hardwareDeploy.deployed = false;
      currentConfig.hardwareDeploy.daemonState = 'error';
      const msg = err instanceof Error ? err.message : String(err);
      currentConfig.hardwareDeploy.lastError = msg;
      saveConfig(currentConfig);
      const status = msg.includes('Emergency stop') || msg.includes('Serial writes') ? 403 : 500;
      res.status(status).json({
        error: msg,
        meta: getLastFrameMeta(),
        daemonStatus: getDaemonStatus(),
        hardwareDeploy: currentConfig.hardwareDeploy,
      });
    }
  });

  app.post('/api/hardware/push-frame', async (req, res) => {
    const parsed = PushFrameRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: 'Invalid push-frame payload.'});
      return;
    }

    const {screenId, screenName} = parsed.data;
    try {
      const scr =
        currentConfig.screens.find((s) => s.id === (screenId || currentConfig.activeScreenId)) ||
        currentConfig.screens[0];
      const integ = await getCachedOrRefreshIntegrations(currentConfig);
      const {sourceMode, agentEnabled, agentUrl, agentToken} = currentConfig.integrations;
      const snapshot = await resolveTelemetry(
        sourceMode,
        agentEnabled,
        agentUrl,
        agentToken,
        integ.haConnected
      );
      const exposedEntities = buildExposedEntities(
        snapshot,
        integ.haEntities,
        integ.customConnections,
        currentConfig.entityOverrides
      );
      const brightness = currentConfig.hardware.brightness;
      const rgbaBuffer = renderScreenToRgbaBuffer({
        screen: scr,
        telemetry: snapshot,
        haEntities: integ.haEntities,
        exposedEntities,
        dockerIcons: currentConfig.dockerIcons,
        rotation: currentConfig.hardware.rotation,
        brightnessPercent: brightness,
        blank: false,
      });
      const meta = await pushHardwareFrame({
        rgbaBuffer,
        screenId: scr?.id || currentConfig.activeScreenId,
        screenName: screenName || scr?.name || 'Active Screen',
        devicePath: currentConfig.hardware.devicePath,
        brightnessPercent: 100, // already applied in unified server-side renderer
        brightnessKey: brightness,
      });
      res.json(meta);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = msg.includes('Emergency stop') || msg.includes('Serial writes') ? 403 : 500;
      res.status(status).json({
        error: msg,
        meta: getLastFrameMeta(),
      });
    }
  });

  app.get('/api/hardware/last-frame.rgb565', (_req, res) => {
    const buf = getLastFrameBuffer();
    if (!buf) {
      res.status(404).json({error: 'No frame pushed or dry-run built yet.'});
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="aoostar-960x376.rgb565"');
    res.send(buf);
  });

  app.get('/api/export/unraid-xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml');
    res.send(generateUnraidCommunityAppsXml(port));
  });

  app.get('/api/export/docker-compose', (_req, res) => {
    res.setHeader('Content-Type', 'text/yaml');
    res.send(generateDockerCompose());
  });

  return {
    app,
    dataDir,
    bindHost,
    port,
    getCredentialStore: () => credentialStore,
    getConfig: () => currentConfig,
    startBackgroundDaemons: () => {
      startIntegrationPoller(() => currentConfig, Math.max(2500, currentConfig.hardware.pollIntervalMs || 5000));
      startHardwareDaemon(
        () => currentConfig,
        (patch) => {
          currentConfig.hardwareDeploy = {...currentConfig.hardwareDeploy, ...patch};
        }
      );
    },
    shutdown: async () => {
      clearInterval(sweepTimer);
      stopIntegrationPoller();
      await gracefulShutdownHardware(() => currentConfig);
    },
  };
}

async function bootstrap() {
  const ctx = createStudioApp();
  const {app, bindHost, port} = ctx;

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(port, bindHost, () => {
    console.log(`Aoostar Display Studio v${APP_VERSION} listening on http://${bindHost}:${port}`);
    const detected = scanUsbSerialDevices();
    const bin = detectAsterctlBinary();
    const aoostar = detected.find((d) => d.isAoostarMatch);
    console.log(
      `[aoostar-startup] bind=${bindHost} | serialWritesActive=${isSerialWritesActive()} | ` +
        `asterctl=${bin.available ? `${bin.binaryPath} (${bin.version})` : `unavailable (${bin.error})`} | ` +
        `usb=${aoostar ? `${aoostar.path} (${aoostar.vendorId}:${aoostar.productId}, rw=${aoostar.writable})` : 'not detected (0416:90a1)'}`
    );
    ctx.startBackgroundDaemons();
  });

  let shutdownInProgress = false;
  const handleSignal = (sig: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    console.log(`[aoostar-shutdown] Received ${sig}, stopping daemon & closing serial transport...`);
    void ctx
      .shutdown()
      .catch(() => {})
      .finally(() => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 2500).unref?.();
      });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
}

if (process.env.AOOSTAR_NO_AUTOSTART !== 'true') {
  void bootstrap();
}
