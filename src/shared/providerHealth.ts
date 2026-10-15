import type { AIErrorCode, ProviderId } from '@/types/ai.ts'
export const PROVIDER_HEALTH_KEY = 'ara:providerHealth'
/** Local-only runtime state. No keys, request text, or configuration snapshots. */
export interface ProviderHealth {
  id: string
  fingerprint: string
  selected: ProviderId
  original: ProviderId
  model: string
  code: AIErrorCode
  fallback: ProviderId | null
  fallbackError?: AIErrorCode
  recovered: boolean
  probeAt: number
  checkingUntil: number
}

export const PROVIDER_NOTICE_DISMISSED_KEY = 'ara:providerNoticeDismissed'
