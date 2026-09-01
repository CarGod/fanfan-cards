import { EXPLAIN_CACHE_LIMIT, STORAGE_KEYS } from '@/shared/constants.ts'
import { hashString } from '@/shared/utils.ts'
import { isUsableExplanation } from '@/ai/schema.ts'
import type { ExplainDetail, WordExplanation } from '@/types/ai.ts'
import { storage } from '../area.ts'
import { withLock } from '../mutex.ts'

interface CacheRecord {
  value: WordExplanation
  at: number
  /** Bumped on every hit so eviction can be LRU rather than FIFO. */
  usedAt: number
}

type CacheMap = Record<string, CacheRecord>

/**
 * The same word in the same sentence should cost the user one API call, ever.
 * Re-reading a page, or re-opening a card, must be free.
 */
export function cacheKey(parts: {
  providerId: string
  model: string
  /** Bumping the prompt must invalidate every cached answer. */
  promptVersion: string
  text: string
  context: string
}): string {
  return hashString(
    [parts.providerId, parts.model, parts.promptVersion, parts.text.toLowerCase(), parts.context].join(
      ' ',
    ),
  )
}

export async function readCache(
  key: string,
  ttlHours: number,
  detail: ExplainDetail = 'full',
): Promise<WordExplanation | null> {
  if (ttlHours <= 0) return null
  const map = (await storage().get<CacheMap>(STORAGE_KEYS.explainCache)) ?? {}
  const record = map[key]
  if (!record) return null
  if (Date.now() - record.at > ttlHours * 3600_000) return null

  // An entry written by an older build can be empty. Serving it would replay a
  // bug that is already fixed, so drop it and let the caller ask the model.
  if (!isUsableExplanation(record.value, detail)) {
    void withLock(STORAGE_KEYS.explainCache, async () => {
      const fresh = (await storage().get<CacheMap>(STORAGE_KEYS.explainCache)) ?? {}
      delete fresh[key]
      await storage().set(STORAGE_KEYS.explainCache, fresh)
    })
    return null
  }

  // Touch asynchronously; a stale `usedAt` only affects eviction order.
  void withLock(STORAGE_KEYS.explainCache, async () => {
    const fresh = (await storage().get<CacheMap>(STORAGE_KEYS.explainCache)) ?? {}
    const target = fresh[key]
    if (target) {
      target.usedAt = Date.now()
      await storage().set(STORAGE_KEYS.explainCache, fresh)
    }
  })

  return record.value
}

export async function writeCache(
  key: string,
  value: WordExplanation,
  detail: ExplainDetail = 'full',
): Promise<void> {
  // Never persist an answer we would refuse to show.
  if (!isUsableExplanation(value, detail)) return

  await withLock(STORAGE_KEYS.explainCache, async () => {
    const map = (await storage().get<CacheMap>(STORAGE_KEYS.explainCache)) ?? {}
    const now = Date.now()
    map[key] = { value, at: now, usedAt: now }

    const keys = Object.keys(map)
    if (keys.length > EXPLAIN_CACHE_LIMIT) {
      const sorted = keys.sort((a, b) => (map[a]?.usedAt ?? 0) - (map[b]?.usedAt ?? 0))
      for (const stale of sorted.slice(0, keys.length - EXPLAIN_CACHE_LIMIT)) delete map[stale]
    }
    await storage().set(STORAGE_KEYS.explainCache, map)
  })
}

export async function clearCache(): Promise<void> {
  await storage().remove(STORAGE_KEYS.explainCache)
}
