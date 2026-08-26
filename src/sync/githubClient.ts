import { SyncError, type SyncErrorCode } from '@/types/sync.ts'
import { t } from '@/i18n/index.ts'

/**
 * The slice of the GitHub REST API this product needs — five calls.
 *
 * Everything goes through `api.github.com`, which is fully CORS-enabled, so the
 * service worker can talk to it directly with no proxy of ours in the middle.
 * The token never leaves the worker.
 */

const API = 'https://api.github.com'
const TIMEOUT_MS = 20_000

export interface GitHubUser {
  login: string
}

export interface GitHubRepo {
  name?: string
  full_name: string
  html_url: string
  default_branch: string
  private: boolean
  description?: string | null
}

export interface RemoteFile {
  text: string
  sha: string
}

/** One entry of a recursive git tree listing. */
export interface TreeEntry {
  path: string
  sha: string
  type: string
}

export interface CommitFile {
  path: string
  /** `null` deletes the path from the new tree. */
  text: string | null
}

export class GitHubClient {
  private readonly token: string

  constructor(token: string) {
    if (!token.trim()) throw new SyncError('no_token', 'GitHub token is empty')
    this.token = token.trim()
  }

  async getUser(signal?: AbortSignal): Promise<GitHubUser> {
    return this.request<GitHubUser>('GET', '/user', undefined, signal)
  }

  /** Owned repositories, newest activity first — one page is plenty to find ours. */
  async listRepos(signal?: AbortSignal): Promise<GitHubRepo[]> {
    return this.request<GitHubRepo[]>(
      'GET',
      '/user/repos?per_page=100&sort=updated&affiliation=owner',
      undefined,
      signal,
    )
  }

  async getRepo(owner: string, repo: string, signal?: AbortSignal): Promise<GitHubRepo | null> {
    try {
      return await this.request<GitHubRepo>('GET', `/repos/${owner}/${repo}`, undefined, signal)
    } catch (error) {
      if (error instanceof SyncError && error.code === 'not_found') return null
      throw error
    }
  }

  /**
   * `auto_init` matters: without an initial commit the repository has no
   * default branch, and the Contents API then has nothing to write against.
   */
  async createRepo(name: string, description: string, signal?: AbortSignal): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(
      'POST',
      '/user/repos',
      { name, description, private: true, auto_init: true },
      signal,
    )
  }

  async getFile(
    owner: string,
    repo: string,
    path: string,
    branch: string,
    signal?: AbortSignal,
  ): Promise<RemoteFile | null> {
    try {
      const response = await this.request<{ content?: string; sha: string; encoding?: string }>(
        'GET',
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
        undefined,
        signal,
      )
      return { text: response.content ? decodeBase64(response.content) : '', sha: response.sha }
    } catch (error) {
      if (error instanceof SyncError && error.code === 'not_found') return null
      throw error
    }
  }

  /**
   * Create-or-update. GitHub requires the current blob `sha` to overwrite an
   * existing file; a 409/422 means someone else wrote in between, so we refetch
   * the sha once and retry rather than failing the whole sync.
   */
  async putFile(args: {
    owner: string
    repo: string
    path: string
    branch: string
    text: string
    message: string
    signal?: AbortSignal | undefined
  }): Promise<void> {
    const existing = await this.getFile(args.owner, args.repo, args.path, args.branch, args.signal)
    if (existing && existing.text === args.text) return // nothing changed, no empty commit

    const write = async (sha: string | undefined) => {
      await this.request(
        'PUT',
        `/repos/${args.owner}/${args.repo}/contents/${encodeURIComponent(args.path)}`,
        {
          message: args.message,
          content: encodeBase64(args.text),
          branch: args.branch,
          ...(sha ? { sha } : {}),
        },
        args.signal,
      )
    }

    try {
      await write(existing?.sha)
    } catch (error) {
      if (!(error instanceof SyncError) || error.code !== 'conflict') throw error
      const fresh = await this.getFile(args.owner, args.repo, args.path, args.branch, args.signal)
      await write(fresh?.sha)
    }
  }

  // --- Git Data API -------------------------------------------------------
  //
  // The Contents API writes one file per commit, which is fine for three files
  // and absurd for thirty: a sharded knowledge base would produce a commit per
  // shard per sync and bury the learning history it exists to show. The Git
  // Data API builds one tree and one commit no matter how many files change.

  async getHeadSha(owner: string, repo: string, branch: string, signal?: AbortSignal): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      undefined,
      signal,
    )
    return ref.object.sha
  }

  /** Flat listing of every blob in the commit, with its git sha. */
  async listTree(
    owner: string,
    repo: string,
    commitSha: string,
    signal?: AbortSignal,
  ): Promise<TreeEntry[]> {
    const tree = await this.request<{ tree?: TreeEntry[]; truncated?: boolean }>(
      'GET',
      `/repos/${owner}/${repo}/git/trees/${commitSha}?recursive=1`,
      undefined,
      signal,
    )
    return (tree.tree ?? []).filter((entry) => entry.type === 'blob')
  }

  /** Reads a blob by sha — no 1MB ceiling, unlike the Contents API. */
  async readBlob(owner: string, repo: string, sha: string, signal?: AbortSignal): Promise<string> {
    const blob = await this.request<{ content: string; encoding: string }>(
      'GET',
      `/repos/${owner}/${repo}/git/blobs/${sha}`,
      undefined,
      signal,
    )
    return blob.encoding === 'base64' ? decodeBase64(blob.content) : blob.content
  }

  /**
   * Commits any number of files at once. Returns false when nothing changed,
   * so an unchanged sync produces no empty commit.
   */
  async commitFiles(args: {
    owner: string
    repo: string
    branch: string
    message: string
    files: CommitFile[]
    /**
     * The commit the caller's merge was computed against.
     *
     * Reading HEAD again here would compare-and-swap against a different commit
     * from the one the diff was built on: anything another device pushed in
     * between would be committed *over* rather than merged, and the ref update
     * would succeed — so the run would report success while quietly discarding
     * the other device's words. Passing it in makes the check mean what the
     * caller thinks it means.
     */
    expectedHead?: string
    signal?: AbortSignal | undefined
  }): Promise<boolean> {
    if (args.files.length === 0) return false

    const head =
      args.expectedHead ??
      (await this.getHeadSha(args.owner, args.repo, args.branch, args.signal))

    const tree = await Promise.all(
      args.files.map(async (file) => {
        if (file.text === null) {
          return { path: file.path, mode: '100644', type: 'blob', sha: null }
        }
        const blob = await this.request<{ sha: string }>(
          'POST',
          `/repos/${args.owner}/${args.repo}/git/blobs`,
          { content: encodeBase64(file.text), encoding: 'base64' },
          args.signal,
        )
        return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha }
      }),
    )

    const created = await this.request<{ sha: string }>(
      'POST',
      `/repos/${args.owner}/${args.repo}/git/trees`,
      { base_tree: head, tree },
      args.signal,
    )

    const commit = await this.request<{ sha: string }>(
      'POST',
      `/repos/${args.owner}/${args.repo}/git/commits`,
      { message: args.message, tree: created.sha, parents: [head] },
      args.signal,
    )

    try {
      await this.request(
        'PATCH',
        `/repos/${args.owner}/${args.repo}/git/refs/heads/${encodeURIComponent(args.branch)}`,
        { sha: commit.sha },
        args.signal,
      )
    } catch (error) {
      // Another device pushed between our tree read and this update. GitHub
      // refuses the non-fast-forward, which is exactly right — our commit was
      // built on a parent that is no longer the tip, so landing it would drop
      // whatever they just pushed. Surface it as retryable.
      if (error instanceof SyncError && (error.code === 'conflict' || error.status === 422)) {
        throw new SyncError('stale_head', t('error.sync.head_moved'), 422)
      }
      throw error
    }
    return true
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const signals: AbortSignal[] = [AbortSignal.timeout(TIMEOUT_MS)]
    if (signal) signals.push(signal)

    let response: Response
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any(signals),
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new SyncError('timeout', 'GitHub request timed out')
      }
      throw new SyncError('network', error instanceof Error ? error.message : String(error))
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new SyncError(statusToCode(response, detail), summarise(detail, response.status), response.status)
    }

    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }
}

function statusToCode(response: Response, detail: string): SyncErrorCode {
  const status = response.status
  if (status === 401) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422 && /sha|does not match|already exists|fast forward/i.test(detail)) {
    return 'conflict'
  }
  if (status === 403) {
    // GitHub returns 403 both for "out of quota" and for "token lacks scope".
    return response.headers.get('x-ratelimit-remaining') === '0' ? 'rate_limit' : 'forbidden'
  }
  if (status === 429) return 'rate_limit'
  if (status >= 500) return 'network'
  return 'unknown'
}

function summarise(detail: string, status: number): string {
  try {
    const parsed = JSON.parse(detail) as { message?: string; errors?: Array<{ message?: string }> }
    const extra = parsed.errors?.map((item) => item.message).filter(Boolean).join('; ')
    return `HTTP ${status}: ${parsed.message ?? ''}${extra ? ` (${extra})` : ''}`.trim()
  } catch {
    return `HTTP ${status}: ${detail.slice(0, 200)}`
  }
}

/**
 * Git's own content hash: `sha1("blob <byteLength>\0" + content)`.
 *
 * Computing it locally means a push can tell which files actually changed by
 * comparing against the remote tree listing — one request for the whole repo
 * instead of one GET per file, and no upload for files that already match.
 */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const header = new TextEncoder().encode(`blob ${body.length}\0`)
  const payload = new Uint8Array(header.length + body.length)
  payload.set(header)
  payload.set(body, header.length)

  const digest = await crypto.subtle.digest('SHA-1', payload)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** UTF-8 safe base64, which `btoa` alone is not. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBase64(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
