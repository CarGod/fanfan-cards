import { STORAGE_KEYS } from '@/shared/constants.ts'
import { createId, dateKey, normalizeWord } from '@/shared/utils.ts'
import type {
  CefrLevel,
  FamiliarityLevel,
  VocabularyEntry,
  ReviewState,
  ExampleSentence,
  SelectionKind,
  Synonym,
  WordSense,
} from '@/types/vocabulary.ts'
import { REVIEW_STATUS_BY_LEVEL } from '@/types/vocabulary.ts'
import { storage } from '../area.ts'
import { withLock } from '../mutex.ts'
import { bumpActivity } from './activityRepo.ts'

export type WordMap = Record<string, VocabularyEntry>

export interface NewEntryInput {
  word: string
  lemma: string
  kind: SelectionKind
  phonetic: string
  partOfSpeech: string
  cefr: CefrLevel
  meaning: string
  /** 按词性拆开的释义。给不出就传空数组。 */
  senses: WordSense[]
  aiExplanation: string
  englishDefinition: string
  sentenceTranslation: string
  examples: ExampleSentence[]
  synonyms: Synonym[]
  source: { url: string; title: string; context: string; wideContext: string }
  origin: { providerId: string; model: string; offline: boolean }
}

export function freshReviewState(now: number = Date.now()): ReviewState {
  return {
    level: 0,
    status: REVIEW_STATUS_BY_LEVEL[0],
    dueAt: now,
    lastReviewedAt: null,
    reviewCount: 0,
    lapses: 0,
    streak: 0,
  }
}

export async function readAll(): Promise<WordMap> {
  return (await storage().get<WordMap>(STORAGE_KEYS.words)) ?? {}
}

/** Live entries only; tombstones exist for sync, not for the user. */
export async function listEntries(): Promise<VocabularyEntry[]> {
  const map = await readAll()
  return Object.values(map)
    .filter((entry) => !entry.deletedAt)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/** Includes tombstones — for sync and export, which must carry deletions. */
export async function listAllEntries(): Promise<VocabularyEntry[]> {
  const map = await readAll()
  return Object.values(map).sort((a, b) => b.createdAt - a.createdAt)
}

export async function getEntry(id: string): Promise<VocabularyEntry | null> {
  const map = await readAll()
  const entry = map[id]
  return entry && !entry.deletedAt ? entry : null
}

export async function findByWord(word: string): Promise<VocabularyEntry | null> {
  return findByAnyWord([word])
}

/**
 * "Is this already saved?" has to tolerate inflection: the user selected
 * `misleading`, the model may have echoed the lemma `mislead`, and the entry
 * could have been saved under either. Checking every known form is the
 * difference between the card saying "already saved" and offering a duplicate.
 */
export async function findByAnyWord(words: string[]): Promise<VocabularyEntry | null> {
  const candidates = new Set(words.map(normalizeWord).filter(Boolean))
  if (candidates.size === 0) return null

  const map = await readAll()
  return (
    Object.values(map).find(
      (entry) =>
        !entry.deletedAt &&
        (candidates.has(entry.normalized) || candidates.has(normalizeWord(entry.lemma))),
    ) ?? null
  )
}

/**
 * Saving the same word twice is a *learning signal*, not an error: we refresh
 * the explanation and keep a second source sighting, but never reset progress.
 */
export async function saveEntry(
  input: NewEntryInput,
): Promise<{ entry: VocabularyEntry; created: boolean }> {
  const result = await withLock(STORAGE_KEYS.words, async () => {
    const map = await readAll()
    const now = Date.now()
    const normalized = normalizeWord(input.word)
    const existing = Object.values(map).find((entry) => entry.normalized === normalized)

    // Saving a word that was deleted revives it: the user asked for it again.
    if (existing?.deletedAt) {
      const revived: VocabularyEntry = { ...existing, deletedAt: null, updatedAt: now }
      map[existing.id] = revived
      await storage().set(STORAGE_KEYS.words, map)
      return { entry: revived, created: true }
    }

    if (existing) {
      const merged: VocabularyEntry = {
        ...existing,
        phonetic: input.phonetic || existing.phonetic,
        partOfSpeech: input.partOfSpeech || existing.partOfSpeech,
        cefr: input.cefr || existing.cefr,
        meaning: input.meaning || existing.meaning,
        // 空数组当作「这次没给」，保住老词卡已经拆好的那份。
        senses: input.senses.length ? input.senses : (existing.senses ?? []),
        aiExplanation: input.aiExplanation || existing.aiExplanation,
        englishDefinition: input.englishDefinition || existing.englishDefinition,
        sentenceTranslation: input.sentenceTranslation || existing.sentenceTranslation,
        examples: input.examples.length ? input.examples : existing.examples,
        synonyms: input.synonyms.length ? input.synonyms : existing.synonyms,
        origin: input.origin,
        updatedAt: now,
      }
      map[existing.id] = merged
      await storage().set(STORAGE_KEYS.words, map)
      return { entry: merged, created: false }
    }

    const entry: VocabularyEntry = {
      id: createId('w'),
      word: input.word,
      normalized,
      lemma: input.lemma || normalized,
      kind: input.kind,
      phonetic: input.phonetic,
      partOfSpeech: input.partOfSpeech,
      cefr: input.cefr,
      meaning: input.meaning,
      senses: input.senses,
      aiExplanation: input.aiExplanation,
      englishDefinition: input.englishDefinition,
      sentenceTranslation: input.sentenceTranslation,
      examples: input.examples,
      synonyms: input.synonyms,
      source: { ...input.source, capturedAt: now },
      origin: input.origin,
      review: freshReviewState(now),
      tags: [],
      notes: '',
      favorite: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }
    map[entry.id] = entry
    await storage().set(STORAGE_KEYS.words, map)
    return { entry, created: true }
  })

  if (result.created) await bumpActivity(dateKey(), { saved: 1 })
  return result
}

export async function updateEntry(
  id: string,
  patch: Partial<Omit<VocabularyEntry, 'id' | 'createdAt'>>,
): Promise<VocabularyEntry | null> {
  return withLock(STORAGE_KEYS.words, async () => {
    const map = await readAll()
    const existing = map[id]
    if (!existing) return null
    const next: VocabularyEntry = { ...existing, ...patch, updatedAt: Date.now() }
    map[id] = next
    await storage().set(STORAGE_KEYS.words, map)
    return next
  })
}

export async function setFamiliarity(
  id: string,
  level: FamiliarityLevel,
): Promise<VocabularyEntry | null> {
  const entry = await getEntry(id)
  if (!entry) return null
  return updateEntry(id, {
    review: { ...entry.review, level, status: REVIEW_STATUS_BY_LEVEL[level] },
  })
}

/** Soft delete, so the deletion reaches the user's other devices. */
export async function removeEntry(id: string): Promise<boolean> {
  return withLock(STORAGE_KEYS.words, async () => {
    const map = await readAll()
    const entry = map[id]
    if (!entry || entry.deletedAt) return false
    const now = Date.now()
    map[id] = { ...entry, deletedAt: now, updatedAt: now }
    await storage().set(STORAGE_KEYS.words, map)
    return true
  })
}

/**
 * Drops tombstones old enough that every device has certainly synced past them.
 * Keeping them forever would grow the repository without bound.
 */
export async function purgeTombstones(olderThanMs = 30 * 24 * 3600_000): Promise<number> {
  return withLock(STORAGE_KEYS.words, async () => {
    const map = await readAll()
    const cutoff = Date.now() - olderThanMs
    let purged = 0
    for (const [id, entry] of Object.entries(map)) {
      if (entry.deletedAt && entry.deletedAt < cutoff) {
        delete map[id]
        purged++
      }
    }
    if (purged) await storage().set(STORAGE_KEYS.words, map)
    return purged
  })
}

export async function removeMany(ids: string[]): Promise<number> {
  return withLock(STORAGE_KEYS.words, async () => {
    const map = await readAll()
    const now = Date.now()
    let removed = 0
    for (const id of ids) {
      const entry = map[id]
      if (entry && !entry.deletedAt) {
        map[id] = { ...entry, deletedAt: now, updatedAt: now }
        removed++
      }
    }
    if (removed) await storage().set(STORAGE_KEYS.words, map)
    return removed
  })
}

/**
 * Merge a batch of entries in, under one lock.
 *
 * The reason this exists rather than "read all, merge, replaceAll": that shape
 * reads the table *outside* the lock and writes the whole table back inside it,
 * so anything saved in between is overwritten by a snapshot taken before it
 * existed. It is not a narrow race — a sync pulls one shard at a time over the
 * network, so the window is the whole sync, and a word saved during it vanishes
 * with no tombstone and no error.
 *
 * `decide` picks the survivor when both sides know a word; returning the
 * incoming copy adopts it under the existing id, so a word does not change
 * identity just because it came back from the repository.
 */
export async function mergeEntries(
  incoming: VocabularyEntry[],
  decide: (existing: VocabularyEntry, incoming: VocabularyEntry) => VocabularyEntry,
): Promise<{ added: number; merged: number; skipped: number }> {
  const result = { added: 0, merged: 0, skipped: 0 }

  await withLock(STORAGE_KEYS.words, async () => {
    // Read inside the lock: this is the entire point of the function.
    const map = ((await storage().get<WordMap>(STORAGE_KEYS.words)) ?? {}) as WordMap
    const byNormalized = new Map(Object.values(map).map((entry) => [entry.normalized, entry]))

    for (const entry of incoming) {
      if (!entry || typeof entry.normalized !== 'string' || !entry.id) {
        result.skipped++
        continue
      }
      const existing = byNormalized.get(entry.normalized)
      if (!existing) {
        byNormalized.set(entry.normalized, entry)
        if (!entry.deletedAt) result.added++
        continue
      }
      /*
       * 直接用 `decide` 的返回值，**不要**拿它和两个入参比引用。
       *
       * 这里曾经写的是 `winner === entry ? {...entry, id} : existing`。而
       * `resolveConflict` 在最常见的那条路上返回的是一个**新对象**
       * （编辑取较新的一方、复习状态取较近的一次、计数取两边最大值）——
       * 于是两个引用判断同时不成立，落到 `existing`：那份逐字段合出来的结果
       * 被整个丢掉，本地永远赢。
       *
       * 后果是同步只剩下删除还有效：另一台设备上写的笔记、改过的释义、
       * 复习进度，拉下来之后一律消失，而且没有任何提示——两边都显示"同步成功"。
       *
       * id 始终沿用本地那份：远端的 id 换过来会让本地已有的引用（复习记录、
       * 界面上打开着的卡）全部指空。
       */
      const winner = decide(existing, entry)
      byNormalized.set(entry.normalized, { ...winner, id: existing.id })
      result.merged++
    }

    const next: WordMap = {}
    for (const entry of byNormalized.values()) next[entry.id] = entry
    await storage().set(STORAGE_KEYS.words, next)
  })

  return result
}

/**
 * Keeps only the entries whose normalized form is in `keep`, under one lock.
 *
 * Same reasoning as `mergeEntries`: the caller must not read the table, decide,
 * and write it back, because everything saved in between disappears.
 */
export async function keepOnly(keep: Set<string>, decidedAt = Date.now()): Promise<number> {
  let dropped = 0
  await withLock(STORAGE_KEYS.words, async () => {
    const map = ((await storage().get<WordMap>(STORAGE_KEYS.words)) ?? {}) as WordMap
    const next: WordMap = {}
    for (const entry of Object.values(map)) {
      /*
       * A word saved *after* the decision was made was never considered by it.
       *
       * `keep` is assembled from several seconds of network reads, and anything
       * collected in that window would otherwise be deleted by a verdict that
       * predates it — silently, with no tombstone, right after the reader
       * watched it appear in the card. Newer than the decision means "not this
       * operation's business".
       */
      if (keep.has(entry.normalized) || entry.createdAt > decidedAt) next[entry.id] = entry
      else dropped++
    }
    if (dropped > 0) await storage().set(STORAGE_KEYS.words, next)
  })
  return dropped
}

/** Bulk replace — used by import and (later) sync reconciliation. */
export async function replaceAll(entries: VocabularyEntry[]): Promise<void> {
  await withLock(STORAGE_KEYS.words, async () => {
    const map: WordMap = {}
    for (const entry of entries) map[entry.id] = entry
    await storage().set(STORAGE_KEYS.words, map)
  })
}

export function watchEntries(listener: (entries: VocabularyEntry[]) => void): () => void {
  return storage().watch(STORAGE_KEYS.words, (value) => {
    const map = (value as WordMap | undefined) ?? {}
    listener(
      Object.values(map)
        .filter((entry) => !entry.deletedAt)
        .sort((a, b) => b.createdAt - a.createdAt),
    )
  })
}
