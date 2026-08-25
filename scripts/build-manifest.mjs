/**
 * Post-build step: sync the manifest version with package.json and verify that
 * every path the manifest points at actually exists in `dist/`.
 *
 * A manifest referencing a missing file fails at *load* time in Chrome with a
 * vague error, usually after you have already lost ten minutes. This turns that
 * into a build failure with the exact path.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = join(root, 'dist')
const manifestPath = join(distDir, 'manifest.json')
const sourceManifestPath = join(root, 'public', 'manifest.json')

if (!existsSync(manifestPath)) {
  console.error('dist/manifest.json is missing — run the Vite builds first.')
  process.exit(1)
}

/**
 * A packed extension is a zip anyone can open, so a key that leaks into the
 * bundle leaks permanently. Nothing here is supposed to inline a credential -
 * keys live in chrome.storage at runtime - which is exactly why an accidental
 * one would go unnoticed without this gate.
 */
const SECRET_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}/,
  /\bsk-[A-Za-z0-9]{32,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\bghp_[A-Za-z0-9]{30,}/,
]

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) yield* walk(full)
    else yield full
  }
}

const leaks = []
for (const file of walk(distDir)) {
  if (!/\.(js|css|html|json|map)$/.test(file)) continue
  const content = readFileSync(file, 'utf8')
  for (const pattern of SECRET_PATTERNS) {
    const match = pattern.exec(content)
    if (match) leaks.push(`${file.slice(distDir.length + 1)}: ${match[0].slice(0, 12)}...`)
  }
}
if (leaks.length > 0) {
  console.error('Build output contains what look like API credentials:')
  for (const leak of leaks) console.error(`  - ${leak}`)
  process.exit(1)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

/*
 * package.json is the only place a human sets the version.
 *
 * The source manifest carries the field too (Chrome requires it), and since the
 * build overwrites it on the way to dist/, the number sitting in the source file
 * is derived — which means it silently rots. Writing it back keeps the two from
 * ever disagreeing on disk, and saying so out loud keeps the write from being a
 * surprise.
 */
const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8'))
if (sourceManifest.version !== pkg.version) {
  sourceManifest.version = pkg.version
  writeFileSync(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`)
  console.log(`synced public/manifest.json version -> ${pkg.version}`)
}
manifest.version = pkg.version

const referenced = [
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  ...Object.values(manifest.icons ?? {}),
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...(manifest.content_scripts ?? []).flatMap((entry) => [...(entry.js ?? []), ...(entry.css ?? [])]),
].filter(Boolean)

const missing = referenced.filter((relative) => !existsSync(join(distDir, relative)))
if (missing.length > 0) {
  console.error('Manifest references files that were not built:')
  for (const path of missing) console.error(`  - ${path}`)
  process.exit(1)
}

/*
 * A MAIN-world content script runs in the page's own JavaScript context, where
 * `chrome` does not exist. Reaching for an extension API there fails at runtime,
 * on the page, silently — the feature just never happens and nothing in the
 * build says why. So the rule is checked here, where it costs nothing.
 */
const mainWorldScripts = (manifest.content_scripts ?? [])
  .filter((entry) => entry.world === 'MAIN')
  .flatMap((entry) => entry.js ?? [])

const withChromeApi = mainWorldScripts.filter((relative) =>
  /\bchrome\s*[.[]/.test(readFileSync(join(distDir, relative), 'utf8')),
)
if (withChromeApi.length > 0) {
  console.error('MAIN-world scripts reference the chrome API, which is undefined there:')
  for (const path of withChromeApi) console.error(`  - ${path}`)
  process.exit(1)
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  `manifest ok - v${manifest.version}, ${referenced.length} referenced files present, ${mainWorldScripts.length} main-world script(s) clean, no credentials in bundle`,
)
