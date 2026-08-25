/** Contracts for syncing the knowledge base to a Git host. */

export type SyncErrorCode =
  | 'no_token'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'conflict'
  | 'stale_head'
  | 'network'
  | 'timeout'
  | 'unknown'

export class SyncError extends Error {
  readonly code: SyncErrorCode
  readonly status?: number

  constructor(code: SyncErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'SyncError'
    this.code = code
    if (status !== undefined) this.status = status
  }
}

export const SYNC_ERROR_MESSAGES: Record<SyncErrorCode, string> = {
  no_token: '还没有填写 GitHub Token',
  auth: 'Token 无效或已过期，请重新生成',
  forbidden: 'Token 权限不足：需要能创建仓库并读写内容（classic token 勾选 repo）',
  not_found: '找不到该仓库，或 Token 没有访问它的权限',
  rate_limit: 'GitHub 接口调用过于频繁，请稍后再试',
  conflict: '远端在同步过程中被改动了，请再同步一次',
  stale_head: '另一台设备刚刚推送过，正在基于最新内容重试',
  network: '无法连接 GitHub，请检查网络或代理',
  timeout: '连接 GitHub 超时',
  unknown: 'GitHub 同步失败',
}

/** Files the extension owns in the user's repository. */
export const SYNC_FILES = {
  /** Canonical machine-readable state; this is what import reads back. */
  snapshot: 'vocabulary.json',
  /** Human-readable listing, so each commit diff shows what was learned. */
  markdown: 'VOCABULARY.md',
  /** Repo landing page with the current stats. */
  readme: 'README.md',
} as const

export type SyncOutcome = 'synced' | 'up_to_date' | 'failed'

export interface SyncState {
  /** Epoch ms of the last attempt, successful or not. */
  lastAttemptAt: number
  lastSuccessAt: number
  outcome: SyncOutcome | 'never'
  /** Human-readable error from the last failure, if any. */
  error: string
  errorCode: SyncErrorCode | ''
  /** `owner/repo` actually written to. */
  repoFullName: string
  repoUrl: string
  /** Counts as of the last successful sync. */
  entriesPushed: number
  entriesPulled: number
}

export const EMPTY_SYNC_STATE: SyncState = {
  lastAttemptAt: 0,
  lastSuccessAt: 0,
  outcome: 'never',
  error: '',
  errorCode: '',
  repoFullName: '',
  repoUrl: '',
  entriesPushed: 0,
  entriesPulled: 0,
}
