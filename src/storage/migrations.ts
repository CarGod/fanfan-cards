import { SCHEMA_VERSION, STORAGE_KEYS } from '@/shared/constants.ts'
import { storage } from './area.ts'

export interface StorageMeta {
  schemaVersion: number
  installedAt: number
  lastOpenedAt: number
}

type Migration = (db: Record<string, unknown>) => Promise<void> | void

/**
 * Ordered migrations, indexed by the version they upgrade *to*.
 *
 * Migrations touch the user's saved words, so they are additive by rule: fill
 * in what is missing, never drop a field we no longer read. A word saved a year
 * ago has to survive every future schema.
 */
const MIGRATIONS: Record<number, Migration> = {
  /**
   * v2: synonyms gained glosses (`string[]` -> `{word, meaning}[]`) and entries
   * gained `sentenceTranslation`. Old entries keep their synonyms with an empty
   * gloss rather than losing them.
   */
  2: async (db) => {
    const words = db[STORAGE_KEYS.words] as Record<string, Record<string, unknown>> | undefined
    if (!words) return

    for (const entry of Object.values(words)) {
      if (typeof entry['sentenceTranslation'] !== 'string') entry['sentenceTranslation'] = ''
      const synonyms = entry['synonyms']
      if (Array.isArray(synonyms)) {
        entry['synonyms'] = synonyms.map((item) =>
          typeof item === 'string' ? { word: item, meaning: '' } : item,
        )
      } else {
        entry['synonyms'] = []
      }
    }
    await storage().set(STORAGE_KEYS.words, words)
  },

  /**
   * v3: entries gained a CEFR band. Existing words get '' rather than a guessed
   * level — an invented difficulty is worse than an absent one.
   */
  3: async (db) => {
    const words = db[STORAGE_KEYS.words] as Record<string, Record<string, unknown>> | undefined
    if (!words) return
    for (const entry of Object.values(words)) {
      if (typeof entry['cefr'] !== 'string') entry['cefr'] = ''
    }
    await storage().set(STORAGE_KEYS.words, words)
  },

  /**
   * v4: one example became a list. The old pair is folded into a single-item
   * list rather than dropped — it is a sentence the user may already have
   * reviewed against.
   */
  4: async (db) => {
    const words = db[STORAGE_KEYS.words] as Record<string, Record<string, unknown>> | undefined
    if (!words) return
    for (const entry of Object.values(words)) {
      if (Array.isArray(entry['examples'])) continue
      const sentence = typeof entry['example'] === 'string' ? entry['example'] : ''
      const translation =
        typeof entry['exampleTranslation'] === 'string' ? entry['exampleTranslation'] : ''
      entry['examples'] = sentence ? [{ sentence, translation }] : []
      delete entry['example']
      delete entry['exampleTranslation']
    }
    await storage().set(STORAGE_KEYS.words, words)
  },

  /** v5: deletions became tombstones so they can reach other devices. */
  5: async (db) => {
    const words = db[STORAGE_KEYS.words] as Record<string, Record<string, unknown>> | undefined
    if (!words) return
    for (const entry of Object.values(words)) {
      if (entry['deletedAt'] === undefined) entry['deletedAt'] = null
    }
    await storage().set(STORAGE_KEYS.words, words)
  },
}

export async function initStorage(): Promise<StorageMeta> {
  const store = storage()
  const existing = await store.get<StorageMeta>(STORAGE_KEYS.meta)
  const now = Date.now()

  if (!existing) {
    const meta: StorageMeta = { schemaVersion: SCHEMA_VERSION, installedAt: now, lastOpenedAt: now }
    await store.set(STORAGE_KEYS.meta, meta)
    return meta
  }

  let version = existing.schemaVersion
  if (version < SCHEMA_VERSION) {
    const db = await store.getAll()
    for (let target = version + 1; target <= SCHEMA_VERSION; target++) {
      const migrate = MIGRATIONS[target]
      if (migrate) await migrate(db)
      version = target
    }
  }

  const meta: StorageMeta = { ...existing, schemaVersion: version, lastOpenedAt: now }
  await store.set(STORAGE_KEYS.meta, meta)
  return meta
}
