/**
 * Watch mode.
 *
 * The extension needs two Vite builds (ESM pages/worker + IIFE content script)
 * writing into the same `dist/`. `npm run build -- --watch` cannot express that
 * — npm appends the flag to the last command in the chain only — so this script
 * runs one clean build, then keeps both builds watching in parallel.
 *
 * Chrome does not hot-reload extensions: after a rebuild, press the reload
 * button on chrome://extensions (content scripts also need a page refresh).
 */
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function run(args, label) {
  const child = spawn(npx, args, { cwd: root, stdio: 'inherit' })
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[${label}] exited with code ${code}`)
      process.exitCode = code
    }
  })
  return child
}

// One full build first, so `dist/` is loadable (and the manifest validated)
// before the watchers start emitting partial output.
const initial = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
if (initial.status !== 0) process.exit(initial.status ?? 1)

console.log('\nwatching — reload the extension at chrome://extensions after each rebuild\n')

const children = [
  run(['vite', 'build', '--watch'], 'pages'),
  run(['vite', 'build', '--config', 'vite.content.config.ts', '--watch'], 'content'),
]

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal)
    process.exit(0)
  })
}
