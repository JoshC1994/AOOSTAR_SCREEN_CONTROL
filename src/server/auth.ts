import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type {Request, Response} from 'express';
import {z} from 'zod';
import {readJsonWithBackupFallback, safeTokenEqual, writeFileAtomic0600} from './security.ts';

export const DEFAULT_ADMIN_USERNAME = 'admin';
export const DEFAULT_ADMIN_PASSWORD = 'admin';
export const CREDENTIALS_FILENAME = 'credentials.json';
export const PUBLIC_DEFAULT_PW_ERROR =
  'Change the default password to allow access from outside your local network.';

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = {N: 16384, r: 8, p: 1};

export interface StoredCredentialsFile {
  version: 1;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  usingDefaultPassword: boolean;
  sessionSecret: string;
  apiTokenSalt?: string | null;
  apiTokenHash?: string | null;
  apiTokenPrefix?: string | null;
  apiTokenCreatedAt?: string | null;
  updatedAt: string;
}

export function hashSecretScrypt(secret: string, saltHex?: string): {salt: string; hash: string} {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(secret, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return {salt, hash: derived.toString('hex')};
}

export function verifySecretScrypt(provided: string, salt: string, expectedHashHex: string): boolean {
  if (!provided || !salt || !expectedHashHex) return false;
  try {
    const expectedBuf = Buffer.from(expectedHashHex, 'hex');
    if (expectedBuf.length !== SCRYPT_KEYLEN) return false;
    const derived = crypto.scryptSync(provided, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
    if (derived.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(derived, expectedBuf);
  } catch {
    return false;
  }
}

export function isTrustedProxyEnabled(): boolean {
  return process.env.AOOSTAR_TRUST_PROXY === 'true' || process.env.DISABLE_HMR === 'true';
}

export function normalizeIp(rawIp: string | undefined | null): string {
  if (!rawIp || typeof rawIp !== 'string') return '';
  let ip = rawIp.trim();
  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1) ip = ip.slice(0, zoneIdx);
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  return ip;
}

/**
 * Resolves the effective client IP.
 * Strictly ignores X-Forwarded-For unless AOOSTAR_TRUST_PROXY=true (or preview DISABLE_HMR=true),
 * preventing spoofed header bypasses of rate limits and default-password exposure rules.
 */
export function resolveClientIp(req: Request): string {
  const socketIp = normalizeIp(req.socket?.remoteAddress);
  if (isTrustedProxyEnabled()) {
    const xff = req.headers['x-forwarded-for'];
    const rawList = typeof xff === 'string' ? xff : Array.isArray(xff) ? xff[0] : '';
    if (rawList) {
      for (const part of rawList.split(',')) {
        const candidate = normalizeIp(part);
        if (candidate && net.isIP(candidate) !== 0) {
          return candidate;
        }
      }
    }
  }
  return socketIp || 'unknown';
}

/**
 * Allows ONLY RFC1918 (10/8, 172.16/12, 192.168/16), IPv4 loopback (127/8),
 * IPv6 loopback (::1), and IPv6 ULA (fc00::/7).
 */
export function isLocalPrivateClientIp(rawIp: string): boolean {
  const ip = normalizeIp(rawIp).toLowerCase();
  if (!ip) return false;

  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    if (p[0] === 127) return true; // 127.0.0.0/8
    if (p[0] === 10) return true; // 10.0.0.0/8
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16.0.0/12
    if (p[0] === 192 && p[1] === 168) return true; // 192.168.0.0/16
    return false;
  }

  if (net.isIPv6(ip)) {
    if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true;
    const firstHextet = ip.split(':')[0] || '';
    if (firstHextet.length >= 2) {
      const firstByte = Number.parseInt(firstHextet.padStart(4, '0').slice(0, 2), 16);
      if (Number.isFinite(firstByte) && (firstByte & 0xfe) === 0xfc) {
        return true; // fc00::/7
      }
    }
    return false;
  }

  return false;
}

interface RateLimitBucket {
  failures: number[];
  lockedUntilMs: number;
  lockoutLevel: number;
}

const RATE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES_IN_WINDOW = 5;
const ESCALATION_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];

export class AuthRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  check(ip: string, nowMs = Date.now()): {allowed: boolean; retryAfterSec: number; failureCount: number} {
    const key = ip || 'unknown';
    const b = this.buckets.get(key);
    if (!b) return {allowed: true, retryAfterSec: 0, failureCount: 0};

    if (b.lockedUntilMs > nowMs) {
      const retryAfterSec = Math.max(1, Math.ceil((b.lockedUntilMs - nowMs) / 1000));
      return {allowed: false, retryAfterSec, failureCount: b.failures.length};
    }

    // Prune expired failures outside the 5-minute window
    b.failures = b.failures.filter((t) => nowMs - t <= RATE_WINDOW_MS);
    if (b.failures.length === 0 && b.lockedUntilMs <= nowMs) {
      this.buckets.delete(key);
      return {allowed: true, retryAfterSec: 0, failureCount: 0};
    }
    return {allowed: true, retryAfterSec: 0, failureCount: b.failures.length};
  }

  recordFailure(
    ip: string,
    kind: 'login' | 'api-token',
    nowMs = Date.now()
  ): {locked: boolean; retryAfterSec: number; attemptsInWindow: number} {
    const key = ip || 'unknown';
    const existing = this.buckets.get(key) ?? {failures: [], lockedUntilMs: 0, lockoutLevel: 0};
    existing.failures = existing.failures.filter((t) => nowMs - t <= RATE_WINDOW_MS);
    existing.failures.push(nowMs);

    let locked = false;
    let retryAfterSec = 0;
    if (existing.failures.length >= MAX_FAILURES_IN_WINDOW) {
      const durationMs =
        ESCALATION_MS[Math.min(ESCALATION_MS.length - 1, existing.lockoutLevel)];
      existing.lockedUntilMs = nowMs + durationMs;
      existing.lockoutLevel += 1;
      existing.failures = [];
      locked = true;
      retryAfterSec = Math.ceil(durationMs / 1000);
    }

    this.buckets.set(key, existing);

    // Log failure without ever logging passwords, usernames, or raw tokens
    const label = kind === 'login' ? 'login' : 'API token';
    if (locked) {
      console.warn(
        `[aoostar-auth] Locked out IP ${key} for ${retryAfterSec}s after repeated failed ${label} attempts`
      );
    } else {
      console.warn(
        `[aoostar-auth] Failed ${label} attempt from ${key} (${existing.failures.length}/${MAX_FAILURES_IN_WINDOW} in 5m window)`
      );
    }

    return {locked, retryAfterSec, attemptsInWindow: existing.failures.length};
  }

  recordSuccess(ip: string): void {
    this.buckets.delete(ip || 'unknown');
  }

  async applyFailureDelay(attemptsInWindow: number): Promise<void> {
    const delayMs = Math.min(400, Math.max(40, attemptsInWindow * 60));
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

export interface CredentialStore {
  credentialsPath: string;
  isEnvOverrideActive(): boolean;
  isUsingDefaultPassword(): boolean;
  getEffectiveUsername(): string;
  getSessionSecret(): string;
  hasStoredApiToken(): boolean;
  getApiTokenMeta(): {configured: boolean; prefix: string | null; createdAt: string | null};
  verifyLogin(username: string, password: string): boolean;
  verifyApiToken(providedToken: string): boolean;
  changeCredentials(params: {
    currentPassword: string;
    newUsername?: string;
    newPassword: string;
  }): {username: string; sessionSecret: string};
  resetToDefault(): {username: string; sessionSecret: string};
  rotateSessionSecret(): string;
  rotateApiToken(): {token: string; prefix: string; createdAt: string; sessionSecret: string};
  revokeApiToken(): void;
}

function buildDefaultCredentialsRecord(existingSessionSecret?: string): StoredCredentialsFile {
  const {salt, hash} = hashSecretScrypt(DEFAULT_ADMIN_PASSWORD);
  return {
    version: 1,
    username: DEFAULT_ADMIN_USERNAME,
    passwordSalt: salt,
    passwordHash: hash,
    usingDefaultPassword: true,
    sessionSecret: existingSessionSecret || crypto.randomBytes(32).toString('hex'),
    apiTokenSalt: null,
    apiTokenHash: null,
    apiTokenPrefix: null,
    apiTokenCreatedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

export function createCredentialStore(dataDir: string): CredentialStore {
  const credentialsPath = path.join(dataDir, CREDENTIALS_FILENAME);
  const loaded = readJsonWithBackupFallback<StoredCredentialsFile>(credentialsPath);

  let record: StoredCredentialsFile;
  if (
    loaded.data &&
    loaded.data.version === 1 &&
    typeof loaded.data.username === 'string' &&
    typeof loaded.data.passwordSalt === 'string' &&
    typeof loaded.data.passwordHash === 'string' &&
    typeof loaded.data.sessionSecret === 'string'
  ) {
    record = loaded.data;
    try {
      fs.chmodSync(credentialsPath, 0o600);
    } catch {
      // ignore chmod errors
    }
    if (loaded.recoveredFromBackup) {
      writeFileAtomic0600(credentialsPath, JSON.stringify(record, null, 2), false);
    }
  } else {
    record = buildDefaultCredentialsRecord();
    writeFileAtomic0600(credentialsPath, JSON.stringify(record, null, 2), false);
    console.log(`[aoostar-auth] Initialized default credentials (mode 0600) at ${credentialsPath}`);
  }

  function saveRecord(next: StoredCredentialsFile) {
    record = next;
    writeFileAtomic0600(credentialsPath, JSON.stringify(next, null, 2), true);
  }

  function getEnvOverride(): {active: boolean; username: string; password: string | null} {
    const envUser = (process.env.AOOSTAR_ADMIN_USER || '').trim();
    const envPass = process.env.AOOSTAR_ADMIN_PASSWORD ?? '';
    if (envPass !== '') {
      return {
        active: true,
        username: envUser || DEFAULT_ADMIN_USERNAME,
        password: envPass,
      };
    }
    return {active: false, username: envUser || record.username, password: null};
  }

  // Startup warning if default credentials are active
  const initialOverride = getEnvOverride();
  if (initialOverride.active) {
    console.log(
      `[aoostar-auth] Environment admin override active (user="${initialOverride.username}"); default password disabled.`
    );
  } else if (record.usingDefaultPassword) {
    console.warn(
      '[aoostar-auth] WARNING: Using default login credentials (admin/admin). Change the password in Settings > Security.'
    );
  }

  return {
    credentialsPath,

    isEnvOverrideActive(): boolean {
      return getEnvOverride().active;
    },

    isUsingDefaultPassword(): boolean {
      if (getEnvOverride().active) return false;
      return Boolean(record.usingDefaultPassword);
    },

    getEffectiveUsername(): string {
      const ov = getEnvOverride();
      if (ov.active) return ov.username;
      return (process.env.AOOSTAR_ADMIN_USER || '').trim() || record.username;
    },

    getSessionSecret(): string {
      return record.sessionSecret;
    },

    hasStoredApiToken(): boolean {
      return Boolean(record.apiTokenSalt && record.apiTokenHash);
    },

    getApiTokenMeta() {
      return {
        configured: Boolean(record.apiTokenSalt && record.apiTokenHash),
        prefix: record.apiTokenPrefix ?? null,
        createdAt: record.apiTokenCreatedAt ?? null,
      };
    },

    verifyLogin(username: string, password: string): boolean {
      const cleanUser = (username || '').trim();
      const ov = getEnvOverride();
      if (ov.active && ov.password !== null) {
        const userOk = safeTokenEqual(ov.username, cleanUser);
        const passOk = safeTokenEqual(ov.password, password);
        return userOk && passOk;
      }

      const expectedUser = this.getEffectiveUsername();
      const userOk = safeTokenEqual(expectedUser, cleanUser);
      // Always perform scrypt verification so response timing does not leak username existence
      const passOk = verifySecretScrypt(password, record.passwordSalt, record.passwordHash);
      return userOk && passOk;
    },

    verifyApiToken(providedToken: string): boolean {
      const clean = (providedToken || '').trim();
      if (!clean) return false;
      const envApiToken = (process.env.AOOSTAR_API_TOKEN || '').trim();
      if (envApiToken && safeTokenEqual(envApiToken, clean)) {
        return true;
      }
      if (record.apiTokenSalt && record.apiTokenHash) {
        return verifySecretScrypt(clean, record.apiTokenSalt, record.apiTokenHash);
      }
      return false;
    },

    changeCredentials(params) {
      if (getEnvOverride().active) {
        throw new Error(
          'Credentials are overridden by AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD environment variables.'
        );
      }
      if (!verifySecretScrypt(params.currentPassword, record.passwordSalt, record.passwordHash)) {
        throw new Error('Current password is incorrect.');
      }
      if (params.newPassword === params.currentPassword) {
        throw new Error('New password must be different from your current password.');
      }
      const nextUsername = (params.newUsername || '').trim() || record.username;
      const {salt, hash} = hashSecretScrypt(params.newPassword);
      const nextSecret = crypto.randomBytes(32).toString('hex');
      saveRecord({
        ...record,
        username: nextUsername,
        passwordSalt: salt,
        passwordHash: hash,
        usingDefaultPassword: false,
        sessionSecret: nextSecret,
        updatedAt: new Date().toISOString(),
      });
      console.log(`[aoostar-auth] Credentials updated for "${nextUsername}"; existing sessions invalidated.`);
      return {username: nextUsername, sessionSecret: nextSecret};
    },

    resetToDefault() {
      if (getEnvOverride().active) {
        throw new Error(
          'Credentials are overridden by AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD environment variables.'
        );
      }
      const nextSecret = crypto.randomBytes(32).toString('hex');
      const next = {
        ...buildDefaultCredentialsRecord(nextSecret),
        apiTokenSalt: record.apiTokenSalt ?? null,
        apiTokenHash: record.apiTokenHash ?? null,
        apiTokenPrefix: record.apiTokenPrefix ?? null,
        apiTokenCreatedAt: record.apiTokenCreatedAt ?? null,
      };
      saveRecord(next);
      console.warn(
        '[aoostar-auth] Credentials reset to default (admin/admin); existing sessions invalidated.'
      );
      return {username: next.username, sessionSecret: next.sessionSecret};
    },

    rotateSessionSecret(): string {
      const nextSecret = crypto.randomBytes(32).toString('hex');
      saveRecord({
        ...record,
        sessionSecret: nextSecret,
        updatedAt: new Date().toISOString(),
      });
      console.log('[aoostar-auth] Session secret rotated; all active sessions signed out.');
      return nextSecret;
    },

    rotateApiToken() {
      const rawToken = `aoo_${crypto.randomBytes(28).toString('hex')}`;
      const prefix = `${rawToken.slice(0, 12)}...`;
      const createdAt = new Date().toISOString();
      const {salt, hash} = hashSecretScrypt(rawToken);
      saveRecord({
        ...record,
        apiTokenSalt: salt,
        apiTokenHash: hash,
        apiTokenPrefix: prefix,
        apiTokenCreatedAt: createdAt,
        updatedAt: createdAt,
      });
      console.log(`[aoostar-auth] Rotated script API token (${prefix}); stored salted hash only.`);
      return {
        token: rawToken,
        prefix,
        createdAt,
        sessionSecret: record.sessionSecret,
      };
    },

    revokeApiToken() {
      saveRecord({
        ...record,
        apiTokenSalt: null,
        apiTokenHash: null,
        apiTokenPrefix: null,
        apiTokenCreatedAt: null,
        updatedAt: new Date().toISOString(),
      });
      console.log('[aoostar-auth] Revoked stored script API token.');
    },
  };
}

export function isDefaultPasswordPublicBlocked(req: Request, store: CredentialStore): boolean {
  if (!store.isUsingDefaultPassword()) return false;
  if (process.env.AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC === 'true') return false;
  const clientIp = resolveClientIp(req);
  return !isLocalPrivateClientIp(clientIp);
}

export function buildSessionCookieHeader(
  req: Request,
  cookieValue: string,
  maxAgeSec = 7 * 24 * 60 * 60
): string {
  const isIframeHttps = process.env.DISABLE_HMR === 'true' && req.secure;
  const trustProxyHttps =
    isTrustedProxyEnabled() &&
    String(req.headers['x-forwarded-proto'] || '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https';
  const isSecure = Boolean(req.secure || trustProxyHttps || isIframeHttps);

  const parts = [
    `aoostar_session=${encodeURIComponent(cookieValue)}`,
    'Path=/',
    'HttpOnly',
    isIframeHttps ? 'SameSite=None' : 'SameSite=Strict',
    `Max-Age=${maxAgeSec}`,
  ];
  if (isSecure) parts.push('Secure');
  if (isIframeHttps) parts.push('Partitioned');
  return parts.join('; ');
}

export function buildClearSessionCookieHeader(req: Request): string {
  return buildSessionCookieHeader(req, '', 0);
}

export function sendSessionCookie(res: Response, req: Request, cookieValue: string): void {
  res.setHeader('Set-Cookie', buildSessionCookieHeader(req, cookieValue));
}

export function clearSessionCookie(res: Response, req: Request): void {
  res.setHeader('Set-Cookie', buildClearSessionCookieHeader(req));
}

export const LoginRequestSchema = z.object({
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

export const ChangeCredentialsSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.').max(256),
    newUsername: z.string().trim().min(1, 'Username cannot be empty.').max(64).optional(),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters.')
      .max(256),
    confirmPassword: z.string().min(1, 'Please confirm the new password.').max(256),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'New password and confirmation do not match.',
    path: ['confirmPassword'],
  });

export const ResetDefaultSchema = z.object({
  confirmed: z.literal(true),
});
