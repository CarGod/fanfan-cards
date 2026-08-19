/**
 * Packs `dist/` into a store-uploadable zip.
 *
 * Uses the system `zip` binary rather than pulling in an archiver dependency —
 * this runs once per release, and the extension itself ships no build-time deps
 * it does not need.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

if (!existsSync(dist)) {
  console.error('dist/ does not exist — run `npm run build` first.')
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const output = join(root, `fanfan-cards-v${version}.zip`)
rmSync(output, { force: true })

try {
  // Source maps are useful locally but bloat the upload and leak source.
  execFileSync('zip', ['-r', '-q', output, '.', '-x', '*.map'], { cwd: dist })
} catch (error) {
  console.error('Packing failed. Is the `zip` command available on this system?')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}

console.log(`packed ${output}`)
