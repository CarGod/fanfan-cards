/** Contracts for syncing the knowledge base to a Git host. */

import { t, type MessageKey } from '@/i18n/index.ts'

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

/**
 * 同上（见 `types/ai.ts`）：表里存键，取文案是函数。常量表会把语言冻结在模块
 * 加载那一刻，之后用户改设置就不生效了。
 */
const SYNC_ERROR_KEYS: Record<SyncErrorCode, MessageKey> = {
  no_token: 'error.sync.no_token',
  auth: 'error.sync.auth',
  forbidden: 'error.sync.forbidden',
  not_found: 'error.sync.not_found',
  rate_limit: 'error.sync.rate_limit',
  conflict: 'error.sync.conflict',
  stale_head: 'error.sync.stale_head',
  network: 'error.sync.network',
  timeout: 'error.sync.timeout',
  unknown: 'error.sync.unknown',
}

export function syncErrorMessage(code: SyncErrorCode): string {
  return t(SYNC_ERROR_KEYS[code] ?? SYNC_ERROR_KEYS.unknown)
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
