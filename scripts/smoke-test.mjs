/**
 * Smoke test for the *built* extension.
 *
 * Unit tests cover pure logic; this exercises the real `dist/assets/background.js`
 * bundle against a minimal fake of the Chrome extension APIs, so it catches the
 * failures that only appear after bundling: a listener that never registered, a
 * node-only import that got stubbed to `{}`, a broken message envelope.
 *
 * Usage: npm run build && node scripts/smoke-test.mjs
 */
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const store = new Map()
const messageListeners = []
const changeListeners = []

function fireChanges(changes) {
  for (const listener of changeListeners) listener(changes, 'local')
}

globalThis.chrome = {
  runtime: {
    id: 'smoke-test',
    getManifest: () => ({ version: '0.0.0-test' }),
    getURL: (path) => `chrome-extension://smoke/${path}`,
    onMessage: { addListener: (fn) => messageListeners.push(fn), removeListener: () => {} },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    openOptionsPage: async () => {},
  },
  storage: {
    local: {
      get: async (key) => {
        if (key === null || key === undefined) return Object.fromEntries(store)
        return store.has(key) ? { [key]: store.get(key) } : {}
      },
      set: async (items) => {
        const changes = {}
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: store.get(key), newValue: value }
          store.set(key, value)
        }
        fireChanges(changes)
      },
      remove: async (key) => {
        store.delete(key)
        fireChanges({ [key]: { oldValue: undefined, newValue: undefined } })
      },
      getBytesInUse: async () => JSON.stringify(Object.fromEntries(store)).length,
    },
    onChanged: {
      addListener: (fn) => changeListeners.push(fn),
      removeListener: () => {},
    },
    session: {
      data: new Map(),
      get: async function (key) {
        return this.data.has(key) ? { [key]: this.data.get(key) } : {}
      },
      set: async function (items) {
        for (const [key, value] of Object.entries(items)) this.data.set(key, value)
      },
      remove: async function (key) {
        this.data.delete(key)
      },
    },
  },
  contextMenus: { create: () => {}, removeAll: (cb) => cb?.(), onClicked: { addListener: () => {} } },
  alarms: {
    created: new Map(),
    get: async function (name) {
      return this.created.get(name)
    },
    create: function (name, info) {
      this.created.set(name, { name, ...info })
    },
    clear: async function (name) {
      return this.created.delete(name)
    },
    onAlarm: { addListener: () => {} },
  },
  commands: { onCommand: { addListener: () => {} } },
  tabs: {
    query: async () => [],
    create: async () => ({}),
    update: async () => ({}),
    sendMessage: async () => {},
    onRemoved: { addListener: () => {} },
    onUpdated: { addListener: () => {} },
  },
  windows: { update: async () => ({}) },
}

await import(pathToFileURL(join(root, 'dist/assets/background.js')).href)

assert.ok(messageListeners.length > 0, 'background registered no message listener')

/**
 * Calls the background exactly the way a content script does.
 *
 * The sender's URL matters now that translation state is keyed by host, so it
 * is a parameter rather than a constant.
 */
function send(type, payload, senderUrl = 'https://example.com/article') {
  return new Promise((resolve, reject) => {
    const listener = messageListeners[0]
    const kept = listener({ type, payload }, { tab: { id: 1, url: senderUrl } }, (reply) => {
      if (!reply) return reject(new Error('empty reply'))
      if (!reply.ok) return reject(new Error(`${type} failed: ${reply.error.message}`))
      resolve(reply.data)
    })
    assert.equal(kept, true, `${type} did not keep the message channel open`)
  })
}

const checks = []
const check = async (name, fn) => {
  try {
    await fn()
    checks.push(`  ok   ${name}`)
  } catch (error) {
    checks.push(`  FAIL ${name}: ${error.message}`)
    process.exitCode = 1
  }
}

const CONTEXT = 'Database migration can be dangerous if you skip the dry run.'
let explained

await check('ping reaches the worker', async () => {
  const reply = await send('ping', {})
  assert.equal(reply.ok, true)
})

await check('explain returns a contextual explanation (offline provider)', async () => {
  explained = await send('ai/explain', {
    text: 'migration',
    context: CONTEXT,
    pageTitle: 'Postgres notes',
    pageUrl: 'https://example.com/post',
  })
  assert.equal(explained.explanation.word, 'migration')
  assert.equal(explained.offline, true)
  assert.equal(explained.cached, false)
  assert.match(explained.explanation.contextMeaning, /数据库|迁移/)
  assert.ok(explained.explanation.phonetic.startsWith('/'), 'phonetic should be normalised')
})

await check('a repeated lookup is served from cache', async () => {
  const again = await send('ai/explain', {
    text: 'migration',
    context: CONTEXT,
    pageTitle: 'Postgres notes',
    pageUrl: 'https://example.com/post',
  })
  assert.equal(again.cached, true)
})

await check('saving creates a vocabulary entry with its source', async () => {
  const { entry, created } = await send('vocab/save', {
    selection: 'migration',
    explanation: explained.explanation,
    source: {
      url: 'https://example.com/post',
      title: 'Postgres notes',
      context: CONTEXT,
      wideContext: CONTEXT,
    },
    origin: { providerId: explained.providerId, model: explained.model, offline: explained.offline },
  })
  assert.equal(created, true)
  assert.equal(entry.normalized, 'migration')
  assert.equal(entry.source.context, CONTEXT)
  assert.equal(entry.review.level, 0)
  assert.ok(entry.review.dueAt <= Date.now(), 'a new card should be due immediately')
})

await check('saving the same word again merges instead of duplicating', async () => {
  const { created } = await send('vocab/save', {
    selection: 'migration',
    explanation: explained.explanation,
    source: { url: 'https://other.com', title: 'Other', context: CONTEXT, wideContext: CONTEXT },
    origin: { providerId: 'mock', model: 'local-heuristic-v1', offline: true },
  })
  assert.equal(created, false)
  const words = store.get('ara:words')
  assert.equal(Object.keys(words).length, 1)
})

await check('lookup matches a punctuated selection, and the lemma too', async () => {
  const { entry } = await send('vocab/lookup', { words: ['Migration,'] })
  assert.ok(entry, 'normalisation should match a punctuated selection')

  // The model often echoes the lemma; the card must still say "already saved".
  const byLemma = await send('vocab/lookup', { words: ['migrations', 'migration'] })
  assert.ok(byLemma.entry, 'any of the supplied forms should match')
})

await check('daily activity was recorded', async () => {
  const activity = store.get('ara:activity')
  const today = Object.values(activity)[0]
  assert.equal(today.saved, 1)
  assert.equal(today.lookups, 1, 'the cached second lookup must not be double counted')
})

await check('removing an entry hides it but leaves a tombstone for other devices', async () => {
  const { entry } = await send('vocab/lookup', { words: ['migration'] })
  const { removed } = await send('vocab/remove', { id: entry.id })
  assert.equal(removed, true)

  // Gone as far as the user is concerned…
  const after = await send('vocab/lookup', { words: ['migration'] })
  assert.equal(after.entry, null)

  // …but the row survives as a dated tombstone, or the other machine would
  // simply push the word back on the next sync.
  const words = Object.values(store.get('ara:words'))
  assert.equal(words.length, 1)
  assert.ok(words[0].deletedAt > 0, 'deletion must be dated so it can be ordered against edits')
})

await check('the sync scheduler leaves no alarm behind when sync is off', async () => {
  // A periodic alarm recreated on every worker start would reset its own timer
  // and never fire; an alarm for a feature that is off should not exist at all.
  // This also covers the change-triggered debounce: saving words above must not
  // have scheduled anything while sync is unconfigured.
  assert.equal(globalThis.chrome.alarms.created.size, 0)
})

await check('page translation is remembered per host, not per tab', async () => {
  await send('page/state', { translating: true }, 'https://example.com/article')
  assert.equal(globalThis.chrome.storage.session.data.get('ara:translateHost:example.com'), true)

  // The point of host-keying: another page of the same site translates itself,
  // which is what "I turned this on for example.com" has to mean.
  const other = await send('page/shouldTranslate', {}, 'https://example.com/another/post')
  assert.equal(other.translating, true)

  // A different site is unaffected.
  const elsewhere = await send('page/shouldTranslate', {}, 'https://other.test/page')
  assert.equal(elsewhere.translating, false)

  await send('page/state', { translating: false }, 'https://example.com/article')
  assert.equal(globalThis.chrome.storage.session.data.has('ara:translateHost:example.com'), false)
  const afterOff = await send('page/shouldTranslate', {}, 'https://example.com/another/post')
  assert.equal(afterOff.translating, false)
})

await check('an unknown word degrades honestly instead of inventing a meaning', async () => {
  const reply = await send('ai/explain', {
    text: 'quixotic',
    context: 'His quixotic plan never shipped.',
  })
  assert.match(reply.explanation.meaning, /未收录/)
  assert.equal(reply.explanation.phonetic, '')
})

console.log('\nbackground bundle smoke test')
console.log(checks.join('\n'))
console.log(process.exitCode ? '\nFAILED' : '\nall checks passed\n')
