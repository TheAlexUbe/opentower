import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (file) => fs.readFileSync(new URL(file, root), 'utf8');
const exists = (file) => fs.existsSync(new URL(file, root));

const sw = read('sw.js');
const cacheVersion = sw.match(/const CACHE = '([^']+)'/)?.[1];
assert.ok(cacheVersion, 'service worker declares a cache version');
assert.match(cacheVersion, /^opentower-v\d+$/, 'cache version is easy to bump');

const assets = [...sw.matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]).filter(Boolean);
assert.ok(assets.length > 20, 'service worker caches the app shell');
for (const asset of assets) {
  assert.ok(exists(asset), `cached asset exists: ${asset}`);
}
for (const file of fs.readdirSync(new URL('src/', root))) {
  if (!file.endsWith('.js')) continue;
  assert.ok(assets.includes(`src/${file}`), `service worker caches src/${file}`);
}

const manifest = JSON.parse(read('manifest.webmanifest'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
for (const icon of manifest.icons) {
  assert.ok(exists(icon.src), `manifest icon exists: ${icon.src}`);
}

const html = read('index.html');
assert.match(html, /<link rel="manifest" href="manifest\.webmanifest"/);
assert.match(html, /<script type="module" src="src\/main\.js"><\/script>/);
assert.match(html, /name="viewport"/);

console.log('OpenTower PWA asset checks passed');
