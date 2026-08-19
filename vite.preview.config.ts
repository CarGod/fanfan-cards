import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * Dev-only harness for looking at the UI without loading the extension.
 * Never part of `npm run build`.
 */
export default defineConfig({
  root: r('./preview'),
  plugins: [react()],
  resolve: { alias: { '@': r('./src') } },
  server: { port: 5199, strictPort: true },
})
