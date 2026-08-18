import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function normalizeBase(value = '/') {
  const trimmed = String(value || '/').trim();
  if (!trimmed || trimmed === '/') return '/';
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}/`;
}

function deploymentBase() {
  if (process.env.VITE_BASE_PATH) return normalizeBase(process.env.VITE_BASE_PATH);
  const repository = process.env.GITHUB_REPOSITORY?.split('/').at(-1);
  return process.env.GITHUB_ACTIONS && repository ? normalizeBase(repository) : '/';
}

function offlineAssetManifest(base) {
  return {
    name: 'offline-asset-manifest',
    generateBundle(_options, bundle) {
      const assetUrl = file => `${base}${file.replace(/^\//, '')}`;
      const assets = [
        assetUrl(''),
        assetUrl('index.html'),
        assetUrl('manifest.webmanifest'),
        assetUrl('icon.svg'),
        assetUrl('sw.js'),
        ...Object.keys(bundle).map(assetUrl),
      ];
      this.emitFile({
        type: 'asset',
        fileName: 'sw-assets.json',
        source: JSON.stringify({ version: Date.now(), base, assets: [...new Set(assets)] }),
      });
    },
  };
}

export default defineConfig(() => {
  const base = deploymentBase();
  return { base, plugins: [react(), offlineAssetManifest(base)] };
});
