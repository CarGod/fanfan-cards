import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { saveSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  listAllEntries,
  listEntries,
  removeEntry,
  saveEntry,
} from '@/storage/repositories/vocabularyRepo.ts'
import { readSyncState } from '@/storage/repositories/syncStateRepo.ts'
import { buildSnapshot } from '@/services/exportService.ts'
import { SyncError } from '@/types/sync.ts'
import { GitHubClient, decodeBase64, encodeBase64, gitBlobSha } from './githubClient.ts'
import { renderShardMarkdown } from './markdown.ts'
import { groupByShard, shardKeyFor } from './shards.ts'
import {
  DEFAULT_REPO_NAME,
  REPO_MARKER,
  buildRepoFiles,
  connectGitHub,
  findOwnRepo,
  runSync,
  sanitizeRepoName,
} from './syncService.ts'

/**
 * A fake GitHub covering both APIs we use.
 *
 * Blob shas are computed with the real algorithm, so the "skip files that
 * already match" path — the thing that keeps a sync from re-uploading the whole
 * library every 30 minutes — is exercised for real rather than stubbed out.
 */
function fakeGitHub(
  options: {
    repoExists?: boolean
    files?: Record<string, string>
    /** Other repositories on the account, for the auto-association path. */
    otherRepos?: Array<{ name: string; description?: string }>
  } = {},
) {
  const files = new Map<string, string>(Object.entries(options.files ?? {}))
  const pending = new Map<string, string>()
  const proposedTrees = new Map<string, Map<string, string>>()
  const commitTrees = new Map<string, string>()
  let pendingCommit: { sha: string; message: string } | null = null
  let treeCounter = 0
  const state = {
    repoExists: options.repoExists ?? false,
    createdRepos: [] as Array<Record<string, unknown>>,
    commits: [] as string[],
    files,
    blobUploads: 0,
    head: 'commit-0',
    lastCommitPaths: [] as string[],
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const REPO_INFO = {
    full_name: 'octocat/vocab',
    html_url: 'https://github.com/octocat/vocab',
    default_branch: 'main',
    private: true,
  }

  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace('https://api.github.com', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined

    if (path === '/user') return json({ login: 'octocat' })

    if (path.startsWith('/user/repos') && method === 'GET') {
      const owned = (options.otherRepos ?? []).map((repo) => ({
        name: repo.name,
        full_name: `octocat/${repo.name}`,
        html_url: `https://github.com/octocat/${repo.name}`,
        default_branch: 'main',
        private: true,
        description: repo.description ?? null,
      }))
      return json(state.repoExists ? [{ ...REPO_INFO, name: 'vocab' }, ...owned] : owned)
    }

    if (path === '/user/repos' && method === 'POST') {
      state.createdRepos.push(body ?? {})
      state.repoExists = true
      return json(REPO_INFO, 201)
    }

    if (path === '/repos/octocat/vocab') {
      return state.repoExists ? json(REPO_INFO) : json({ message: 'Not Found' }, 404)
    }

    if (path.startsWith('/repos/octocat/vocab/git/ref/heads/')) {
      return json({ object: { sha: state.head } })
    }

    if (path.startsWith('/repos/octocat/vocab/git/trees/')) {
      const tree = await Promise.all(
        [...files.entries()].map(async ([filePath, text]) => ({
          path: filePath,
          sha: await gitBlobSha(text),
          type: 'blob',
        })),
      )
      return json({ tree })
    }

    if (path.startsWith('/repos/octocat/vocab/git/blobs/') && method === 'GET') {
      const sha = path.split('/').pop()
      for (const text of files.values()) {
        if ((await gitBlobSha(text)) === sha) {
          return json({ content: encodeBase64(text), encoding: 'base64' })
        }
      }
      return json({ message: 'Not Found' }, 404)
    }

    if (path === '/repos/octocat/vocab/git/blobs' && method === 'POST') {
      state.blobUploads++
      const text = decodeBase64(String(body?.['content'] ?? ''))
      const sha = await gitBlobSha(text)
      pending.set(sha, text)
      return json({ sha }, 201)
    }

    // A tree is only a proposal until the ref moves — mirroring that matters,
    // because it is exactly what makes a lost race recoverable.
    if (path === '/repos/octocat/vocab/git/trees' && method === 'POST') {
      const entries = (body?.['tree'] ?? []) as Array<{ path: string; sha: string | null }>
      state.lastCommitPaths = entries.map((entry) => entry.path).sort()
      const next = new Map(files)
      for (const entry of entries) {
        if (entry.sha === null) next.delete(entry.path)
        else next.set(entry.path, pending.get(entry.sha) ?? '')
      }
      const treeSha = `tree-${++treeCounter}`
      proposedTrees.set(treeSha, next)
      return json({ sha: treeSha }, 201)
    }

    if (path === '/repos/octocat/vocab/git/commits' && method === 'POST') {
      const commitSha = `commit-${state.commits.length + 1}`
      commitTrees.set(commitSha, String(body?.['tree'] ?? ''))
      pendingCommit = { sha: commitSha, message: String(body?.['message'] ?? '') }
      return json({ sha: commitSha }, 201)
    }

    if (path.startsWith('/repos/octocat/vocab/git/refs/heads/') && method === 'PATCH') {
      const sha = String(body?.['sha'] ?? '')
      const tree = proposedTrees.get(commitTrees.get(sha) ?? '')
      if (tree) {
        files.clear()
        for (const [key, value] of tree) files.set(key, value)
      }
      if (pendingCommit?.sha === sha) state.commits.push(pendingCommit.message)
      state.head = sha
      return json({ ok: true })
    }

    return json({ message: `unexpected ${method} ${path}` }, 500)
  }

  return { state, fetchImpl }
}

async function seedWord(word: string) {
  return saveEntry({
    word,
    lemma: word,
    kind: 'word',
    phonetic: '/test/',
    partOfSpeech: 'noun',
    cefr: 'B2',
    meaning: '测试释义',
    aiExplanation: '这里指测试。\n第二行',
    englishDefinition: 'a test',
    sentenceTranslation: '这是一个测试句子。',
    examples: [{ sentence: `A sentence with ${word}.`, translation: '一个句子。' }],
    synonyms: [{ word: 'check', meaning: '核对，侧重逐项确认' }],
    source: {
      url: 'https://example.com/post',
      title: 'Example post',
      context: `A sentence with ${word} in it.`,
      wideContext: '',
    },
    origin: { providerId: 'mock', model: 'test', offline: true },
  })
}

function remoteEntry(word: string, patch: Record<string, unknown> = {}) {
  return {
    id: `r-${word}`,
    word,
    normalized: word,
    lemma: word,
    kind: 'word',
    phonetic: '',
    partOfSpeech: '',
    cefr: '',
    meaning: `${word} 的释义`,
    aiExplanation: '',
    englishDefinition: '',
    sentenceTranslation: '',
    examples: [],
    synonyms: [],
    source: { url: '', title: '', context: '', wideContext: '', capturedAt: 0 },
    origin: { providerId: 'mock', model: 'x', offline: true },
    review: {
      level: 0,
      status: 'new',
      dueAt: 0,
      lastReviewedAt: null,
      reviewCount: 0,
      lapses: 0,
      streak: 0,
    },
    tags: [],
    notes: '',
    favorite: false,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...patch,
  }
}

async function setup(fake: ReturnType<typeof fakeGitHub>) {
  vi.stubGlobal('fetch', fake.fetchImpl)
  await saveSettings({
    sync: {
      enabled: true,
      token: 'ghp_test',
      owner: 'octocat',
      repo: 'vocab',
      branch: 'main',
      autoSync: false,
      intervalMinutes: 30,
    },
  })
}

beforeEach(() => setStorageAdapter(createMemoryAdapter()))
afterEach(() => {
  vi.unstubAllGlobals()
  setStorageAdapter(null)
})

describe('sanitizeRepoName', () => {
  it('keeps valid names and repairs the rest', () => {
    expect(sanitizeRepoName('my-english-vocabulary')).toBe('my-english-vocabulary')
    expect(sanitizeRepoName('  我的 单词本 ')).toBe(DEFAULT_REPO_NAME)
    expect(sanitizeRepoName('my words!')).toBe('my-words')
  })
})

describe('findOwnRepo', () => {
  const repo = (name: string, description = '') => ({
    name,
    full_name: `octocat/${name}`,
    html_url: '',
    default_branch: 'main',
    private: true,
    description,
  })

  it('prefers the configured name', () => {
    const found = findOwnRepo([repo('other'), repo('ai-reader-vocabulary')], 'ai-reader-vocabulary')
    expect(found?.name).toBe('ai-reader-vocabulary')
  })

  // The whole point: a second device must adopt the existing library rather
  // than quietly starting a second one that then drifts apart from the first.
  it('recognises a renamed library by the marker in its description', () => {
    const found = findOwnRepo(
      [repo('notes'), repo('英语单词', `私人知识库 ${REPO_MARKER}`)],
      'ai-reader-vocabulary',
    )
    expect(found?.name).toBe('英语单词')
  })

  it('adopts a repo left behind by an older default name', () => {
    const found = findOwnRepo([repo('my-english-vocabulary')], 'ai-reader-vocabulary')
    expect(found?.name).toBe('my-english-vocabulary')
  })

  it('returns null when the account has nothing of ours', () => {
    expect(findOwnRepo([repo('dotfiles'), repo('blog')], 'ai-reader-vocabulary')).toBeNull()
  })
})

describe('base64 round trip', () => {
  it('survives non-ASCII, which plain btoa does not', () => {
    const text = '语境含义：migration 指数据库迁移 🧠'
    expect(decodeBase64(encodeBase64(text))).toBe(text)
  })
})

describe('gitBlobSha', () => {
  // Values from `git hash-object --stdin`. Getting this wrong would silently
  // re-upload every file on every sync.
  it('matches git', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  })
})

describe('sharding', () => {
  it('buckets by first letter, with a home for everything else', () => {
    expect(shardKeyFor('migration')).toBe('m')
    expect(shardKeyFor('zebra')).toBe('z')
    expect(shardKeyFor('3d printing')).toBe('other')
    expect(shardKeyFor('émigré')).toBe('other')
  })

  it('sorts inside a shard so a diff shows only the line that changed', async () => {
    await seedWord('mango')
    await seedWord('apple')
    await seedWord('avocado')
    const shards = groupByShard(await listEntries())
    expect([...shards.keys()]).toEqual(['a', 'm'])
    expect(shards.get('a')!.map((entry) => entry.word)).toEqual(['apple', 'avocado'])
  })
})

describe('buildRepoFiles', () => {
  it('lays out one data file and one readable file per letter, plus a manifest', async () => {
    await seedWord('apple')
    await seedWord('mango')
    const files = buildRepoFiles(await buildSnapshot(), 'octocat/vocab')

    expect([...files.keys()].sort()).toEqual([
      'README.md',
      'index.json',
      'meta/activity.json',
      'meta/reviews.json',
      'vocabulary/a.json',
      'vocabulary/a.md',
      'vocabulary/m.json',
      'vocabulary/m.md',
    ])

    const index = JSON.parse(files.get('index.json')!) as {
      shards: Array<{ key: string; entries: number; path: string }>
    }
    expect(index.shards).toEqual([
      { key: 'a', entries: 1, path: 'vocabulary/a.json' },
      { key: 'm', entries: 1, path: 'vocabulary/m.json' },
    ])
  })

  it('renders a shard page that names the words it contains', async () => {
    await seedWord('apple')
    const markdown = renderShardMarkdown('a', await listEntries())
    expect(markdown).toContain('# A')
    expect(markdown).toContain('### apple')
    expect(markdown).toContain('CEFR B2')
  })
})

describe('runSync', () => {
  it('creates the repo, then writes the whole layout in ONE commit', async () => {
    const fake = fakeGitHub()
    await setup(fake)
    await seedWord('apple')
    await seedWord('mango')

    const connected = await connectGitHub()
    expect(connected.created).toBe(true)
    expect(connected.adopted).toBe(false)
    // The description carries the marker that lets another device find it.
    expect(String(fake.state.createdRepos[0]?.['description'])).toContain(REPO_MARKER)

    const result = await runSync()
    expect(result.changed).toBe(true)
    // Eight files, one commit — the entire point of using the Git Data API.
    expect(fake.state.commits).toHaveLength(1)
    expect(fake.state.files.has('vocabulary/a.json')).toBe(true)
    expect(fake.state.files.has('vocabulary/m.md')).toBe(true)
  })

  it('adopts an existing library instead of creating a second one', async () => {
    const fake = fakeGitHub({
      otherRepos: [{ name: 'vocab', description: `旧的知识库 ${REPO_MARKER}` }],
    })
    await setup(fake)

    const connected = await connectGitHub()
    expect(connected.adopted).toBe(true)
    expect(connected.created).toBe(false)
    expect(fake.state.createdRepos).toHaveLength(0)
  })

  it('uploads nothing and commits nothing when the library has not changed', async () => {
    const fake = fakeGitHub({ repoExists: true })
    await setup(fake)
    await seedWord('apple')

    await runSync()
    const uploadsAfterFirst = fake.state.blobUploads
    expect(fake.state.commits).toHaveLength(1)

    const second = await runSync()
    expect(second.changed).toBe(false)
    expect(fake.state.commits).toHaveLength(1)
    // Comparing git shas locally means an unchanged sync costs zero uploads.
    expect(fake.state.blobUploads).toBe(uploadsAfterFirst)
  })

  it('touches only the affected shard when one word is added', async () => {
    const fake = fakeGitHub({ repoExists: true })
    await setup(fake)
    await seedWord('apple')
    await runSync()

    await seedWord('zebra')
    await runSync()

    // The new shard, its page, the manifest, the README's counts, and the day's
    // activity tally. Crucially NOT `vocabulary/a.json` — that is the whole
    // point of sharding: an unrelated letter is not rewritten.
    expect(fake.state.lastCommitPaths).toEqual([
      'README.md',
      'index.json',
      'meta/activity.json',
      'vocabulary/z.json',
      'vocabulary/z.md',
    ])
    expect(fake.state.files.get('vocabulary/a.json')).toContain('apple')
  })

  it('adopts an old single-file repo and retires the file it replaced', async () => {
    const legacy = {
      format: 'ai-reader-assistant/knowledge',
      version: 1,
      exportedAt: new Date(0).toISOString(),
      counts: { entries: 1, reviews: 0, activeDays: 0 },
      entries: [remoteEntry('throttle')],
      activity: {},
      reviewLog: [],
    }

    const fake = fakeGitHub({
      repoExists: true,
      files: { 'vocabulary.json': JSON.stringify(legacy), 'VOCABULARY.md': '# old' },
    })
    await setup(fake)
    await seedWord('apple')

    const result = await runSync()
    expect(result.pulled).toBe(1)

    // The remote word was adopted, not lost…
    expect(fake.state.files.get('vocabulary/t.json')).toContain('throttle')
    expect(fake.state.files.get('vocabulary/a.json')).toContain('apple')
    // …and the files the new layout replaces are gone, in the same commit.
    expect(fake.state.files.has('vocabulary.json')).toBe(false)
    expect(fake.state.files.has('VOCABULARY.md')).toBe(false)
    expect(fake.state.commits).toHaveLength(1)
  })

  it('merges a sharded remote into an empty local library', async () => {
    const fake = fakeGitHub({
      repoExists: true,
      files: { 'vocabulary/z.json': JSON.stringify([remoteEntry('zebra')], null, 2) },
    })
    await setup(fake)

    const result = await runSync()
    expect(result.pulled).toBe(1)
    expect((await listEntries()).map((entry) => entry.word)).toEqual(['zebra'])
  })

  // Two devices, one library: the deletion made here must reach the other one.
  it('pushes tombstones so a deletion propagates', async () => {
    const fake = fakeGitHub({ repoExists: true })
    await setup(fake)
    const { entry } = await seedWord('apple')
    await runSync()

    await removeEntry(entry.id)
    await runSync()

    const shard = JSON.parse(fake.state.files.get('vocabulary/a.json') ?? '[]') as Array<{
      word: string
      deletedAt: number | null
    }>
    expect(shard[0]?.word).toBe('apple')
    expect(shard[0]?.deletedAt).toBeTruthy()
    // The readable page is for a person; a deleted word is not worth reading.
    expect(fake.state.files.get('vocabulary/a.md')).not.toContain('### apple')
  })

  it('applies a remote deletion to the local library', async () => {
    // Explicitly *after* the local save below: "the other device deleted this
    // after my last edit" is the case that must win, and pinning the times
    // keeps the test from depending on which millisecond each line lands in.
    const deletedAt = Date.now() + 60_000
    const tombstone = remoteEntry('apple', { deletedAt, updatedAt: deletedAt })
    const fake = fakeGitHub({
      repoExists: true,
      files: { 'vocabulary/a.json': JSON.stringify([tombstone], null, 2) },
    })
    await setup(fake)
    await seedWord('apple')

    await runSync()
    expect((await listEntries()).map((item) => item.word)).toEqual([])
  })

  it('retries the whole merge when another device pushed first', async () => {
    const fake = fakeGitHub({ repoExists: true })
    await setup(fake)
    await seedWord('apple')

    // Reject the first ref update the way GitHub does for a non-fast-forward.
    let rejected = false
    const inner = fake.fetchImpl
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (!rejected && path.includes('/git/refs/heads/') && init?.method === 'PATCH') {
        rejected = true
        return new Response('{"message":"Update is not a fast forward"}', { status: 422 })
      }
      return inner(input, init)
    })

    const result = await runSync()
    expect(rejected).toBe(true)
    expect(result.changed).toBe(true)
    expect(fake.state.files.has('vocabulary/a.json')).toBe(true)
  })

  it('refuses to overwrite a remote shard it cannot parse', async () => {
    const fake = fakeGitHub({ repoExists: true, files: { 'vocabulary/a.json': 'not json {' } })
    await setup(fake)
    await seedWord('apple')

    await expect(runSync()).rejects.toBeInstanceOf(SyncError)
    expect(fake.state.files.get('vocabulary/a.json')).toBe('not json {')

    const state = await readSyncState()
    expect(state.outcome).toBe('failed')
    expect(state.errorCode).toBe('conflict')
  })

  /*
   * The two escape hatches from a real conflict. Both delete something, which is
   * exactly why they need tests: the failure mode is not "it did not work", it
   * is "it deleted the wrong side and nobody noticed until the words were gone".
   */
  it('forcePull drops local-only words and keeps everything the repo knows', async () => {
    const fake = fakeGitHub()
    await setup(fake)
    await seedWord('apple')
    await connectGitHub()
    await runSync()

    // This device then adds a word the repository has never seen.
    await seedWord('zebra')

    await runSync('forcePull')

    const left = (await listAllEntries()).filter((entry) => !entry.deletedAt)
    expect(left.map((entry) => entry.normalized).sort()).toEqual(['apple'])
    // Dropped, not tombstoned: a tombstone would push this deletion back out to
    // the other device, which is the opposite of "the remote wins".
    expect(await listAllEntries()).toHaveLength(1)
  })

  it('forcePull leaves the repository alone', async () => {
    const fake = fakeGitHub()
    await setup(fake)
    await seedWord('apple')
    await connectGitHub()
    await runSync()
    const commitsBefore = fake.state.commits.length

    await seedWord('zebra')
    await runSync('forcePull')

    expect(fake.state.commits).toHaveLength(commitsBefore)
  })

  it('forcePush commits local content without merging the remote in first', async () => {
    const fake = fakeGitHub()
    await setup(fake)
    await seedWord('apple')
    await connectGitHub()
    await runSync()

    // Another device pushes a word this one has never seen.
    fake.state.files.set(
      'vocabulary/q.json',
      `${JSON.stringify([remoteEntry('quokka')], null, 2)}\n`,
    )

    await seedWord('zebra')
    const result = await runSync('forcePush')

    expect(result.pulled).toBe(0)
    // The remote word never reached this device — that is what "local wins" means.
    const words = (await listAllEntries()).map((entry) => entry.normalized).sort()
    expect(words).toEqual(['apple', 'zebra'])
  })

  it('fails clearly when no token is configured', async () => {
    await saveSettings({
      sync: {
        enabled: true,
        token: '',
        owner: '',
        repo: 'vocab',
        branch: 'main',
        autoSync: false,
        intervalMinutes: 30,
      },
    })
    await expect(runSync()).rejects.toMatchObject({ code: 'no_token' })
  })
})

describe('GitHubClient errors', () => {
  it('distinguishes a missing scope from an exhausted rate limit (both are 403)', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response('{"message":"limit"}', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
    )
    await expect(new GitHubClient('t').getUser()).rejects.toMatchObject({ code: 'rate_limit' })

    vi.stubGlobal('fetch', async () => new Response('{"message":"scope"}', { status: 403 }))
    await expect(new GitHubClient('t').getUser()).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('maps 401 to an auth error', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"message":"Bad credentials"}', { status: 401 }))
    await expect(new GitHubClient('bad').getUser()).rejects.toMatchObject({ code: 'auth' })
  })
})
