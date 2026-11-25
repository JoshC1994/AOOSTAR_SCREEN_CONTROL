import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('packaging & policy checks: Docker-only Unraid deployment, Node-only image without Rust/asterctl build, no legacy .plg or mock arrays', () => {
  const root = process.cwd();

  // Legacy .plg plugin files must be removed
  assert.equal(fs.existsSync(path.join(root, 'aoostar-display-studio.plg')), false);
  assert.equal(fs.existsSync(path.join(root, 'templates', 'aoostar-display-studio-plugin.xml')), false);

  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.equal(/asterctl-builder|rust:|cargo build|git clone/i.test(dockerfile), false);
  assert.match(dockerfile, /fonts-dejavu-core/);
  assert.match(dockerfile, /\bgosu\b/);
  assert.match(dockerfile, /COPY docker-entrypoint\.sh \/usr\/local\/bin\/docker-entrypoint\.sh/);
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/);
  assert.match(dockerfile, /AOOSTAR_BIND=0\.0\.0\.0/);
  assert.equal(/^USER\s+node\b/m.test(dockerfile), false);
  assert.match(dockerfile, /CMD \["node", "dist-server\/server\.mjs"\]/);

  const entrypoint = fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8');
  assert.match(entrypoint, /AOOSTAR_UID:-.*1000/);
  assert.match(entrypoint, /AOOSTAR_GID:-.*1000/);
  assert.match(entrypoint, /exec gosu /);
  assert.match(entrypoint, /\/app\/data/);

  const asterctlSrc = fs.readFileSync(path.join(root, 'src', 'server', 'aoostar', 'asterctl.ts'), 'utf8');
  for (const removedSymbol of [
    'writeAsterctlSensorSnapshot',
    'writeAsterctlMonitorAssets',
    'startOrRestartAsterctlDaemon',
    'sendImageViaAsterctl',
  ]) {
    assert.equal(asterctlSrc.includes(removedSymbol), false, `${removedSymbol} must remain removed`);
  }

  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /monitor\.json/i);
  assert.match(readme, /sensor-mapping\.cfg/i);

  const templateXml = fs.readFileSync(path.join(root, 'templates', 'aoostar-display-studio.xml'), 'utf8');
  assert.match(templateXml, /JoshC1994\/AOOSTAR_SCREEN_CONTROL/);
  assert.match(templateXml, /ghcr\.io\/joshc1994\/aoostar_screen_control:latest/);
  assert.match(templateXml, /<ExtraParams>--device=\/dev\/ttyACM0:\/dev\/ttyACM0 --group-add=20<\/ExtraParams>/);
  assert.equal(templateXml.includes('Type="Device"'), false);
  assert.match(templateXml, /AOOSTAR_UID/);
  assert.match(templateXml, /AOOSTAR_GID/);
  assert.match(templateXml, /AOOSTAR_API_TOKEN/);
  assert.match(templateXml, /AOOSTAR_ALLOWED_HOSTS/);
  assert.match(templateXml, /AOOSTAR_TRUST_PROXY/);

  const caProfile = fs.readFileSync(path.join(root, 'ca_profile.xml'), 'utf8');
  assert.match(caProfile, /JoshC1994/);
  assert.match(caProfile, /AOOSTAR_SCREEN_CONTROL/);

  const widgetRenderer = fs.readFileSync(path.join(root, 'src', 'components', 'LcdWidgetRenderer.tsx'), 'utf8');
  assert.equal(widgetRenderer.includes('[80, 110, 95]'), false);
  assert.equal(widgetRenderer.includes('[20, 32, 28]'), false);
  assert.equal(widgetRenderer.includes('[10, 20, 15, 25]'), false);

  const rasterizer = fs.readFileSync(path.join(root, 'src', 'utils', 'lcdRasterizer.ts'), 'utf8');
  assert.equal(rasterizer.includes('[20, 24, 22]'), false);
  assert.equal(rasterizer.includes('[10, 20, 15, 25]'), false);

  const screenStudio = fs.readFileSync(path.join(root, 'src', 'components', 'ScreenStudioView.tsx'), 'utf8');
  assert.equal(screenStudio.includes('image/svg+xml'), false);

  const settingsView = fs.readFileSync(path.join(root, 'src', 'components', 'SettingsView.tsx'), 'utf8');
  assert.equal(settingsView.includes('image/svg+xml'), false);
});
