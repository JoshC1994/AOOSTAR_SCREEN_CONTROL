import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {AddressInfo} from 'node:net';
import {encodePngRgba} from '../src/server/aoostar/protocol.ts';

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

test('security suite: auth, host header, CSRF origin, secret masking, 0600 file perms, SSRF, and hardened uploads', async () => {
  const prevNoAutostart = process.env.AOOSTAR_NO_AUTOSTART;
  const prevApiToken = process.env.AOOSTAR_API_TOKEN;
  const prevAdminUser = process.env.AOOSTAR_ADMIN_USER;
  const prevAdminPassword = process.env.AOOSTAR_ADMIN_PASSWORD;
  const prevAllowedHosts = process.env.AOOSTAR_ALLOWED_HOSTS;
  const prevTrustProxy = process.env.AOOSTAR_TRUST_PROXY;
  const prevDisableHmr = process.env.DISABLE_HMR;

  process.env.AOOSTAR_NO_AUTOSTART = 'true';
  delete process.env.AOOSTAR_API_TOKEN;
  delete process.env.AOOSTAR_ADMIN_USER;
  delete process.env.AOOSTAR_ADMIN_PASSWORD;
  delete process.env.AOOSTAR_ALLOWED_HOSTS;
  delete process.env.AOOSTAR_TRUST_PROXY;
  delete process.env.DISABLE_HMR;

  const {createStudioApp} = await import('../server.ts');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-sec-'));
  const ctx = createStudioApp({dataDir: tmpDir, bindHost: '127.0.0.1', port: 0});
  const server = http.createServer(ctx.app);

  // Local probe server to prove SSRF never reaches 127.0.0.1
  let probeHits = 0;
  const probeServer = http.createServer((_req, res) => {
    probeHits += 1;
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({secret: 'LOCAL_INTERNAL_SECRET'}));
  });

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve));

    const port = (server.address() as AddressInfo).port;
    const probePort = (probeServer.address() as AddressInfo).port;

    // Verify generated credentials.json file permissions are 0600 and password is salted/hashed (not plaintext)
    const credsPath = path.join(tmpDir, 'credentials.json');
    const credsStat = fs.statSync(credsPath);
    assert.equal(credsStat.mode & 0o777, 0o600);
    const credsRaw = fs.readFileSync(credsPath, 'utf8');
    const credsJson = JSON.parse(credsRaw) as {
      username: string;
      passwordSalt: string;
      passwordHash: string;
      usingDefaultPassword: boolean;
    };
    assert.equal(credsJson.username, 'admin');
    assert.equal(credsJson.usingDefaultPassword, true);
    assert.notEqual(credsJson.passwordHash, 'admin');
    assert.equal(credsJson.passwordHash.length, 128);

    // 1. Public liveness route allowed without auth
    const infoRes = await httpRequest({port, method: 'GET', path: '/api/info'});
    assert.equal(infoRes.status, 200);
    const infoJson = JSON.parse(infoRes.body) as {name: string; version: string};
    assert.equal(infoJson.name, 'Aoostar Display Studio');

    // 2. Protected route rejects unauthenticated calls with 401
    const unauthRes = await httpRequest({port, method: 'GET', path: '/api/config'});
    assert.equal(unauthRes.status, 401);
    assert.equal((JSON.parse(unauthRes.body) as {authRequired?: boolean}).authRequired, true);

    // 3. DNS rebinding / untrusted Host header rejected with 403
    const badHostRes = await httpRequest({
      port,
      method: 'GET',
      path: '/api/info',
      headers: {Host: 'evil.example:3000'},
    });
    assert.equal(badHostRes.status, 403);

    // 4. Sign in with default admin/admin to obtain HttpOnly SameSite=Strict session cookie, then generate API token
    const loginRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/auth/login',
      headers: {Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({username: 'admin', password: 'admin'}),
    });
    assert.equal(loginRes.status, 200);
    const loginSetCookie = loginRes.headers['set-cookie']?.[0] || '';
    assert.match(loginSetCookie, /aoostar_session=/);
    assert.match(loginSetCookie, /HttpOnly/i);
    assert.match(loginSetCookie, /SameSite=Strict/i);
    const loginCookie = loginSetCookie.split(';')[0];

    // Rotate optional script API token (only stored hashed on disk)
    const rotateRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/auth/api-token/rotate',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: `http://127.0.0.1:${port}`,
        Cookie: loginCookie,
      },
    });
    assert.equal(rotateRes.status, 200);
    const token = (JSON.parse(rotateRes.body) as {token: string}).token;
    assert.ok(token.startsWith('aoo_'));
    const updatedCredsRaw = fs.readFileSync(credsPath, 'utf8');
    assert.equal(updatedCredsRaw.includes(token), false);

    // 5. Cross-origin CSRF text/plain POST rejected with 403 even with valid token
    const csrfRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/hardware/clear-emergency-stop',
      headers: {
        Host: `127.0.0.1:${port}`,
        Origin: 'http://evil.example',
        'Content-Type': 'text/plain',
        Authorization: `Bearer ${token}`,
      },
      body: 'clear',
    });
    assert.equal(csrfRes.status, 403);
    assert.match(csrfRes.body, /Cross-origin/i);

    // 6. Session token exchange sets HttpOnly cookie and invalid token returns 401
    const badLogin = await httpRequest({
      port,
      method: 'POST',
      path: '/api/auth/session',
      headers: {Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({token: 'wrong-token'}),
    });
    assert.equal(badLogin.status, 401);

    const goodLogin = await httpRequest({
      port,
      method: 'POST',
      path: '/api/auth/session',
      headers: {Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({token}),
    });
    assert.equal(goodLogin.status, 200);
    const setCookieHeader = goodLogin.headers['set-cookie']?.[0] || '';
    assert.match(setCookieHeader, /aoostar_session=/);
    assert.match(setCookieHeader, /HttpOnly/i);
    assert.match(setCookieHeader, /SameSite=Strict/i);
    const sessionCookie = setCookieHeader.split(';')[0];

    // Cookie allows GET /api/config
    const cookieGet = await httpRequest({
      port,
      method: 'GET',
      path: '/api/config',
      headers: {Host: `127.0.0.1:${port}`, Cookie: sessionCookie},
    });
    assert.equal(cookieGet.status, 200);

    // Cookie-only state-changing POST without Origin/Referer is rejected (CSRF protection)
    const cookiePostNoOrigin = await httpRequest({
      port,
      method: 'POST',
      path: '/api/hardware/clear-emergency-stop',
      headers: {Host: `127.0.0.1:${port}`, Cookie: sessionCookie},
    });
    assert.equal(cookiePostNoOrigin.status, 403);

    // 6. Secret masking + 0600 studio-config.json write + secret preservation on partial save
    const saveSecretsRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/config',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        integrations: {
          haEnabled: true,
          haUrl: 'https://ha.example.invalid:8123',
          haToken: 'super-secret-ha-token',
          agentEnabled: true,
          agentUrl: 'https://agent.example.invalid:8043',
          agentToken: 'super-secret-agent-token',
          customConnections: [
            {
              id: 'cc-1',
              name: 'Custom JSON',
              type: 'http_json',
              url: 'https://api.example.invalid/metrics',
              token: 'custom-secret-tok',
              enabled: true,
            },
          ],
        },
      }),
    });
    assert.equal(saveSecretsRes.status, 200);

    const cfgAfterSave = JSON.parse(saveSecretsRes.body) as {
      integrations: {
        haToken: string;
        haTokenSet: boolean;
        agentToken: string;
        agentTokenSet: boolean;
        customConnections: Array<{token: string; tokenSet: boolean}>;
      };
    };
    assert.equal(cfgAfterSave.integrations.haToken, '');
    assert.equal(cfgAfterSave.integrations.haTokenSet, true);
    assert.equal(cfgAfterSave.integrations.agentToken, '');
    assert.equal(cfgAfterSave.integrations.agentTokenSet, true);
    assert.equal(cfgAfterSave.integrations.customConnections[0].token, '');
    assert.equal(cfgAfterSave.integrations.customConnections[0].tokenSet, true);

    const cfgFileStat = fs.statSync(path.join(tmpDir, 'studio-config.json'));
    assert.equal(cfgFileStat.mode & 0o777, 0o600);
    assert.equal(ctx.getConfig().integrations.haToken, 'super-secret-ha-token');

    // Re-posting config without token preserves stored secret
    const partialSave = await httpRequest({
      port,
      method: 'POST',
      path: '/api/config',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({rotationEnabled: false}),
    });
    assert.equal(partialSave.status, 200);
    assert.equal(ctx.getConfig().integrations.haToken, 'super-secret-ha-token');
    assert.equal(ctx.getConfig().rotationEnabled, false);

    // Full StudioConfig payload (including hardwareDeploy) must save cleanly with 200
    const currentRes = await httpRequest({
      port,
      method: 'GET',
      path: '/api/config',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(currentRes.status, 200);
    const fullClientCfg = JSON.parse(currentRes.body) as Record<string, unknown> & {
      hardware: Record<string, unknown>;
      hardwareDeploy: Record<string, unknown>;
    };
    const fullSaveRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/config',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...fullClientCfg,
        rotationEnabled: true,
        hardware: {
          ...fullClientCfg.hardware,
          sleepScheduleEnabled: false,
          autoPushEnabled: false,
        },
        // Stale client hardwareDeploy must not override server state
        hardwareDeploy: {
          ...fullClientCfg.hardwareDeploy,
          deployed: true,
        },
      }),
    });
    assert.equal(fullSaveRes.status, 200);
    assert.equal(ctx.getConfig().rotationEnabled, true);
    assert.equal(ctx.getConfig().hardware.sleepScheduleEnabled, false);
    assert.equal(ctx.getConfig().hardwareDeploy.deployed, false);

    // Diagnostics should not report absent optional asterctl as a protocol error
    const prevAsterBin = process.env.AOOSTAR_ASTERCTL_BIN;
    process.env.AOOSTAR_ASTERCTL_BIN = path.join(tmpDir, 'missing-asterctl');
    try {
      const {detectAsterctlBinary} = await import('../src/server/aoostar/asterctl.ts');
      detectAsterctlBinary(true);
      const diagRes = await httpRequest({
        port,
        method: 'GET',
        path: '/api/diagnostics',
        headers: {
          Host: `127.0.0.1:${port}`,
          Authorization: `Bearer ${token}`,
        },
      });
      assert.equal(diagRes.status, 200);
      const diagJson = JSON.parse(diagRes.body) as {
        lastProtocolError: string | null;
        asterctl: {mode: string; lastError: string | null};
      };
      assert.equal(diagJson.asterctl.mode, 'absent');
      assert.equal(diagJson.asterctl.lastError, null);
      assert.equal(diagJson.lastProtocolError, null);
    } finally {
      if (prevAsterBin === undefined) delete process.env.AOOSTAR_ASTERCTL_BIN;
      else process.env.AOOSTAR_ASTERCTL_BIN = prevAsterBin;
    }

    // 7. Strict Zod schema validation
    const unknownKeyRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/config',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({unexpectedInjectedField: true}),
    });
    assert.equal(unknownKeyRes.status, 400);

    const unsafeTestRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/hardware/safe-test',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({mode: 'display-on'}),
    });
    assert.equal(unsafeTestRes.status, 400);

    // 8. SSRF blocking without response reflection
    const ssrfLoopback = await httpRequest({
      port,
      method: 'POST',
      path: '/api/integrations/test-ha',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({haUrl: `http://127.0.0.1:${probePort}`, haToken: 'abc'}),
    });
    assert.equal(ssrfLoopback.status, 403);
    assert.equal(probeHits, 0);
    assert.equal(ssrfLoopback.body.includes('LOCAL_INTERNAL_SECRET'), false);

    const ssrfMetadata = await httpRequest({
      port,
      method: 'POST',
      path: '/api/integrations/test-agent',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({agentUrl: 'http://169.254.169.254/latest/meta-data'}),
    });
    assert.equal(ssrfMetadata.status, 403);

    // 9. Hardened uploads: SVG blocked, spoofed PNG blocked, real PNG accepted + served sandboxed
    const svgUploadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/uploads',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'xss.svg',
        dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}`,
      }),
    });
    assert.equal(svgUploadRes.status, 400);

    const svgInitRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/uploads/init',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({name: 'vector.svg', mimeType: 'image/svg+xml'}),
    });
    assert.equal(svgInitRes.status, 400);

    const spoofedPngRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/uploads',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'fake.png',
        dataUrl: `data:image/png;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64')}`,
      }),
    });
    assert.equal(spoofedPngRes.status, 400);

    const realPng = encodePngRgba(Buffer.alloc(4 * 4 * 4, 200), 4, 4);
    const validUploadRes = await httpRequest({
      port,
      method: 'POST',
      path: '/api/uploads',
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'valid.png',
        dataUrl: `data:image/png;base64,${realPng.toString('base64')}`,
      }),
    });
    assert.equal(validUploadRes.status, 200);
    const uploaded = JSON.parse(validUploadRes.body) as {id: string; url: string; mediaType: string};
    assert.equal(uploaded.mediaType, 'image');
    assert.match(uploaded.url, /^\/uploads\/media-.*\.png$/);

    const assetRes = await httpRequest({
      port,
      method: 'GET',
      path: uploaded.url,
      headers: {
        Host: `127.0.0.1:${port}`,
        Authorization: `Bearer ${token}`,
      },
    });
    assert.equal(assetRes.status, 200);
    assert.match(String(assetRes.headers['content-security-policy'] || ''), /sandbox/);
    assert.equal(assetRes.headers['x-content-type-options'], 'nosniff');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => probeServer.close(() => resolve()));
    await ctx.shutdown();
    fs.rmSync(tmpDir, {recursive: true, force: true});

    if (prevNoAutostart === undefined) delete process.env.AOOSTAR_NO_AUTOSTART;
    else process.env.AOOSTAR_NO_AUTOSTART = prevNoAutostart;
    if (prevApiToken === undefined) delete process.env.AOOSTAR_API_TOKEN;
    else process.env.AOOSTAR_API_TOKEN = prevApiToken;
    if (prevAdminUser === undefined) delete process.env.AOOSTAR_ADMIN_USER;
    else process.env.AOOSTAR_ADMIN_USER = prevAdminUser;
    if (prevAdminPassword === undefined) delete process.env.AOOSTAR_ADMIN_PASSWORD;
    else process.env.AOOSTAR_ADMIN_PASSWORD = prevAdminPassword;
    if (prevAllowedHosts === undefined) delete process.env.AOOSTAR_ALLOWED_HOSTS;
    else process.env.AOOSTAR_ALLOWED_HOSTS = prevAllowedHosts;
    if (prevTrustProxy === undefined) delete process.env.AOOSTAR_TRUST_PROXY;
    else process.env.AOOSTAR_TRUST_PROXY = prevTrustProxy;
    if (prevDisableHmr === undefined) delete process.env.DISABLE_HMR;
    else process.env.DISABLE_HMR = prevDisableHmr;
  }
});
