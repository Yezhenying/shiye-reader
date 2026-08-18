import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const vite = resolve(root, 'node_modules/vite/bin/vite.js');
execFileSync(process.execPath, [vite, 'build'], {
  cwd: root,
  env: { ...process.env, VITE_BASE_PATH: '/shiye-reader/' },
  stdio: 'inherit',
});

const index = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
const assets = JSON.parse(readFileSync(resolve(root, 'dist/sw-assets.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.webmanifest'), 'utf8'));
const worker = readFileSync(resolve(root, 'dist/sw.js'), 'utf8');

assert.match(index, /href="\/shiye-reader\/manifest\.webmanifest"/);
assert.match(index, /src="\/shiye-reader\/assets\//);
assert.equal(assets.base, '/shiye-reader/');
assert.ok(assets.assets.every(asset => asset.startsWith('/shiye-reader/')));
assert.ok(existsSync(resolve(root, 'dist/sw.js')));
assert.match(worker, /self\.registration\.scope/);
assert.equal(manifest.start_url, './#/');
assert.equal(manifest.scope, './');

console.log('pages build: project-site paths verified');
