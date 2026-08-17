import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function offlineAssetManifest() {
  return {
    name: 'offline-asset-manifest',
    generateBundle(_options, bundle) {
      const assets = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', ...Object.keys(bundle).map(name => `/${name}`)];
      this.emitFile({ type: 'asset', fileName: 'sw-assets.json', source: JSON.stringify({ version: Date.now(), assets: [...new Set(assets)] }) });
    },
  };
}

export default defineConfig({ plugins: [react(), offlineAssetManifest()] });
