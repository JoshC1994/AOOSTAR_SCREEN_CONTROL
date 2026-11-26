import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type {NextFunction, Request, Response} from 'express';
import {z} from 'zod';
import type {CustomConnection, StudioConfig} from '../types.ts';
import type {AuthRateLimiter} from './auth.ts';

export const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB per file
export const MAX_UPLOADS_TOTAL_BYTES = 250 * 1024 * 1024; // 250 MiB total uploads cap
export const MAX_PENDING_UPLOADS = 10;
export const PENDING_UPLOAD_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const DEFAULT_UPSTREAM_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB max upstream response

export const SESSION_COOKIE_NAME = 'aoostar_session';

export function writeFileAtomic0600(
  filePath: string,
  content: string | Uint8Array,
  keepBackup = true
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const rand = crypto.randomBytes(6).toString('hex');
  const tmpPath = `${filePath}.tmp.${process.pid}.${rand}`;

  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, 0o600);
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    let offset = 0;
    while (offset < buf.length) {
      offset += fs.writeSync(fd, buf, offset, buf.length - offset);
    }
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    if (keepBackup && fs.existsSync(filePath)) {
      try {
        const existing = fs.readFileSync(filePath);
        if (existing.length > 0) {
          const bakTmp = `${filePath}.bak.tmp.${process.pid}.${rand}`;
          fs.writeFileSync(bakTmp, existing, {mode: 0o600});
          fs.renameSync(bakTmp, `${filePath}.bak`);
          fs.chmodSync(`${filePath}.bak`, 0o600);
        }
      } catch {
        // best-effort backup
      }
    }

    fs.renameSync(tmpPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

export function readJsonWithBackupFallback<T>(filePath: string): {
  data: T | null;
  recoveredFromBackup: boolean;
  error: string | null;
} {
  const tryParse = (p: string): T | null => {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  };

  try {
    const primary = tryParse(filePath);
    if (primary !== null) {
      return {data: primary, recoveredFromBackup: false, error: null};
    }
  } catch (err) {
    const primaryErr = err instanceof Error ? err.message : String(err);
    const bakPath = `${filePath}.bak`;
    try {
      const backup = tryParse(bakPath);
      if (backup !== null) {
        console.warn(`[aoostar-config] Primary config corrupt (${primaryErr}); recovered from ${bakPath}`);
        return {data: backup, recoveredFromBackup: true, error: primaryErr};
      }
    } catch (bakErr) {
      return {
        data: null,
        recoveredFromBackup: false,
        error: `Primary (${primaryErr}) and backup (${bakErr instanceof Error ? bakErr.message : String(bakErr)}) unreadable`,
      };
    }
    return {data: null, recoveredFromBackup: false, error: primaryErr};
  }

  // Primary did not exist: still check backup
  try {
    const backup = tryParse(`${filePath}.bak`);
    if (backup !== null) {
      return {data: backup, recoveredFromBackup: true, error: null};
    }
  } catch {
    // ignore
  }

  return {data: null, recoveredFromBackup: false, error: null};
}

export function loadOrCreateApiToken(dataDir: string): {
  token: string;
  generatedNow: boolean;
  tokenPath: string;
  fromEnv: boolean;
} {
  const envToken = (process.env.AOOSTAR_API_TOKEN || '').trim();
  const tokenPath = path.join(dataDir, '.auth-token');
  if (envToken) {
    return {token: envToken, generatedNow: false, tokenPath, fromEnv: true};
  }

  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf8').trim();
      if (existing.length >= 16) {
        try {
          fs.chmodSync(tokenPath, 0o600);
        } catch {
          // ignore
        }
        return {token: existing, generatedNow: false, tokenPath, fromEnv: false};
      }
    }
  } catch {
    // regenerate if unreadable
  }

  const generated = crypto.randomBytes(32).toString('hex');
  writeFileAtomic0600(tokenPath, `${generated}\n`, false);
  return {token: generated, generatedNow: true, tokenPath, fromEnv: false};
}

export function safeTokenEqual(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const hExpected = crypto.createHash('sha256').update(expected).digest();
  const hProvided = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(hExpected, hProvided);
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const m = auth.match(/^Bearer\s+(.+)$/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  const xToken = req.headers['x-api-token'];
  if (typeof xToken === 'string' && xToken.trim()) return xToken.trim();
  return null;
}

export function signSessionCookieValue(apiToken: string, ttlMs = 7 * 24 * 60 * 60 * 1000): string {
  const exp = Date.now() + ttlMs;
  const payload = String(exp);
  const sig = crypto
    .createHmac('sha256', apiToken)
    .update(`aoostar-session:${payload}`)
    .digest('hex');
  return `${payload}.${sig}`;
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(val);
    } catch {
      out[key] = val;
    }
  }
  return out;
}

export function verifySessionCookieValue(apiToken: string, cookieHeader?: string): boolean {
  const cookies = parseCookies(cookieHeader);
  const raw = cookies[SESSION_COOKIE_NAME];
  if (!raw) return false;
  const dotIdx = raw.indexOf('.');
  if (dotIdx <= 0) return false;
  const payload = raw.slice(0, dotIdx);
  const sig = raw.slice(dotIdx + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedSig = crypto
    .createHmac('sha256', apiToken)
    .update(`aoostar-session:${payload}`)
    .digest('hex');
  return safeTokenEqual(expectedSig, sig);
}

function parseHostnameAndPort(rawHost: string): {hostname: string; hostLower: string} {
  const cleaned = rawHost.trim().toLowerCase();
  if (cleaned.startsWith('[')) {
    const endIdx = cleaned.indexOf(']');
    if (endIdx !== -1) {
      return {
        hostname: cleaned.slice(1, endIdx),
        hostLower: cleaned,
      };
    }
  }
  const colonIdx = cleaned.lastIndexOf(':');
  if (colonIdx > 0 && !cleaned.includes(']')) {
    return {
      hostname: cleaned.slice(0, colonIdx),
      hostLower: cleaned,
    };
  }
  return {hostname: cleaned, hostLower: cleaned};
}

function isIpLiteral(hostname: string): boolean {
  return net.isIP(hostname) !== 0;
}

function isPrivateOrLocalIp(ip: string): boolean {
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (net.isIPv4(clean)) {
    const p = clean.split('.').map(Number);
    if (p.length !== 4) return false;
    if (p[0] === 127) return true;
    if (p[0] === 10) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

export function isAllowedHostHeader(
  req: Request,
  bindHost: string,
  allowedHostsEnv = process.env.AOOSTAR_ALLOWED_HOSTS || ''
): boolean {
  const rawHost = req.headers.host;
  if (!rawHost || typeof rawHost !== 'string') return false;

  const {hostname, hostLower} = parseHostnameAndPort(rawHost);
  if (!hostname) return false;

  // Explicit allowlist from environment (supports host or host:port)
  const allowlist = allowedHostsEnv
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.includes(hostLower) || allowlist.includes(hostname)) {
    return true;
  }

  // Loopback hosts are always valid
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }

  // Exact IP literal of the listening socket
  const localAddr = req.socket?.localAddress;
  if (localAddr) {
    const normalizedLocal = localAddr.startsWith('::ffff:') ? localAddr.slice(7) : localAddr;
    if (hostname === normalizedLocal.toLowerCase()) {
      return true;
    }
  }

  // When bound to all interfaces (e.g. Docker bridge), permit private LAN IPs, local hostname, and *.local mDNS
  if (bindHost === '0.0.0.0' || bindHost === '::') {
    if (isIpLiteral(hostname) && isPrivateOrLocalIp(hostname)) {
      return true;
    }
    const sysHost = os.hostname().toLowerCase();
    if (hostname === sysHost || hostname === `${sysHost}.local` || /^[a-z0-9-]+\.local$/i.test(hostname)) {
      return true;
    }
  }

  // Preview environments where proxy hostname is injected explicitly
  if (
    process.env.DISABLE_HMR === 'true' &&
    (process.env.AOOSTAR_ALLOW_PROXY_HOSTS === 'true' ||
      hostname.endsWith('.run.app') ||
      hostname.endsWith('.aistudio.google.com'))
  ) {
    return true;
  }

  return false;
}

export function validateOriginAndReferer(
  req: Request,
  allowedHostsEnv = process.env.AOOSTAR_ALLOWED_HOSTS || ''
): {ok: boolean; hasBrowserOrigin: boolean; reason?: string} {
  const hostHeader = (req.headers.host || '').toLowerCase();
  const trustProxy = process.env.AOOSTAR_TRUST_PROXY === 'true' || process.env.DISABLE_HMR === 'true';
  const rawForwardedHost = trustProxy ? req.headers['x-forwarded-host'] : undefined;
  const forwardedHost =
    typeof rawForwardedHost === 'string'
      ? rawForwardedHost.split(',')[0].trim().toLowerCase()
      : Array.isArray(rawForwardedHost) && rawForwardedHost[0]
        ? rawForwardedHost[0].split(',')[0].trim().toLowerCase()
        : '';
  const forwardedHostname = forwardedHost ? parseHostnameAndPort(forwardedHost).hostname : '';

  const originHeader = req.headers.origin;
  const refererHeader = req.headers.referer;

  const allowlist = new Set(
    allowedHostsEnv
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  );

  const matchesExpectedHost = (candidateHost: string, candidateHostname: string): boolean => {
    if (candidateHost === hostHeader || allowlist.has(candidateHost) || allowlist.has(candidateHostname)) {
      return true;
    }
    if (forwardedHost && (candidateHost === forwardedHost || candidateHostname === forwardedHostname)) {
      return true;
    }
    return false;
  };

  if (originHeader !== undefined) {
    if (typeof originHeader !== 'string' || originHeader === 'null' || !originHeader.trim()) {
      return {ok: false, hasBrowserOrigin: true, reason: 'Blocked null or empty Origin header (CSRF protection)'};
    }
    try {
      const originUrl = new URL(originHeader);
      if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') {
        return {ok: false, hasBrowserOrigin: true, reason: 'Blocked unsupported Origin scheme'};
      }
      const originHost = originUrl.host.toLowerCase();
      const originHostname = originUrl.hostname.toLowerCase();
      if (matchesExpectedHost(originHost, originHostname)) {
        return {ok: true, hasBrowserOrigin: true};
      }
      return {
        ok: false,
        hasBrowserOrigin: true,
        reason: `Cross-origin request blocked: Origin (${originHost}) does not match Host (${forwardedHost || hostHeader})`,
      };
    } catch {
      return {ok: false, hasBrowserOrigin: true, reason: 'Malformed Origin header'};
    }
  }

  if (refererHeader && typeof refererHeader === 'string') {
    try {
      const refUrl = new URL(refererHeader);
      const refHost = refUrl.host.toLowerCase();
      const refHostname = refUrl.hostname.toLowerCase();
      if (matchesExpectedHost(refHost, refHostname)) {
        return {ok: true, hasBrowserOrigin: true};
      }
      return {
        ok: false,
        hasBrowserOrigin: true,
        reason: `Cross-origin Referer blocked (${refHost} != ${forwardedHost || hostHeader})`,
      };
    } catch {
      return {ok: false, hasBrowserOrigin: true, reason: 'Malformed Referer header'};
    }
  }

  return {ok: true, hasBrowserOrigin: false};
}

export function extractIndexHtmlInlineScriptHashes(indexHtmlPath: string): string[] {
  try {
    if (!fs.existsSync(indexHtmlPath)) return [];
    const html = fs.readFileSync(indexHtmlPath, 'utf8');
    const hashes: string[] = [];
    const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(html)) !== null) {
      const body = m[1];
      if (body && body.trim()) {
        const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
        hashes.push(`'sha256-${digest}'`);
      }
    }
    return hashes;
  } catch {
    return [];
  }
}

export function createSecurityHeadersMiddleware(inlineScriptHashes: string[]) {
  const scriptSrc = [`'self'`, ...inlineScriptHashes].join(' ');
  const allowIframePreview = process.env.DISABLE_HMR === 'true';

  return (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    if (req.path.startsWith('/uploads/')) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self'; media-src 'self'; sandbox"
      );
      if (!allowIframePreview) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      next();
      return;
    }

    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }

    const frameDirective = allowIframePreview ? '' : "; frame-ancestors 'self'";
    if (!allowIframePreview) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }

    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; base-uri 'self'; object-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${frameDirective}`
    );

    next();
  };
}

export function createHostAndAuthMiddleware(params: {
  getSessionSecret: () => string;
  verifyApiToken: (token: string) => boolean;
  rateLimiter: AuthRateLimiter;
  getClientIp: (req: Request) => string;
  bindHost: string;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isAllowedHostHeader(req, params.bindHost)) {
      res.status(403).json({
        error: 'Forbidden: untrusted Host header (DNS rebinding protection). Configure AOOSTAR_ALLOWED_HOSTS if accessing via reverse proxy.',
      });
      return;
    }

    // Only /api/* routes (and /uploads/*) require API checks; static SPA HTML/assets load cleanly
    const isApi = req.path.startsWith('/api/');
    const isUploadAsset = req.path.startsWith('/uploads/');
    if (!isApi && !isUploadAsset) {
      next();
      return;
    }

    // State-changing /api/* routes remain protected by Host & Origin/Referer checks
    const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
    if (isApi && isStateChanging) {
      const originCheck = validateOriginAndReferer(req);
      if (!originCheck.ok) {
        res.status(403).json({error: originCheck.reason || 'Cross-origin request blocked'});
        return;
      }
    }

    if (req.path === '/api/info') {
      next();
      return;
    }

    if (req.path === '/api/auth/status' && req.method.toUpperCase() === 'GET') {
      next();
      return;
    }

    if (
      (req.path === '/api/auth/login' ||
        req.path === '/api/auth/logout' ||
        req.path === '/api/auth/session') &&
      req.method.toUpperCase() === 'POST'
    ) {
      next();
      return;
    }

    void (async () => {
      const bearer = extractBearerToken(req);
      let hasValidBearer = false;

      if (bearer !== null) {
        const clientIp = params.getClientIp(req);
        const rate = params.rateLimiter.check(clientIp);
        if (!rate.allowed) {
          res.setHeader('Retry-After', String(rate.retryAfterSec));
          res.status(429).json({
            error: `Too many failed authentication attempts. Try again in ${rate.retryAfterSec}s.`,
            retryAfterSec: rate.retryAfterSec,
          });
          return;
        }

        if (params.verifyApiToken(bearer)) {
          params.rateLimiter.recordSuccess(clientIp);
          hasValidBearer = true;
        } else {
          const fail = params.rateLimiter.recordFailure(clientIp, 'api-token');
          await params.rateLimiter.applyFailureDelay(fail.attemptsInWindow);
          if (fail.locked) {
            res.setHeader('Retry-After', String(fail.retryAfterSec));
            res.status(429).json({
              error: `Too many failed API token attempts. Try again in ${fail.retryAfterSec}s.`,
              retryAfterSec: fail.retryAfterSec,
            });
            return;
          }
          res.status(401).json({
            error: 'Unauthorized: invalid API token.',
            authRequired: true,
          });
          return;
        }
      }

      const hasValidCookie = verifySessionCookieValue(params.getSessionSecret(), req.headers.cookie);

      if (!hasValidBearer && !hasValidCookie) {
        res.status(401).json({
          error: 'Authentication required. Sign in with your Studio credentials or a valid API token.',
          authRequired: true,
        });
        return;
      }

      // If cookie-authenticated on a state-changing request without Origin/Referer, block CSRF
      if (!hasValidBearer && hasValidCookie && isStateChanging) {
        const originCheck = validateOriginAndReferer(req);
        if (!originCheck.hasBrowserOrigin) {
          res.status(403).json({
            error: 'Forbidden: cookie-authenticated state change requires matching Origin/Referer or Bearer token.',
          });
          return;
        }
      }

      next();
    })().catch(next);
  };
}

// ==========================================
// Secret Masking & Merging
// ==========================================

export function maskConfigForClient(cfg: StudioConfig): StudioConfig {
  return {
    ...cfg,
    integrations: {
      ...cfg.integrations,
      agentToken: '',
      agentTokenSet: Boolean(cfg.integrations.agentToken),
      haToken: '',
      haTokenSet: Boolean(cfg.integrations.haToken),
      customConnections: (cfg.integrations.customConnections || []).map((cc) => ({
        ...cc,
        token: '',
        tokenSet: Boolean(cc.token),
      })),
    },
  };
}

export function mergeIncomingConfig(current: StudioConfig, incoming: Partial<StudioConfig>): StudioConfig {
  const prevCustomById = new Map(
    (current.integrations.customConnections || []).map((cc) => [cc.id, cc])
  );

  let nextAgentToken = current.integrations.agentToken;
  if (incoming.integrations?.clearAgentToken) {
    nextAgentToken = '';
  } else if (typeof incoming.integrations?.agentToken === 'string' && incoming.integrations.agentToken.trim() !== '') {
    nextAgentToken = incoming.integrations.agentToken.trim();
  }

  let nextHaToken = current.integrations.haToken;
  if (incoming.integrations?.clearHaToken) {
    nextHaToken = '';
  } else if (typeof incoming.integrations?.haToken === 'string' && incoming.integrations.haToken.trim() !== '') {
    nextHaToken = incoming.integrations.haToken.trim();
  }

  const nextCustomConnections: CustomConnection[] = Array.isArray(incoming.integrations?.customConnections)
    ? incoming.integrations!.customConnections.map((cc) => {
        const prev = prevCustomById.get(cc.id);
        const nextTok =
          typeof cc.token === 'string' && cc.token.trim() !== ''
            ? cc.token.trim()
            : prev?.token || '';
        return {
          ...cc,
          token: nextTok || undefined,
          tokenSet: Boolean(nextTok),
        };
      })
    : current.integrations.customConnections;

  return {
    ...current,
    ...incoming,
    hardware: {...current.hardware, ...(incoming.hardware || {})},
    integrations: {
      ...current.integrations,
      ...(incoming.integrations || {}),
      agentToken: nextAgentToken,
      agentTokenSet: Boolean(nextAgentToken),
      clearAgentToken: undefined,
      haToken: nextHaToken,
      haTokenSet: Boolean(nextHaToken),
      clearHaToken: undefined,
      customConnections: nextCustomConnections,
    },
    entityOverrides: incoming.entityOverrides ?? current.entityOverrides,
    dockerIcons: incoming.dockerIcons ?? current.dockerIcons,
    savedScreens: Array.isArray(incoming.savedScreens) ? incoming.savedScreens : current.savedScreens,
    customImages: Array.isArray(incoming.customImages) ? incoming.customImages : current.customImages,
    hardwareDeploy: current.hardwareDeploy,
  };
}

// ==========================================
// SSRF Protection & Bounded Fetch
// ==========================================

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function ipv4InCidr(ip: string, cidrBase: string, prefixLen: number): boolean {
  if (!net.isIPv4(ip) || !net.isIPv4(cidrBase)) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(cidrBase) & mask);
}

function matchesAllowlist(hostname: string, ip: string | null, allowlistRaw: string): boolean {
  const items = allowlistRaw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const hostLow = hostname.toLowerCase();
  const cleanIp = ip ? (ip.startsWith('::ffff:') ? ip.slice(7) : ip).toLowerCase() : null;

  for (const entry of items) {
    if (entry === hostLow) return true;
    if (cleanIp && entry === cleanIp) return true;
    if (cleanIp && entry.includes('/')) {
      const [base, bitsStr] = entry.split('/');
      const bits = Number(bitsStr);
      if (net.isIPv4(cleanIp) && net.isIPv4(base) && Number.isInteger(bits) && bits >= 0 && bits <= 32) {
        if (ipv4InCidr(cleanIp, base, bits)) return true;
      }
    }
  }
  return false;
}

export function isBlockedSsrfIp(ipRaw: string, blockPrivateNets = false): {blocked: boolean; reason?: string} {
  let ip = ipRaw.trim().toLowerCase();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);

  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }

  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return {blocked: true, reason: 'Invalid IPv4 address'};
    }
    if (p[0] === 127) return {blocked: true, reason: `Loopback IP ${ip} is blocked`};
    if (p[0] === 0) return {blocked: true, reason: `Unspecified IP ${ip} is blocked`};
    if (p[0] === 169 && p[1] === 254) {
      return {blocked: true, reason: `Link-local / cloud metadata IP ${ip} is blocked`};
    }
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) {
      return {blocked: true, reason: `Carrier-grade NAT IP ${ip} is blocked`};
    }
    if (p[0] >= 224) return {blocked: true, reason: `Multicast / reserved IP ${ip} is blocked`};
    if (blockPrivateNets) {
      if (
        p[0] === 10 ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168)
      ) {
        return {blocked: true, reason: `Private network IP ${ip} is blocked by AOOSTAR_BLOCK_PRIVATE_NETS`};
      }
    }
    return {blocked: false};
  }

  if (net.isIPv6(ip)) {
    if (ip === '::' || ip === '0:0:0:0:0:0:0:0') {
      return {blocked: true, reason: 'Unspecified IPv6 address :: is blocked'};
    }
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') {
      return {blocked: true, reason: 'Loopback IPv6 address ::1 is blocked'};
    }
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
      return {blocked: true, reason: `Link-local IPv6 address ${ip} is blocked`};
    }
    if (ip.startsWith('ff')) {
      return {blocked: true, reason: `Multicast IPv6 address ${ip} is blocked`};
    }
    if (blockPrivateNets && (ip.startsWith('fc') || ip.startsWith('fd'))) {
      return {blocked: true, reason: `Unique-local IPv6 address ${ip} is blocked`};
    }
    return {blocked: false};
  }

  return {blocked: true, reason: `Unrecognized IP format: ${ipRaw}`};
}

export async function assertSafeOutboundUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http:// and https:// are allowed.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing embedded credentials are not allowed.');
  }

  const allowlistRaw = process.env.AOOSTAR_SSRF_ALLOWLIST || '';
  const blockPrivateNets = process.env.AOOSTAR_BLOCK_PRIVATE_NETS === 'true';
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new Error('URL hostname is missing.');
  }

  if (matchesAllowlist(hostname, isIpLiteral(hostname) ? hostname : null, allowlistRaw)) {
    return parsed;
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Loopback hostname localhost is blocked by SSRF policy.');
  }

  if (isIpLiteral(hostname)) {
    const check = isBlockedSsrfIp(hostname, blockPrivateNets);
    if (check.blocked) {
      throw new Error(check.reason || `Target IP ${hostname} is blocked by SSRF policy.`);
    }
    return parsed;
  }

  let resolved: Array<{address: string; family: number}>;
  try {
    resolved = await dns.lookup(hostname, {all: true, verbatim: true});
  } catch {
    throw new Error(`DNS resolution failed for host "${hostname}".`);
  }

  if (!resolved || resolved.length === 0) {
    throw new Error(`DNS returned no addresses for host "${hostname}".`);
  }

  for (const addr of resolved) {
    if (matchesAllowlist(hostname, addr.address, allowlistRaw)) continue;
    const check = isBlockedSsrfIp(addr.address, blockPrivateNets);
    if (check.blocked) {
      throw new Error(check.reason || `Resolved address ${addr.address} is blocked by SSRF policy.`);
    }
  }

  return parsed;
}

export async function safeOutboundFetch(
  rawUrl: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
    maxRedirects?: number;
  }
): Promise<{status: number; ok: boolean; bodyBuffer: Buffer; finalUrl: string}> {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const maxBytes = options?.maxBytes ?? DEFAULT_UPSTREAM_MAX_BYTES;
  const maxRedirects = options?.maxRedirects ?? 3;

  let currentUrl = (await assertSafeOutboundUrl(rawUrl)).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(currentUrl, {
        headers: options?.headers,
        signal: controller.signal,
        redirect: 'manual',
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return {status: res.status, ok: false, bodyBuffer: Buffer.alloc(0), finalUrl: currentUrl};
        }
        if (hop === maxRedirects) {
          throw new Error('Too many upstream redirects.');
        }
        const nextUrl = new URL(location, currentUrl).toString();
        currentUrl = (await assertSafeOutboundUrl(nextUrl)).toString();
        continue;
      }

      const contentLength = Number(res.headers.get('content-length') || 0);
      if (contentLength > maxBytes) {
        throw new Error(`Upstream response exceeds ${maxBytes} byte limit.`);
      }

      const chunks: Buffer[] = [];
      let total = 0;
      if (res.body) {
        const reader = res.body.getReader();
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          if (value) {
            total += value.byteLength;
            if (total > maxBytes) {
              await reader.cancel();
              throw new Error(`Upstream response exceeded ${maxBytes} byte limit.`);
            }
            chunks.push(Buffer.from(value));
          }
        }
      }

      return {
        status: res.status,
        ok: res.ok,
        bodyBuffer: Buffer.concat(chunks),
        finalUrl: currentUrl,
      };
    }

    throw new Error('Too many upstream redirects.');
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// Media Upload Validation (No SVG!)
// ==========================================

export function resolveRasterOrVideoType(
  mimeRaw: string,
  filename: string
): {kind: 'image' | 'video'; ext: 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'mp4' | 'webm'} | null {
  const mime = (mimeRaw || '').toLowerCase().trim();
  const lowerName = (filename || '').toLowerCase().trim();

  if (mime === 'image/svg+xml' || lowerName.endsWith('.svg') || lowerName.endsWith('.svgz')) {
    return null;
  }

  if (mime === 'image/png' || lowerName.endsWith('.png')) return {kind: 'image', ext: 'png'};
  if (
    mime === 'image/jpeg' ||
    mime === 'image/jpg' ||
    lowerName.endsWith('.jpg') ||
    lowerName.endsWith('.jpeg')
  ) {
    return {kind: 'image', ext: 'jpg'};
  }
  if (mime === 'image/gif' || lowerName.endsWith('.gif')) return {kind: 'image', ext: 'gif'};
  if (mime === 'image/webp' || lowerName.endsWith('.webp')) return {kind: 'image', ext: 'webp'};
  if (mime === 'image/avif' || lowerName.endsWith('.avif')) return {kind: 'image', ext: 'avif'};
  if (mime === 'video/mp4' || lowerName.endsWith('.mp4')) return {kind: 'video', ext: 'mp4'};
  if (mime === 'video/webm' || lowerName.endsWith('.webm')) return {kind: 'video', ext: 'webm'};

  return null;
}

export function validateMediaMagicBytes(
  buf: Uint8Array,
  expectedExt: 'png' | 'jpg' | 'gif' | 'webp' | 'avif' | 'mp4' | 'webm'
): {ok: boolean; error?: string} {
  if (buf.length < 12) {
    return {ok: false, error: 'Uploaded file is too small or empty to be a valid media file.'};
  }

  const headText = Buffer.from(buf.subarray(0, Math.min(buf.length, 256)))
    .toString('utf8')
    .trimStart()
    .toLowerCase();
  if (headText.startsWith('<svg') || headText.startsWith('<?xml') || headText.includes('<script')) {
    return {ok: false, error: 'SVG or XML/HTML payloads are not permitted.'};
  }

  switch (expectedExt) {
    case 'png': {
      const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      const match = sig.every((b, idx) => buf[idx] === b);
      return match ? {ok: true} : {ok: false, error: 'File content does not match PNG magic header.'};
    }
    case 'jpg': {
      const match = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      return match ? {ok: true} : {ok: false, error: 'File content does not match JPEG magic header.'};
    }
    case 'gif': {
      const hdr = Buffer.from(buf.subarray(0, 6)).toString('ascii');
      const match = hdr === 'GIF87a' || hdr === 'GIF89a';
      return match ? {ok: true} : {ok: false, error: 'File content does not match GIF87a/GIF89a header.'};
    }
    case 'webp': {
      const riff = Buffer.from(buf.subarray(0, 4)).toString('ascii');
      const webp = Buffer.from(buf.subarray(8, 12)).toString('ascii');
      return riff === 'RIFF' && webp === 'WEBP'
        ? {ok: true}
        : {ok: false, error: 'File content does not match RIFF/WEBP header.'};
    }
    case 'avif': {
      const box = Buffer.from(buf.subarray(4, 12)).toString('ascii');
      return box === 'ftypavif' || box === 'ftypavis' || box === 'ftypmif1'
        ? {ok: true}
        : {ok: false, error: 'File content does not match AVIF ISO BMFF header.'};
    }
    case 'mp4': {
      const box = Buffer.from(buf.subarray(4, 8)).toString('ascii');
      return box === 'ftyp'
        ? {ok: true}
        : {ok: false, error: 'File content does not match MP4 ftyp header.'};
    }
    case 'webm': {
      const match = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
      return match ? {ok: true} : {ok: false, error: 'File content does not match WebM EBML header.'};
    }
  }
}

export function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(dirPath)) {
    try {
      const st = fs.statSync(path.join(dirPath, name));
      if (st.isFile()) total += st.size;
    } catch {
      // ignore
    }
  }
  return total;
}

// ==========================================
// Zod Request Validation Schemas
// ==========================================

const WidgetSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.enum([
    'entity_number',
    'entity_list',
    'clock',
    'cpu_load',
    'memory_bar',
    'array_status',
    'docker_list',
    'active_tasks',
    'active_users',
    'disk_thermals',
    'ha_entity',
    'apex_area',
    'apex_radial',
    'apex_bar',
    'apex_hbar',
    'apex_custom',
    'custom_html',
    'image_layer',
    'custom_text',
    'divider',
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
  title: z.string().max(120),
  accentColor: z.string().max(32),
  textColor: z.string().max(32),
  bgColor: z.string().max(32),
  bgOpacity: z.number().min(0).max(1),
  borderOpacity: z.number().min(0).max(1),
  fontScale: z.number().min(0.4).max(4),
}).passthrough();

const LcdScreenSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  enabled: z.boolean(),
  durationSec: z.number().min(1).max(3600),
  transition: z.enum(['cut', 'fade', 'slide']),
  backgroundType: z.enum(['solid', 'image']),
  backgroundColor: z.string().max(32),
  backgroundImage: z.string().max(2048).optional(),
  backgroundDim: z.number().min(0).max(1),
  themeId: z.string().max(120).optional(),
  widgets: z.array(WidgetSchema).max(100),
}).passthrough();

export const ConfigPatchSchema = z.object({
  screens: z.array(LcdScreenSchema).min(1).max(32).optional(),
  savedScreens: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().min(1).max(120),
        savedAt: z.string(),
        screen: LcdScreenSchema,
      })
    )
    .max(64)
    .optional(),
  activeScreenId: z.string().min(1).max(120).optional(),
  rotationEnabled: z.boolean().optional(),
  hardware: z
    .object({
      devicePath: z.string().max(260).optional(),
      baudRate: z.number().int().min(9600).max(4_000_000).optional(),
      brightness: z.number().min(1).max(100).optional(),
      rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
      autoPushEnabled: z.boolean().optional(),
      pushIntervalSec: z.number().min(1).max(3600).optional(),
      pollIntervalMs: z.number().min(500).max(60_000).optional(),
      sleepScheduleEnabled: z.boolean().optional(),
      sleepStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      sleepEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      sleepMode: z.enum(['off', 'dim']).optional(),
      sleepDimPercent: z.number().min(1).max(100).optional(),
      bootDisplayOff: z.boolean().optional(),
      powerOffOnEmergencyStop: z.boolean().optional(),
      serialWritesEnabled: z.boolean().optional(),
    })
    .optional(),
  integrations: z
    .object({
      sourceMode: z.enum(['auto', 'simulation', 'local', 'agent']).optional(),
      agentEnabled: z.boolean().optional(),
      agentUrl: z.string().max(1024).optional(),
      agentToken: z.string().max(2048).optional(),
      clearAgentToken: z.boolean().optional(),
      haEnabled: z.boolean().optional(),
      haUrl: z.string().max(1024).optional(),
      haToken: z.string().max(2048).optional(),
      clearHaToken: z.boolean().optional(),
      customConnections: z
        .array(
          z.object({
            id: z.string().min(1).max(120),
            name: z.string().min(1).max(120),
            type: z.enum(['http_json', 'prometheus_text', 'unraid_agent']),
            url: z.string().max(1024),
            token: z.string().max(2048).optional(),
            tokenSet: z.boolean().optional(),
            jsonPath: z.string().max(256).optional(),
            unit: z.string().max(32).optional(),
            enabled: z.boolean(),
            lastValue: z.string().optional(),
            lastError: z.string().optional(),
          })
        )
        .max(32)
        .optional(),
    })
    .passthrough()
    .optional(),
  entityOverrides: z
    .record(
      z.string().max(120),
      z.object({
        tag: z.string().max(120).optional(),
        unit: z.string().max(32).optional(),
        enabled: z.boolean().optional(),
      })
    )
    .optional(),
  dockerIcons: z.record(z.string().max(120), z.string().max(2048)).optional(),
  customImages: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        name: z.string().max(120),
        url: z.string().max(1024),
        mediaType: z.enum(['image', 'video']).optional(),
        createdAt: z.string(),
      })
    )
    .max(200)
    .optional(),
  hardwareDeploy: z
    .object({
      deployed: z.boolean().optional(),
      deployedAt: z.string().nullable().optional(),
      activeIndex: z.number().int().min(0).optional(),
      currentScreenId: z.string().nullable().optional(),
      currentScreenName: z.string().nullable().optional(),
      isSleeping: z.boolean().optional(),
      effectiveBrightness: z.number().optional(),
      daemonState: z.string().optional(),
      lastError: z.string().nullable().optional(),
      screens: z.array(LcdScreenSchema).max(32).optional(),
    })
    .passthrough()
    .optional(),
}).strict();

export const UploadInitSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mimeType: z.string().max(120).optional(),
});

export const UploadDataUrlSchema = z.object({
  name: z.string().max(200).optional(),
  dataUrl: z.string().min(16).max(36 * 1024 * 1024),
});

export const TestAgentSchema = z.object({
  agentUrl: z.string().min(1).max(1024),
  agentToken: z.string().max(2048).optional(),
});

export const TestHaSchema = z.object({
  haUrl: z.string().min(1).max(1024),
  haToken: z.string().max(2048).optional(),
});

export const DeployRequestSchema = z.object({
  screens: z.array(LcdScreenSchema).min(1).max(32).optional(),
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional(),
  activeScreenId: z.string().max(120).optional(),
});

export const PushFrameRequestSchema = z.object({
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional(),
  screenId: z.string().max(120).optional(),
  screenName: z.string().max(120).optional(),
});

export const SafeTestRequestSchema = z.object({
  confirmed: z.literal(true),
  mode: z.enum(['display-on', 'test-frame']).default('test-frame'),
  rgbaBase64: z.string().max(4 * 1024 * 1024).optional(),
});

export const TaskTriggerSchema = z.object({
  taskId: z.string().min(1).max(120),
  action: z.enum(['start', 'stop']),
});

export const AuthSessionSchema = z.object({
  token: z.string().min(1).max(512),
});

export const SerialWritesToggleSchema = z.object({
  enabled: z.boolean(),
  confirmed: z.boolean().optional(),
});
