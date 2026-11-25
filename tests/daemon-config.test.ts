import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_CONFIG} from '../src/presets.ts';
import {isWithinSleepWindow} from '../src/server/hardwareDaemon.ts';
import {
  mergeIncomingConfig,
  readJsonWithBackupFallback,
  writeFileAtomic0600,
} from '../src/server/security.ts';

test('writeFileAtomic0600 and readJsonWithBackupFallback enforce 0600 perms and recover corrupt primary config from .bak', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aoostar-cfg-'));
  const cfgPath = path.join(tmpDir, 'studio-config.json');

  try {
    writeFileAtomic0600(cfgPath, JSON.stringify({version: 1, label: 'first'}), true);
    writeFileAtomic0600(cfgPath, JSON.stringify({version: 2, label: 'second'}), true);

    assert.equal(fs.statSync(cfgPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${cfgPath}.bak`).mode & 0o777, 0o600);

    // Corrupt primary file
    fs.writeFileSync(cfgPath, '{invalid json!!!', {mode: 0o600});
    const recovered = readJsonWithBackupFallback<{version: number; label: string}>(cfgPath);
    assert.equal(recovered.recoveredFromBackup, true);
    assert.deepEqual(recovered.data, {version: 1, label: 'first'});
  } finally {
    fs.rmSync(tmpDir, {recursive: true, force: true});
  }
});

test('mergeIncomingConfig preserves existing tokens unless explicitly replaced or cleared', () => {
  const initial = structuredClone(DEFAULT_CONFIG);
  initial.integrations.haToken = 'ha-secret-1';
  initial.integrations.agentToken = 'agent-secret-1';
  initial.integrations.customConnections = [
    {
      id: 'c1',
      name: 'Conn 1',
      type: 'http_json',
      url: 'https://example.invalid',
      token: 'conn-secret-1',
      enabled: true,
    },
  ];

  // Blank incoming token strings preserve stored secrets
  const kept = mergeIncomingConfig(initial, {
    integrations: {
      ...initial.integrations,
      haToken: '',
      agentToken: '',
      customConnections: [
        {
          id: 'c1',
          name: 'Conn 1',
          type: 'http_json',
          url: 'https://example.invalid',
          token: '',
          enabled: true,
        },
      ],
    },
  });
  assert.equal(kept.integrations.haToken, 'ha-secret-1');
  assert.equal(kept.integrations.agentToken, 'agent-secret-1');
  assert.equal(kept.integrations.customConnections[0].token, 'conn-secret-1');

  // Explicit clear flags wipe secrets cleanly
  const cleared = mergeIncomingConfig(kept, {
    integrations: {
      ...kept.integrations,
      clearHaToken: true,
      clearAgentToken: true,
    },
  });
  assert.equal(cleared.integrations.haToken, '');
  assert.equal(cleared.integrations.haTokenSet, false);
  assert.equal(cleared.integrations.agentToken, '');
  assert.equal(cleared.integrations.agentTokenSet, false);
});

test('isWithinSleepWindow handles overnight, daytime, equal, and disabled schedules accurately', () => {
  assert.equal(isWithinSleepWindow(false, '23:30', '07:00', new Date('2026-01-01T01:00:00')), false);
  assert.equal(isWithinSleepWindow(true, '23:30', '23:30', new Date('2026-01-01T23:30:00')), false);

  // Overnight window 23:30 -> 07:00
  assert.equal(isWithinSleepWindow(true, '23:30', '07:00', new Date('2026-01-01T23:45:00')), true);
  assert.equal(isWithinSleepWindow(true, '23:30', '07:00', new Date('2026-01-01T03:00:00')), true);
  assert.equal(isWithinSleepWindow(true, '23:30', '07:00', new Date('2026-01-01T14:00:00')), false);

  // Daytime window 09:00 -> 17:00
  assert.equal(isWithinSleepWindow(true, '09:00', '17:00', new Date('2026-01-01T12:30:00')), true);
  assert.equal(isWithinSleepWindow(true, '09:00', '17:00', new Date('2026-01-01T20:00:00')), false);
});
