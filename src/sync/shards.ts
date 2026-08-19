import type { VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * How the knowledge base is laid out in the repository.
 *
 * One file does not work. A realistic entry is ~2.5 KB (the captured sentence
 * and paragraph dominate), so a single `vocabulary.json` crosses **1 MB at
 * around 500 words** — and 1 MB is the hard ceiling of GitHub's Contents API
 * for reading a file. Past that the sync does not get slow, it breaks.
 *
 * Sharding by first letter also makes the diffs mean something: adding "zebra"
 * touches `vocabulary/z.json` alone, instead of rewriting a multi-megabyte file
 * that GitHub's web UI refuses to render a diff for.
 *
 * English initials are famously lopsided (s ≈ 11%, x ≈ 0.1%), so the biggest
 * shard is roughly an eighth of the library: ~860 KB at 3000 words, still under
 * the ceiling, and the Git Data API path we use for reading has no ceiling at
 * all.
 */

export const LAYOUT = {
  /** Manifest: schema version, counts, which shards exist. */
  index: 'index.json',
  readme: 'README.md',
  activity: 'meta/activity.json',
  reviews: 'meta/reviews.json',
  /** Superseded by the sharded layout; deleted on the first sharded sync. */
  legacySnapshot: 'vocabulary.json',
  legacyMarkdown: 'VOCABULARY.md',
} as const

export const SHARD_DIR = 'vocabulary'

/** `a`–`z`, plus `other` for anything that does not start with a Latin letter. */
export function shardKeyFor(normalized: string): string {
  const first = normalized.charAt(0).toLowerCase()
  return first >= 'a' && first <= 'z' ? first : 'other'
}

export function shardDataPath(key: string): string {
  return `${SHARD_DIR}/${key}.json`
}

export function shardDocPath(key: string): string {
  return `${SHARD_DIR}/${key}.md`
}

export function groupByShard(entries: VocabularyEntry[]): Map<string, VocabularyEntry[]> {
  const shards = new Map<string, VocabularyEntry[]>()
  for (const entry of entries) {
    const key = shardKeyFor(entry.normalized)
    const bucket = shards.get(key)
    if (bucket) bucket.push(entry)
    else shards.set(key, [entry])
  }
  // Stable order inside a shard keeps diffs to the lines that actually changed.
  for (const bucket of shards.values()) {
    bucket.sort((a, b) => a.normalized.localeCompare(b.normalized))
  }
  return new Map([...shards.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export interface RepoIndex {
  format: 'ai-reader-assistant/knowledge'
  version: number
  /** Derived from the data, never from the clock — see TECH_DECISION TD-16. */
  updatedAt: string
  counts: { entries: number; reviews: number; activeDays: number }
  shards: Array<{ key: string; entries: number; path: string }>
}

export function isShardDataPath(path: string): boolean {
  return path.startsWith(`${SHARD_DIR}/`) && path.endsWith('.json')
}
