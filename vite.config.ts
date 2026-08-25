import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Build #1 — extension pages + the MV3 background service worker.
 *
 * The service worker is declared as `"type": "module"` in the manifest, so it can
 * ship as a normal ESM chunk here. Content scripts cannot (Chrome loads them as
 * classic scripts), which is why they get their own IIFE build in
 * `vite.content.config.ts`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': r('./src') },
  },
  // The Anthropic SDK reads `process.env.*` for ambient credentials. There is no
  // `process` in a service worker, so we shim it to an empty object: the provider
  // always passes an explicit API key.
  define: {
    'process.env': '{}',
    'globalThis.process': '{"env":{}}',
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        background: r('./src/background/index.ts'),
        popup: r('./src/popup/index.html'),
        options: r('./src/options/index.html'),
        app: r('./src/app/index.html'),
      },
      output: {
        // Stable, manifest-referenceable paths (no content hash on entries).
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
