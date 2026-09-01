import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Build #3 — the page-world helper.
 *
 * Separate from the content bundle because it runs in the *page's* JavaScript
 * context, where `chrome.runtime` does not exist. Anything that reaches for an
 * extension API here fails at runtime rather than at build time, so the only
 * safe guarantee is that this entry pulls in nothing that touches `chrome` —
 * which is why it is its own graph instead of a flag on the other build.
 *
 * It is injected at `document_start` so it can wrap `fetch` before the player
 * makes its first captions request.
 */
export default defineConfig({
  resolve: { alias: { '@': r('./src') } },
  define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    sourcemap: true,
    lib: {
      entry: r('./src/content/video/mainWorld.ts'),
      formats: ['iife'],
      name: 'FanFanYouTubeBridge',
      fileName: () => 'assets/youtube-main.js',
    },
    rollupOptions: { output: { extend: true, inlineDynamicImports: true } },
  },
})
