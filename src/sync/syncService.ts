import { buildSnapshot, importSnapshot, type KnowledgeSnapshot } from '@/services/exportService.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  keepOnly,
  listAllEntries,
  purgeTombstones,
} from '@/storage/repositories/vocabularyRepo.ts'
import { readSyncState, writeSyncState } from '@/storage/repositories/syncStateRepo.ts'
import { mergeActivity, mergeReviewLog } from '@/storage/repositories/activityRepo.ts'
import { SyncError, type SyncState } from '@/types/sync.ts'
import type { Settings } from '@/types/settings.ts'
import type { DailyActivity, ReviewLogEntry, VocabularyEntry } from '@/types/vocabulary.ts'
import { GitHubClient, gitBlobSha, type CommitFile, type GitHubRepo } from './githubClient.ts'
import { buildCommitMessage, renderReadme, renderShardMarkdown } from './markdown.ts'
import {
  LAYOUT,
  groupByShard,
  isShardDataPath,
  shardDataPath,
  shardDocPath,
  type RepoIndex,
} from './shards.ts'

/**
 * Two-way sync with the user's own private repository.
 *
 * Order is pull -> merge -> push, always. Pushing first would let a fresh
 * install (empty local book) overwrite a remote history built over months.
 * The merge itself is `importSnapshot`, which is additive by construction.
 *
 * The repository is sharded by first letter and written through the Git Data
 * API, so any number of changed files lands as exactly one commit. See
 * `shards.ts` for why one file is not an option.
 */

/**
 * Stamped into the repository description so the extension can recognise its
 * own repository later even if the user renamed it. A name alone is not enough:
 * people rename things, and a second device that guesses the wrong name would
 * silently create a duplicate library.
 *
 * **Do not "tidy" this to match the product's current name.** It is written into
 * repositories that already exist on people's GitHub accounts; changing it means
 * a second device stops recognising the library it is supposed to sync with, and
 * quietly creates a duplicate. Same for the `ai-reader-assistant/knowledge`
 * format string in exported files: it is a published data contract, not a label.
 */
export const REPO_MARKER = '[ai-reader-assistant]'

export const DEFAULT_REPO_NAME = 'ai-reader-vocabulary'

/** Names we have shipped as defaults; adopted rather than duplicated. */
const KNOWN_NAMES = [DEFAULT_REPO_NAME, 'my-english-vocabulary']

export const REPO_DESCRIPTION = `My personal English knowledge base, synced by 翻翻词卡 (FanFan). ${REPO_MARKER}`

/**
 * Finds a repository this extension already owns.
 *
 * Order: the configured name, then any repo carrying our marker, then a repo
 * with one of our historical default names. Only if all three miss do we create
 * a new one — creating a duplicate when the library already exists is the worst
 * outcome here, because the two copies then drift apart.
 */
export function findOwnRepo(repos: GitHubRepo[], preferredName: string): GitHubRepo | null {
  const byName = repos.find((repo) => (repo.name ?? '') === preferredName)
  if (byName) return byName

  const byMarker = repos.find((repo) => (repo.description ?? '').includes(REPO_MARKER))
  if (byMarker) return byMarker

  return repos.find((repo) => KNOWN_NAMES.includes(repo.name ?? '')) ?? null
}

export interface ConnectResult {
  owner: string
  repo: string
  repoUrl: string
  branch: string
  created: boolean
  /** An existing library was found and reused instead of creating a new one. */
  adopted: boolean
}

export async function connectGitHub(signal?: AbortSignal): Promise<ConnectResult> {
  const settings = await getSettings()
  const config = settings.sync
  const client = new GitHubClient(config.token)

  const user = await client.getUser(signal)
  const wanted = sanitizeRepoName(config.repo || DEFAULT_REPO_NAME)

  let repo: GitHubRepo | null = await client.getRepo(user.login, wanted, signal)
  let adopted = false

  if (!repo) {
    // Before creating anything, check whether this account already has a
    // library from another device.
    const existing = findOwnRepo(await client.listRepos(signal), wanted)
    if (existing) {
      repo = existing
      adopted = true
    }
  }

  let created = false
  if (!repo) {
    repo = await client.createRepo(wanted, REPO_DESCRIPTION, signal)
    created = true
  }

  const repoName = repo.name ?? wanted
  const branch = repo.default_branch || 'main'

  await saveSettings({
    sync: { ...config, enabled: true, owner: user.login, repo: repoName, branch },
  })

  return { owner: user.login, repo: repoName, repoUrl: repo.html_url, branch, created, adopted }
}

export interface SyncResult {
  pushed: number
  pulled: number
  /** Number of files written in this commit — 0 when nothing changed. */
  filesChanged: number
  repoFullName: string
  repoUrl: string
  changed: boolean
}

/**
 * How to reconcile the two sides.
 *
 * `merge` is the only non-destructive one and the only one that ever runs on
 * its own: it pulls, merges additively, and pushes. The other two exist because
 * two devices can genuinely diverge in a way no merge rule resolves — and when
 * that happens the reader is the only one who knows which side is the good one.
 *
 * They are deliberately not automatic. A product that silently picks a winner
 * in a conflict is a product that eventually deletes months of someone's words
 * without ever asking.
 */
export type SyncMode = 'merge' | 'forcePush' | 'forcePull'

export async function runSync(
  mode: SyncMode = 'merge',
  signal?: AbortSignal,
): Promise<SyncResult> {
  const settings = await getSettings()
  const config = settings.sync

  if (!config.token.trim()) throw new SyncError('no_token', 'GitHub token is not configured')

  const now = Date.now()
  try {
    let result: SyncResult
    try {
      result = await performSync(config, mode, signal)
    } catch (error) {
      /*
       * Losing the race is normal, and redoing the whole pull-merge-push against
       * the new tip is the fix — not bothering the user.
       *
       * Two retries rather than one: with a second device or a slow connection,
       * one retry can land inside the same window that caused the first failure.
       * Three attempts total is where the odds stop being interesting; past that
       * something is genuinely wrong and the user should be told.
       */
      if (!(error instanceof SyncError) || error.code !== 'stale_head') throw error
      try {
        result = await performSync(config, mode, signal)
      } catch (retryError) {
        if (!(retryError instanceof SyncError) || retryError.code !== 'stale_head') throw retryError
        result = await performSync(config, mode, signal)
      }
    }
    await writeSyncState({
      lastAttemptAt: now,
      lastSuccessAt: Date.now(),
      outcome: result.changed ? 'synced' : 'up_to_date',
      error: '',
      errorCode: '',
      repoFullName: result.repoFullName,
      repoUrl: result.repoUrl,
      entriesPushed: result.pushed,
      entriesPulled: result.pulled,
    })

    // Safe only after a successful round trip: by now the tombstone has been
    // published, so other devices have had their chance to see it.
    void purgeTombstones()

    return result
  } catch (error) {
    const previous = await readSyncState()
    const patch: Partial<SyncState> = {
      lastAttemptAt: now,
      outcome: 'failed',
      error: error instanceof Error ? error.message : String(error),
      errorCode: error instanceof SyncError ? error.code : 'unknown',
    }
    await writeSyncState({ ...previous, ...patch })
    throw error
  }
}

async function performSync(
  config: Settings['sync'],
  mode: SyncMode,
  signal?: AbortSignal,
): Promise<SyncResult> {
  const client = new GitHubClient(config.token)
  const owner = config.owner || (await client.getUser(signal)).login
  const repoName = sanitizeRepoName(config.repo)

  const repo = await client.getRepo(owner, repoName, signal)
  if (!repo) {
    throw new SyncError('not_found', `仓库 ${owner}/${repoName} 不存在，请先点「连接并创建仓库」`)
  }
  const branch = config.branch || repo.default_branch || 'main'
  const repoFullName = `${owner}/${repoName}`

  // One request gives every path and its git sha, so the whole diff — both
  // directions — can be computed without downloading anything else.
  const head = await client.getHeadSha(owner, repoName, branch, signal)
  const remote = new Map(
    (await client.listTree(owner, repoName, head, signal)).map((entry) => [entry.path, entry.sha]),
  )

  /*
   * `forcePush` skips the pull entirely — that is what "本地覆盖远端" means, and
   * merging first would defeat it.
   */
  const pulled =
    mode === 'forcePush' ? 0 : await pullRemote(client, { owner, repoName, remote, signal })

  if (mode === 'forcePull') {
    // Stamped before the network reads below, so words collected while they run
    // are not judged by a verdict that predates them.
    const decidedAt = Date.now()
    /*
     * "远端覆盖本地": adopt the repository's contents and drop whatever this
     * device held that the repository does not.
     *
     * `pullRemote` above already merged the remote in, so everything the
     * repository knows about is present locally by now; what is left is to
     * remove the local-only entries. Doing it in this order rather than wiping
     * first means a failure half way through leaves a superset, never a hole.
     */
    /*
     * The list of "words the repository has" must be read from exactly the same
     * files `pullRemote` read, or the difference between the two lists gets
     * deleted as if it were local-only.
     *
     * It was not: this loop skipped `vocabulary.json`, the pre-shard layout that
     * `pullRemote` does read. On a repository still in that layout the set came
     * out empty, and every word on the device — including the ones just merged
     * in from the repository — was deleted. One predicate out of step with
     * another, and the feature becomes "erase this device".
     */
    const remoteWords = new Set<string>()
    for (const path of remote.keys()) {
      if (!isShardDataPath(path) && path !== LAYOUT.legacySnapshot) continue
      const sha = remote.get(path)
      if (!sha) continue
      const text = await client.readBlob(owner, repoName, sha, signal)
      try {
        // A shard is a bare array; the legacy file is a whole snapshot.
        const parsed = JSON.parse(text) as unknown
        const entries = (Array.isArray(parsed)
          ? parsed
          : ((parsed as { entries?: unknown }).entries ?? [])) as VocabularyEntry[]
        for (const entry of entries) {
          if (entry?.normalized) remoteWords.add(entry.normalized)
        }
      } catch {
        throw new SyncError('conflict', `远端 ${path} 不是合法 JSON，已停止以免误删本地词卡`)
      }
    }

    /*
     * A repository that appears to contain nothing is far more likely to be a
     * parse or layout problem than a user who genuinely wants this device
     * emptied. Refusing costs one confusing error message; not refusing costs
     * the whole library, with no tombstones and nothing to restore from.
     */
    if (remoteWords.size === 0 && (await listAllEntries()).some((entry) => !entry.deletedAt)) {
      throw new SyncError(
        'conflict',
        '远端仓库里没有读到任何词卡，已中止「用远端覆盖本地」以免清空本机。请先确认仓库内容，或改用「用本地覆盖远端」。',
      )
    }

    const dropped = await dropLocalOnly(remoteWords, decidedAt)
    return {
      pushed: 0,
      pulled: pulled + dropped,
      filesChanged: 0,
      repoFullName,
      repoUrl: repo.html_url,
      changed: dropped > 0 || pulled > 0,
    }
  }

  const snapshot = stampWithDataTime(await buildSnapshot())
  const files = buildRepoFiles(snapshot, repoFullName)

  // Skip files whose content already matches: git's blob sha is computable
  // locally, so an unchanged shard costs neither an upload nor a download.
  const changes: CommitFile[] = []
  for (const [path, text] of files) {
    const sha = await gitBlobSha(text)
    if (remote.get(path) !== sha) changes.push({ path, text })
  }

  // Retire files the sharded layout replaced, and shards that are now empty.
  for (const path of remote.keys()) {
    const orphaned =
      (path === LAYOUT.legacySnapshot || path === LAYOUT.legacyMarkdown) && !files.has(path)
    const emptiedShard = isShardDataPath(path) && !files.has(path)
    if (orphaned || emptiedShard) changes.push({ path, text: null })
  }

  const changed =
    changes.length > 0 &&
    (await client.commitFiles({
      owner,
      repo: repoName,
      branch,
      message: buildCommitMessage(snapshot, countNewWords(snapshot, remote)),
      files: changes,
      // The same commit the merge above was computed against.
      expectedHead: head,
      ...(signal ? { signal } : {}),
    }))

  return {
    pushed: liveCount(snapshot),
    pulled,
    filesChanged: changed ? changes.length : 0,
    repoFullName,
    repoUrl: repo.html_url,
    changed,
  }
}

/**
 * Merges whatever the remote holds into the local book.
 *
 * Reads through the Blobs API rather than the Contents API: the latter refuses
 * files over 1 MB, which is exactly the wall this layout exists to avoid.
 */
async function pullRemote(
  client: GitHubClient,
  args: {
    owner: string
    repoName: string
    remote: Map<string, string>
    signal?: AbortSignal | undefined
  },
): Promise<number> {
  /*
   * The learning record lives in the repository too.
   *
   * `meta/reviews.json` and `meta/activity.json` were written on every sync and
   * read on none, so the second device — whose local log starts empty — replaced
   * months of history with its own on its first push. They are pulled and merged
   * here for the same reason the word shards are.
   */
  await mergeHistory(client, args)

  const paths = [...args.remote.keys()].filter(
    (path) => isShardDataPath(path) || path === LAYOUT.legacySnapshot,
  )
  if (paths.length === 0) return 0

  let pulled = 0
  for (const path of paths) {
    const sha = args.remote.get(path)
    if (!sha) continue

    const text = await client.readBlob(args.owner, args.repoName, sha, args.signal)
    if (!text.trim()) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Overwriting a file we cannot read would destroy whatever it holds.
      throw new SyncError('conflict', `远端 ${path} 不是合法 JSON，已停止同步以免覆盖它`)
    }

    // A shard is a bare entry array; the legacy file is a whole snapshot.
    const asSnapshot = Array.isArray(parsed)
      ? { format: 'ai-reader-assistant/knowledge', entries: parsed }
      : parsed
    const merged = await importSnapshot(asSnapshot)
    pulled += merged.added + merged.merged
  }
  return pulled
}

/** Pulls the two `meta/` files and merges them into the local history. */
async function mergeHistory(
  client: GitHubClient,
  args: {
    owner: string
    repoName: string
    remote: Map<string, string>
    signal?: AbortSignal | undefined
  },
): Promise<void> {
  const load = async <T>(path: string): Promise<T[]> => {
    const sha = args.remote.get(path)
    if (!sha) return []
    const text = await client.readBlob(args.owner, args.repoName, sha, args.signal)
    if (!text.trim()) return []
    try {
      const parsed: unknown = JSON.parse(text)
      // Activity is stored locally as a map by date, but committed as an array;
      // accept either so an older repository still merges.
      if (Array.isArray(parsed)) return parsed as T[]
      return Object.values(parsed as Record<string, T>)
    } catch {
      // History is a nice-to-have next to the words themselves — a corrupt
      // meta file must not stop the words from syncing.
      return []
    }
  }

  await mergeReviewLog(await load<ReviewLogEntry>(LAYOUT.reviews))
  await mergeActivity(await load<DailyActivity>(LAYOUT.activity))
}

/** Every file the repository should contain, keyed by path. */
export function buildRepoFiles(
  snapshot: KnowledgeSnapshot,
  repoFullName: string,
): Map<string, string> {
  const shards = groupByShard(snapshot.entries)
  const files = new Map<string, string>()

  for (const [key, entries] of shards) {
    files.set(shardDataPath(key), `${JSON.stringify(entries, null, 2)}\n`)
    files.set(shardDocPath(key), renderShardMarkdown(key, entries))
  }

  const index: RepoIndex = {
    format: 'ai-reader-assistant/knowledge',
    version: snapshot.version,
    updatedAt: snapshot.exportedAt,
    counts: snapshot.counts,
    shards: [...shards].map(([key, entries]) => ({
      key,
      entries: entries.length,
      path: shardDataPath(key),
    })),
  }

  files.set(LAYOUT.index, `${JSON.stringify(index, null, 2)}\n`)
  files.set(LAYOUT.activity, `${JSON.stringify(snapshot.activity, null, 2)}\n`)
  files.set(LAYOUT.reviews, `${JSON.stringify(snapshot.reviewLog, null, 2)}\n`)
  files.set(LAYOUT.readme, renderReadme(snapshot, repoFullName, [...shards.keys()]))

  return files
}

/**
 * Drops local entries the repository has never heard of.
 *
 * Only used by 「远端覆盖本地」. Tombstones are removed outright rather than
 * dated: the user has just said this device's divergence is the wrong one, so
 * keeping a tombstone would push that deletion back out to the other device.
 */
async function dropLocalOnly(remoteWords: Set<string>, decidedAt: number): Promise<number> {
  // `keepOnly` reads and writes under one lock. Reading here and calling
  // `replaceAll` afterwards — which is what this did — deletes anything saved
  // in between, and this runs right after several seconds of network reads.
  return keepOnly(remoteWords, decidedAt)
}

/** Live words, for anything user-facing. */
function liveCount(snapshot: KnowledgeSnapshot): number {
  return snapshot.entries.filter((entry) => !entry.deletedAt).length
}

/** Rough "how many of these are new to the repo", for the commit subject. */
function countNewWords(snapshot: KnowledgeSnapshot, remote: Map<string, string>): number {
  const hadRemote = [...remote.keys()].some(
    (path) => isShardDataPath(path) || path === LAYOUT.legacySnapshot,
  )
  return hadRemote ? 0 : snapshot.entries.length
}

/**
 * `buildSnapshot` stamps `exportedAt` with the current time, which is right for
 * a manual export and poison for sync: the file would differ on every run, so
 * auto-sync would commit a one-line timestamp change every 30 minutes forever
 * and the commit history — the whole reason for using Git — would be noise.
 *
 * For sync the timestamp means "data as of", derived from the data itself.
 */
export function stampWithDataTime(snapshot: KnowledgeSnapshot): KnowledgeSnapshot {
  let latest = 0
  for (const entry of snapshot.entries) latest = Math.max(latest, entry.updatedAt, entry.createdAt)
  for (const log of snapshot.reviewLog) latest = Math.max(latest, log.reviewedAt)
  return { ...snapshot, exportedAt: new Date(latest).toISOString() }
}

export type { VocabularyEntry }

/** GitHub accepts letters, digits, `.`, `-` and `_`; anything else becomes `-`. */
export function sanitizeRepoName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
  return cleaned || DEFAULT_REPO_NAME
}
