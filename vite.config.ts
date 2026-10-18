import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const require = createRequire(import.meta.url)
const ortEntry = require.resolve('onnxruntime-web')
const ortCommon = createRequire(ortEntry).resolve('onnxruntime-common')

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
    // Keep browser JS, Tensor types and copied JSEP artifacts on the same ORT
    // version. Node tests retain the native binding's own common dependency.
    alias: {
      '@': r('./src'),
      'onnxruntime-web': resolve(dirname(ortEntry), 'ort.webgpu.min.mjs'),
      'onnxruntime-common': resolve(dirname(ortCommon), '../esm/index.js'),
    },
  },
  // The Anthropic SDK reads `process.env.*` for ambient credentials. There is no
  // `process` in a service worker, so we shim it to an empty object: the provider
  // always passes an explicit API key.
  define: {
    'process.env': '{}',
    'globalThis.process': '{"env":{}}',
  },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: true,
    // 扩展页面不要 <link rel="modulepreload">：Chrome 会把没用上的预加载记成扩展错误。
    modulePreload: false,
    rollupOptions: {
      input: {
        background: r('./src/background/index.ts'),
        popup: r('./src/popup/index.html'),
        options: r('./src/options/index.html'),
        app: r('./src/app/index.html'),
        audio: r('./src/audio/index.html'),
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
