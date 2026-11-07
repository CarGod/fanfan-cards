import { useEffect, useMemo, useState } from 'react'
import { discoverModels, DiscoveryError, modelDiscoveryEndpoint, type DiscoveredModel } from '@/ai/modelDiscovery.ts'
import { requestOptionalApiAccess } from '@/ai/hostPermission.ts'
import type { MessageKey } from '@/i18n/index.ts'
import type { ProviderConfig, Settings } from '@/types/settings.ts'

type Provider = keyof Settings['providers']
type Session = { controller: AbortController | null }
type Snapshot = {
  session: Session
  models: DiscoveredModel[]
  fetchedAt: number | null
  status: 'idle' | 'loading' | 'ready' | 'error' | 'cancelled'
  error: MessageKey | null
}

const empty = (session: Session): Snapshot => ({ session, models: [], fetchedAt: null, status: 'idle', error: null })

/** Never render provider response text, URLs or credentials as an error. */
function errorMessage(error: unknown): MessageKey {
  if (!(error instanceof DiscoveryError)) return 'options.model.discovery.error.network'
  switch (error.code) {
    case 'invalid_config': return 'options.model.discovery.error.config'
    case 'no_api_key': return 'options.model.discovery.error.key'
    case 'auth': return 'options.model.discovery.error.auth'
    case 'rate_limit': return 'options.model.discovery.error.rate_limit'
    case 'unsupported': return 'options.model.discovery.error.unsupported'
    case 'empty': return 'options.model.discovery.error.empty'
    case 'timeout': return 'options.model.discovery.error.timeout'
    case 'bad_response':
    case 'limit': return 'options.model.discovery.error.response'
    case 'redirect': return 'options.model.discovery.error.redirect'
    default: return 'options.model.discovery.error.network'
  }
}

/**
 * A single in-memory list belongs to an opaque config session, never a key-based
 * cache. Model selection does not invalidate it; provider/key/base changes do.
 * Only the click handler can request permission or fetch anything.
 */
export function useModelDiscovery(provider?: Provider, config?: ProviderConfig) {
  const session = useMemo<Session>(() => ({ controller: null }), [provider, config?.apiKey, config?.baseUrl])
  const [snapshot, setSnapshot] = useState<Snapshot>(() => empty(session))
  // Hide old results during the very first render of a different configuration.
  const state = snapshot.session === session ? snapshot : empty(session)

  useEffect(() => () => {
    session.controller?.abort()
    session.controller = null
  }, [session])

  const cancel = () => {
    session.controller?.abort()
    session.controller = null
    setSnapshot(previous => ({ ...(previous.session === session ? previous : empty(session)), status: 'cancelled', error: null }))
  }

  const fetchModels = async () => {
    if (!provider || !config || session.controller) return
    const controller = new AbortController()
    session.controller = controller
    const isCurrent = () => session.controller === controller && !controller.signal.aborted
    const update = (patch: Partial<Snapshot>) => {
      if (isCurrent()) setSnapshot(previous => ({ ...(previous.session === session ? previous : empty(session)), ...patch }))
    }
    update({ status: 'loading', error: null })
    try {
      // Synchronous validation and permission request preserve the user gesture.
      const endpoint = modelDiscoveryEndpoint(provider, config)
      if (provider !== 'custom' && !config.apiKey.trim()) {
        update({ status: 'error', error: 'options.model.discovery.error.key' })
        return
      }
      // MiMo is not in the manifest's required hosts. Do not broaden that list.
      if (provider === 'custom' || provider === 'mimo' || config.baseUrl.trim()) {
        try {
          await requestOptionalApiAccess(endpoint)
        } catch {
          update({ status: 'error', error: 'options.model.discovery.error.permission' })
          return
        }
      }
      if (!isCurrent()) return
      const result = await discoverModels(provider, config, { signal: controller.signal })
      update({ models: result.models, fetchedAt: result.fetchedAt, status: 'ready', error: null })
    } catch (error) {
      if (error instanceof DiscoveryError && error.code === 'aborted') {
        update({ status: 'cancelled', error: null })
      } else {
        update({ status: 'error', error: errorMessage(error) })
      }
    } finally {
      if (session.controller === controller) session.controller = null
    }
  }

  return { ...state, fetchModels, cancel, available: Boolean(provider && config) }
}
