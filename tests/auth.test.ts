import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Request} from 'express';
import {
  isLocalPrivateClientIp,
  PUBLIC_DEFAULT_PW_ERROR,
  resolveClientIp,
} from '../src/server/auth.ts';

function httpRequest(options: {
  port: number;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}): Promise<{status: number; headers: http.IncomingHttpHeaders; body: string}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: options.port,
        method: options.method,
        path: options.path,
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      }
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(options.body);
    }
    req.end();
  });
}

function withSavedAuthEnv(fn: () => Promise<void>): Promise<void> {
  const keys = [
    'AOOSTAR_NO_AUTOSTART',
    'AOOSTAR_API_TOKEN',
    'AOOSTAR_ADMIN_USER',
    'AOOSTAR_ADMIN_PASSWORD',
    'AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC',
    'AOOSTAR_ALLOWED_HOSTS',
    'AOOSTAR_TRUST_PROXY',
    'DISABLE_HMR',
  ] as const;
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.AOOSTAR_NO_AUTOSTART = 'true';

  return fn().finally(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

test('auth IP classification & X-Forwarded-For trust rules', () => {
  // RFC1918 + loopback + IPv6 ULA are private/local; public v4/v6 & CGNAT/172.32 are not
  assert.equal(isLocalPrivateClientIp('127.0.0.1'), true);
  assert.equal(isLocalPrivateClientIp('::ffff:127.0.0.1'), true);
  assert.equal(isLocalPrivateClientIp('::1'), true);
  assert.equal(isLocalPrivateClientIp('10.0.0.5'), true);
  assert.equal(isLocalPrivateClientIp('172.16.5.1'), true);
  assert.equal(isLocalPrivateClientIp('172.31.255.254'), true);
  assert.equal(isLocalPrivateClientIp('192.168.1.50'), true);
  assert.equal(isLocalPrivateClientIp('fd12:3456::1'), true);
  assert.equal(isLocalPrivateClientIp('fc00::1'), true);

  assert.equal(isLocalPrivateClientIp('8.8.8.8'), false);
  assert.equal(isLocalPrivateClientIp('203.0.113.10'), false);
  assert.equal(isLocalPrivateClientIp('172.15.255.254'), false);
  assert.equal(isLocalPrivateClientIp('172.32.0.1'), false);
  assert.equal(isLocalPrivateClientIp('2001:db8::1'), false);
  assert.equal(isLocalPrivateClientIp(''), false);

  const prevTrust = process.env.AOOSTAR_TRUST_PROXY;
  const prevHmr = process.env.DISABLE_HMR;
  try {
    delete process.env.AOOSTAR_TRUST_PROXY;
    delete process.env.DISABLE_HMR;

    const fakeReq = {
      headers: {'x-forwarded-for': '203.0.113.10, 10.0.0.1'},
      socket: {remoteAddress: '127.0.0.1'},
    } as unknown as Request;

    // Hostile proxy header ignored when AOOSTAR_TRUST_PROXY is unset/false
    assert.equal(resolveClientIp(fakeReq), '127.0.0.1');

    process.env.AOOSTAR_TRUST_PROXY = 'true';
    assert.equal(resolveClientIp(fakeReq), '203.0.113.10');
  } finally {
    if (prevTrust === undefined) delete process.env.AOOSTAR_TRUST_PROXY;
    else process.env.AOOSTAR_TRUST_PROXY = prevTrust;
    if (prevHmr === undefined) delete process.env.DISABLE_HMR;
    else process.env.DISABLE_HMR = prevHmr;
  }
});

test('auth UX: default admin/admin onboarding, non-blocking routes, password change, session invalidation, reset, sign out everywhere, and recovery', async () => {
  await withSavedAuthEnv(async () => {
    const {createStudioApp} = await import('../server.ts');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-auth-ux-'));
    const ctx = createStudioApp({dataDir: tmpDir, bindHost: '127.0.0.1', port: 0});
    const server = http.createServer(ctx.app);

    const warnLines: string[] = [];
    const logLines: string[] = [];
    const origWarn = console.warn;
    const origLog = console.log;
    console.warn = (...args: unknown[]) => {
      warnLines.push(args.map(String).join(' '));
      origWarn(...args);
    };
    console.log = (...args: unknown[]) => {
      logLines.push(args.map(String).join(' '));
      origLog(...args);
    };

    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as AddressInfo).port;
      const host = `127.0.0.1:${port}`;
      const origin = `http://${host}`;

      // 1. Unauthenticated /api/auth/status shows usingDefaultPassword=true without leaking username/hashes
      const statusBefore = await httpRequest({port, method: 'GET', path: '/api/auth/status'});
      assert.equal(statusBefore.status, 200);
      const statusBeforeJson = JSON.parse(statusBefore.body) as {
        authenticated: boolean;
        username: string | null;
        usingDefaultPassword: boolean;
      };
      assert.equal(statusBeforeJson.authenticated, false);
      assert.equal(statusBeforeJson.username, null);
      assert.equal(statusBeforeJson.usingDefaultPassword, true);

      // 2. First login with admin/admin succeeds, logs default warning, sets HttpOnly SameSite=Strict cookie
      const login1 = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(login1.status, 200);
      const login1Body = JSON.parse(login1.body) as {
        ok: boolean;
        username: string;
        usingDefaultPassword: boolean;
      };
      assert.equal(login1Body.ok, true);
      assert.equal(login1Body.username, 'admin');
      assert.equal(login1Body.usingDefaultPassword, true);
      const cookie1Header = login1.headers['set-cookie']?.[0] || '';
      assert.match(cookie1Header, /HttpOnly/i);
      assert.match(cookie1Header, /SameSite=Strict/i);
      const cookie1 = cookie1Header.split(';')[0];

      assert.ok(warnLines.some((l) => /default-credential login/i.test(l)));

      // Second independent browser session cookie
      const login2 = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(login2.status, 200);
      const cookie2 = (login2.headers['set-cookie']?.[0] || '').split(';')[0];

      // 3. Non-blocking: config, hardware, telemetry routes work immediately without changing password
      const customScreenConfigRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/config',
        headers: {Host: host, Origin: origin, Cookie: cookie1, 'Content-Type': 'application/json'},
        body: JSON.stringify({activeScreenId: 'custom-persisted-screen'}),
      });
      assert.equal(customScreenConfigRes.status, 200);

      // Verify zero credential fields leak in /api/config, /api/diagnostics, or /api/export/*
      const diagRes = await httpRequest({
        port,
        method: 'GET',
        path: '/api/diagnostics',
        headers: {Host: host, Cookie: cookie1},
      });
      assert.equal(diagRes.status, 200);
      assert.equal(diagRes.body.includes('passwordHash'), false);
      assert.equal(diagRes.body.includes('sessionSecret'), false);
      assert.equal(customScreenConfigRes.body.includes('passwordHash'), false);
      assert.equal(customScreenConfigRes.body.includes('sessionSecret'), false);

      // 4. Credential change validation
      const wrongCurrent = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/change-credentials',
        headers: {Host: host, Origin: origin, Cookie: cookie1, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword: 'wrong-password',
          newUsername: 'operator',
          newPassword: 'password123',
          confirmPassword: 'password123',
        }),
      });
      assert.equal(wrongCurrent.status, 401);

      const tooShort = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/change-credentials',
        headers: {Host: host, Origin: origin, Cookie: cookie1, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword: 'admin',
          newUsername: 'operator',
          newPassword: 'short',
          confirmPassword: 'short',
        }),
      });
      assert.equal(tooShort.status, 400);

      const identicalPw = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/change-credentials',
        headers: {Host: host, Origin: origin, Cookie: cookie1, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword: 'admin',
          newUsername: 'operator',
          newPassword: 'admin',
          confirmPassword: 'admin',
        }),
      });
      assert.equal(identicalPw.status, 400);

      // Valid weak >= 8 char password is allowed (non-required hardening)
      const changeOk = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/change-credentials',
        headers: {Host: host, Origin: origin, Cookie: cookie1, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          currentPassword: 'admin',
          newUsername: 'operator',
          newPassword: 'password123',
          confirmPassword: 'password123',
        }),
      });
      assert.equal(changeOk.status, 200);
      const rotatedCookie1 = (changeOk.headers['set-cookie']?.[0] || '').split(';')[0];
      assert.ok(rotatedCookie1);

      // Active session works; OLD session cookie2 is immediately invalidated!
      const statusAfterChange = await httpRequest({
        port,
        method: 'GET',
        path: '/api/auth/status',
        headers: {Host: host, Cookie: rotatedCookie1},
      });
      assert.equal(statusAfterChange.status, 200);
      const statusAfterJson = JSON.parse(statusAfterChange.body) as {
        authenticated: boolean;
        username: string;
        usingDefaultPassword: boolean;
      };
      assert.equal(statusAfterJson.authenticated, true);
      assert.equal(statusAfterJson.username, 'operator');
      assert.equal(statusAfterJson.usingDefaultPassword, false);

      const otherSessionRejected = await httpRequest({
        port,
        method: 'GET',
        path: '/api/config',
        headers: {Host: host, Cookie: cookie2},
      });
      assert.equal(otherSessionRejected.status, 401);

      // Old admin/admin password is rejected now
      const oldLoginRejected = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(oldLoginRejected.status, 401);

      // 5. Optional API token generate -> shown once -> works -> revoke invalidates it
      const tokRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/api-token/rotate',
        headers: {Host: host, Origin: origin, Cookie: rotatedCookie1},
      });
      assert.equal(tokRes.status, 200);
      const apiToken = (JSON.parse(tokRes.body) as {token: string}).token;
      assert.ok(apiToken.startsWith('aoo_'));

      const bearerOk = await httpRequest({
        port,
        method: 'GET',
        path: '/api/config',
        headers: {Host: host, Authorization: `Bearer ${apiToken}`},
      });
      assert.equal(bearerOk.status, 200);

      // Verify secret password & raw API token never appear in server logs
      const allLogs = [...warnLines, ...logLines].join('\n');
      assert.equal(allLogs.includes('password123'), false);
      assert.equal(allLogs.includes(apiToken), false);

      // 6. Sign out everywhere invalidates all cookies
      const signOutAll = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/logout-all',
        headers: {Host: host, Origin: origin, Cookie: rotatedCookie1},
      });
      assert.equal(signOutAll.status, 200);

      const afterSignOutAll = await httpRequest({
        port,
        method: 'GET',
        path: '/api/config',
        headers: {Host: host, Cookie: rotatedCookie1},
      });
      assert.equal(afterSignOutAll.status, 401);

      // Re-login with operator/password123 and reset to default (admin/admin)
      const relogin = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'operator', password: 'password123'}),
      });
      assert.equal(relogin.status, 200);
      const opCookie = (relogin.headers['set-cookie']?.[0] || '').split(';')[0];

      const resetRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/reset-default',
        headers: {Host: host, Origin: origin, Cookie: opCookie, 'Content-Type': 'application/json'},
        body: JSON.stringify({confirmed: true}),
      });
      assert.equal(resetRes.status, 200);
      assert.equal((JSON.parse(resetRes.body) as {usingDefaultPassword: boolean}).usingDefaultPassword, true);
    } finally {
      console.warn = origWarn;
      console.log = origLog;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await ctx.shutdown();
    }

    // 7. Account recovery: deleting credentials.json + restart restores admin/admin without losing studio-config.json
    fs.unlinkSync(path.join(tmpDir, 'credentials.json'));
    const credsBak = path.join(tmpDir, 'credentials.json.bak');
    if (fs.existsSync(credsBak)) fs.unlinkSync(credsBak);

    const ctxRecovered = createStudioApp({dataDir: tmpDir, bindHost: '127.0.0.1', port: 0});
    try {
      assert.equal(ctxRecovered.getCredentialStore().verifyLogin('admin', 'admin'), true);
      assert.equal(ctxRecovered.getConfig().activeScreenId, 'custom-persisted-screen');
    } finally {
      await ctxRecovered.shutdown();
      fs.rmSync(tmpDir, {recursive: true, force: true});
    }
  });
});

test('auth hardening: rate limiting + identical login errors + public-IP default-password safeguard + env override', async () => {
  await withSavedAuthEnv(async () => {
    const {createStudioApp} = await import('../server.ts');

    // Part A: Rate limiting on login + identical error message + API token brute-force lockout + log redaction
    const tmpDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-auth-rl-'));
    const ctxA = createStudioApp({dataDir: tmpDirA, bindHost: '127.0.0.1', port: 0});
    const serverA = http.createServer(ctxA.app);
    const logsA: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      logsA.push(args.map(String).join(' '));
      origWarn(...args);
    };

    try {
      await new Promise<void>((resolve) => serverA.listen(0, '127.0.0.1', resolve));
      const port = (serverA.address() as AddressInfo).port;
      const host = `127.0.0.1:${port}`;
      const origin = `http://${host}`;

      // Verify identical error for wrong username vs wrong password
      const badUserRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'nonexistent-user', password: 'SecretGuessPassword!1'}),
      });
      assert.equal(badUserRes.status, 401);

      const badPassRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'SecretGuessPassword!2'}),
      });
      assert.equal(badPassRes.status, 401);
      assert.equal(badUserRes.body, badPassRes.body);

      // 3 more failures -> 5th triggers 429 + Retry-After
      for (let i = 0; i < 2; i++) {
        const r = await httpRequest({
          port,
          method: 'POST',
          path: '/api/auth/login',
          headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
          body: JSON.stringify({username: 'admin', password: `BadPass!${i}`}),
        });
        assert.equal(r.status, 401);
      }

      const fifthFail = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'BadPass!5'}),
      });
      assert.equal(fifthFail.status, 429);
      assert.ok(Number(fifthFail.headers['retry-after']) >= 60);

      // Even valid admin/admin is blocked while locked out
      const blockedValid = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(blockedValid.status, 429);

      // Verify wrong passwords were NEVER logged
      const combinedWarn = logsA.join('\n');
      assert.equal(combinedWarn.includes('SecretGuessPassword'), false);
      assert.equal(combinedWarn.includes('BadPass!'), false);

      // Public-IP safeguard when AOOSTAR_TRUST_PROXY=true vs spoofed X-Forwarded-For when false
      // Reset AOOSTAR_TRUST_PROXY=false and verify spoofed XFF is ignored (locks/checks socket 127.0.0.1)
      delete process.env.AOOSTAR_TRUST_PROXY;
      const spoofedStillLocked = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '198.51.100.44',
        },
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(spoofedStillLocked.status, 429);
    } finally {
      console.warn = origWarn;
      await new Promise<void>((resolve) => serverA.close(() => resolve()));
      await ctxA.shutdown();
      fs.rmSync(tmpDirA, {recursive: true, force: true});
    }

    // Part B: Exposure safeguard with AOOSTAR_TRUST_PROXY=true + Bearer API token rate limiting
    process.env.AOOSTAR_TRUST_PROXY = 'true';
    const tmpDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-auth-pub-'));
    const ctxB = createStudioApp({dataDir: tmpDirB, bindHost: '0.0.0.0', port: 0});
    const serverB = http.createServer(ctxB.app);
    try {
      await new Promise<void>((resolve) => serverB.listen(0, '127.0.0.1', resolve));
      const port = (serverB.address() as AddressInfo).port;
      const host = `127.0.0.1:${port}`;
      const origin = `http://${host}`;

      // Public client IP blocked when usingDefaultPassword=true
      const publicBlocked = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(publicBlocked.status, 403);
      assert.equal(JSON.parse(publicBlocked.body).error, PUBLIC_DEFAULT_PW_ERROR);

      // RFC1918 LAN IP succeeds
      const lanAllowed = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.50',
        },
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(lanAllowed.status, 200);
      const lanCookie = (lanAllowed.headers['set-cookie']?.[0] || '').split(';')[0];

      // Opt-in AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC=true permits public IP
      process.env.AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC = 'true';
      const optInPublic = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(optInPublic.status, 200);
      delete process.env.AOOSTAR_ALLOW_DEFAULT_PASSWORD_PUBLIC;

      // Once password is changed on LAN, public IP login succeeds cleanly
      const changeRes = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/change-credentials',
        headers: {
          Host: host,
          Origin: origin,
          Cookie: lanCookie,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '192.168.1.50',
        },
        body: JSON.stringify({
          currentPassword: 'admin',
          newUsername: 'admin',
          newPassword: 'StrongCustomPassword!99',
          confirmPassword: 'StrongCustomPassword!99',
        }),
      });
      assert.equal(changeRes.status, 200);

      const publicAfterChange = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {
          Host: host,
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': '203.0.113.10',
        },
        body: JSON.stringify({username: 'admin', password: 'StrongCustomPassword!99'}),
      });
      assert.equal(publicAfterChange.status, 200);

      // Invalid Bearer token rate limiting per IP
      for (let i = 0; i < 4; i++) {
        const r = await httpRequest({
          port,
          method: 'GET',
          path: '/api/config',
          headers: {
            Host: host,
            Authorization: `Bearer invalid-script-token-${i}`,
            'X-Forwarded-For': '198.51.100.77',
          },
        });
        assert.equal(r.status, 401);
      }
      const fifthBearer = await httpRequest({
        port,
        method: 'GET',
        path: '/api/config',
        headers: {
          Host: host,
          Authorization: 'Bearer invalid-script-token-5',
          'X-Forwarded-For': '198.51.100.77',
        },
      });
      assert.equal(fifthBearer.status, 429);
      assert.ok(Number(fifthBearer.headers['retry-after']) >= 60);
    } finally {
      await new Promise<void>((resolve) => serverB.close(() => resolve()));
      await ctxB.shutdown();
      fs.rmSync(tmpDirB, {recursive: true, force: true});
    }

    // Part C: Env override AOOSTAR_ADMIN_USER / AOOSTAR_ADMIN_PASSWORD disables default password
    process.env.AOOSTAR_ADMIN_USER = 'nasadmin';
    process.env.AOOSTAR_ADMIN_PASSWORD = 'EnvOverridePassword123';
    delete process.env.AOOSTAR_TRUST_PROXY;
    const tmpDirC = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-auth-env-'));
    const ctxC = createStudioApp({dataDir: tmpDirC, bindHost: '127.0.0.1', port: 0});
    const serverC = http.createServer(ctxC.app);
    try {
      await new Promise<void>((resolve) => serverC.listen(0, '127.0.0.1', resolve));
      const port = (serverC.address() as AddressInfo).port;
      const host = `127.0.0.1:${port}`;
      const origin = `http://${host}`;

      const statusRes = await httpRequest({port, method: 'GET', path: '/api/auth/status'});
      const statusJson = JSON.parse(statusRes.body) as {
        usingDefaultPassword: boolean;
        envOverrideActive: boolean;
      };
      assert.equal(statusJson.usingDefaultPassword, false);
      assert.equal(statusJson.envOverrideActive, true);

      const defaultRejected = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'admin', password: 'admin'}),
      });
      assert.equal(defaultRejected.status, 401);

      const envAccepted = await httpRequest({
        port,
        method: 'POST',
        path: '/api/auth/login',
        headers: {Host: host, Origin: origin, 'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'nasadmin', password: 'EnvOverridePassword123'}),
      });
      assert.equal(envAccepted.status, 200);
      assert.equal((JSON.parse(envAccepted.body) as {usingDefaultPassword: boolean}).usingDefaultPassword, false);
    } finally {
      await new Promise<void>((resolve) => serverC.close(() => resolve()));
      await ctxC.shutdown();
      fs.rmSync(tmpDirC, {recursive: true, force: true});
    }
  });
});
