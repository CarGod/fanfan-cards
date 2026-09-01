import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Build #2 — the content script.
 *
 * Chrome injects content scripts as classic scripts, so the bundle must be a
 * single self-contained IIFE with no import statements. CSS is imported with
 * `?inline` inside the source and injected into a shadow root at runtime, so no
 * stylesheet is emitted here either.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': r('./src') },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'esnext',
    sourcemap: true,
    cssCodeSplit: false,
    lib: {
      entry: r('./src/content/index.tsx'),
      formats: ['iife'],
      name: 'AIReaderAssistantContent',
      fileName: () => 'assets/content.js',
    },
    rollupOptions: {
      output: { extend: true, inlineDynamicImports: true },
    },
  },
})
