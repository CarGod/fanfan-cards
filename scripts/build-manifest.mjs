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

/*
 * `chrome?.i18n` 和 `typeof chrome` 也要算。
 *
 * 第一版只认 `chrome.` 和 `chrome[`，可这个仓库自己就在用可选链写法
 * （`src/i18n/index.ts` 里的 `chrome?.i18n?.getUILanguage?.()`）——也就是说，
 * 这道闸声称守住的那条边界，恰恰对本仓库最常见的写法是敞开的。
 */
const CHROME_API = /\bchrome\s*(?:[.[?]|\))|\btypeof\s+chrome\b/

const withChromeApi = mainWorldScripts.filter((relative) =>
  CHROME_API.test(readFileSync(join(distDir, relative), 'utf8')),
)
if (withChromeApi.length > 0) {
  console.error('MAIN-world scripts reference the chrome API, which is undefined there:')
  for (const path of withChromeApi) console.error(`  - ${path}`)
  process.exit(1)
}

/*
 * MV3 禁止执行远程代码，`eval` / `new Function` / `importScripts` 是审核最常拿来判定
 * 这一条的三个特征。
 *
 * 它们几乎不会是我们自己写的，而是从某个依赖的打包产物里混进来的——也就是说，
 * 它会在某次 `npm update` 之后悄悄出现，然后在提交审核时才被人告知。
 * 那时距离引入它的那次改动已经过去很久了。
 */
const REMOTE_CODE = /\beval\s*\(|\bnew\s+Function\s*\(|\bimportScripts\s*\(/

const remoteCode = []
for (const file of walk(distDir)) {
  if (!file.endsWith('.js')) continue
  const match = REMOTE_CODE.exec(readFileSync(file, 'utf8'))
  if (match) remoteCode.push(`${file.slice(distDir.length + 1)}: ${match[0]}`)
}
if (remoteCode.length > 0) {
  console.error('Build output executes code from a string, which MV3 forbids:')
  for (const hit of remoteCode) console.error(`  - ${hit}`)
  process.exit(1)
}

/*
 * 每一个 `__MSG_x__` 都必须在每一种语言里解析得到。
 *
 * 少一条的后果不是「那一处显示成英文」，是 Chrome **拒绝加载整个扩展**，
 * 报一句不告诉你缺哪个键的错。而漏译几乎必然发生在加第二种语言之后的某次改动里，
 * 那时没人会去逐条比对两个 messages.json。
 */
const localesDir = join(distDir, '_locales')
if (manifest.default_locale) {
  const locales = existsSync(localesDir) ? readdirSync(localesDir) : []
  if (!locales.includes(manifest.default_locale)) {
    console.error(`default_locale is "${manifest.default_locale}" but _locales/${manifest.default_locale}/ was not built.`)
    process.exit(1)
  }

  const placeholders = [...new Set(
    [...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)].map((match) => match[1]),
  )]

  const gaps = []
  for (const locale of locales) {
    const file = join(localesDir, locale, 'messages.json')
    if (!existsSync(file)) {
      gaps.push(`${locale}: messages.json missing`)
      continue
    }
    const messages = JSON.parse(readFileSync(file, 'utf8'))
    for (const name of placeholders) {
      if (!messages[name]) gaps.push(`${locale}: ${name}`)
    }
  }
  if (gaps.length > 0) {
    console.error('Manifest placeholders with no message behind them:')
    for (const gap of gaps) console.error(`  - ${gap}`)
    process.exit(1)
  }
  console.log(`locales ok - ${locales.length} locale(s), ${placeholders.length} placeholder(s) resolved in each`)
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(
  `manifest ok - v${manifest.version}, ${referenced.length} referenced files present, ${mainWorldScripts.length} main-world script(s) clean, no credentials in bundle`,
)
