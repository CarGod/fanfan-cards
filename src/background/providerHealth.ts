import { resolveProvider, type ResolvedProvider } from '@/ai/index.ts'
import { AIError, type AIErrorCode, type AIProvider, type ProviderId } from '@/types/ai.ts'
import { type Settings } from '@/types/settings.ts'
import { getSettings, saveSettings } from '@/storage/repositories/settingsRepo.ts'
import { storage } from '@/storage/area.ts'
import { withLock } from '@/storage/mutex.ts'
import { PROVIDER_HEALTH_KEY as KEY, type ProviderHealth } from '@/shared/providerHealth.ts'
import { t } from '@/i18n/index.ts'

const probes = new Map<string, Promise<void>>()
const successes = new Map<string, number>()
const PROBE_MS = 20_000

async function fingerprint(settings: Settings, id = settings.provider): Promise<string> {
  const config = id === 'mock' || id === 'google' ? {} : settings.providers[id]
  const bytes = new TextEncoder().encode(JSON.stringify([id, config]))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
}

export async function currentHealth(settings?: Settings): Promise<ProviderHealth | null> {
  const current = await getSettings()
  if (settings && settings.provider !== current.provider) return null
  return withLock(KEY, async () => {
    const state = await storage().get<ProviderHealth>(KEY)
    if (!state) return null
    if (state.fingerprint !== await fingerprint(current, state.original)) {
      await storage().remove(KEY)
      return null
    }
    // A settings selection is permanent; only provider/use creates a temporary fallback.
    if (current.provider !== state.original) {
      await storage().remove(KEY)
      return null
    }
    return state
  })
}

function failureCode(error: unknown): AIErrorCode | null {
  if (error instanceof AIError) {
    return ['aborted', 'stale_context', 'refused'].includes(error.code) ? null : error.code
  }
  // A malformed model result is also a service failure; do not store its text.
  return error instanceof Error && error.name === 'ZodError' ? 'bad_response' : null
}

async function record(settings: Settings, provider: AIProvider, error: unknown, started: number, success: boolean): Promise<void> {
  if (!provider.id || ['google', 'mock'].includes(provider.id)) return
  const code = success ? null : failureCode(error)
  if (!success && !code) return
  await withLock(KEY, async () => {
    const state = await storage().get<ProviderHealth>(KEY)
    const original = state?.original ?? settings.provider
    const key = await fingerprint(settings, original)
    const currentSettings = await getSettings()
    if ((currentSettings.provider !== settings.provider) || await fingerprint(currentSettings, original) !== key) return
    if (state?.fingerprint === key && state.fallback === provider.id) {
      const next = { ...state }
      if (success) delete next.fallbackError
      else next.fallbackError = code!
      await storage().set(KEY, next)
      return
    }
    if (provider.id !== original) return
    if (success) {
      successes.set(key, Date.now())
      if (state?.fingerprint === key) {
        if (state.fallback) await storage().set(KEY, { ...state, recovered: true, probeAt: Date.now() + 1, checkingUntil: 0 })
        else await storage().remove(KEY)
      }
    } else if ((successes.get(key) ?? 0) <= started && !state?.fallback) {
      await storage().set<ProviderHealth>(KEY, {
        id: state?.fingerprint === key ? state.id : crypto.randomUUID(), fingerprint: key,
        original: provider.id, selected: settings.provider, model: provider.model, code: code!,
        fallback: null, recovered: false, probeAt: 0, checkingUntil: 0,
      })
    }
  })
}

function tracked(settings: Settings, resolved: ResolvedProvider): ResolvedProvider {
  const provider = new Proxy(resolved.provider, {
    get(target, property) {
      const value = Reflect.get(target, property)
      if (typeof value !== 'function') return value
      return async (...args: unknown[]) => {
        const started = Date.now()
        try {
          const result = await value.apply(target, args)
          await record(settings, target, null, started, true).catch(() => undefined)
          return result
        } catch (error) {
          await record(settings, target, error, started, false).catch(() => undefined)
          throw error
        }
      }
    },
  })
  return { ...resolved, provider }
}

/** Called for every translation, including cache hits; never waits for a probe. */
export async function resolveForTranslation(settings: Settings, preferred = false): Promise<ResolvedProvider> {
  const state = await currentHealth(settings)
  if (state?.fallback && !preferred) {
    void checkRecovery(settings, state).catch(() => undefined)
    const resolved = resolveProvider({ ...settings, provider: state.fallback })
    // Google cannot correct transcripts; retain local ASR and translate text only.
    if (resolved.provider.id === 'google') {
      const google = resolved.provider
      google.refineTranscript = async (input, signal) => ({ original: input.text, translation: (await google.translate({ text: input.text, targetLanguage: input.targetLanguage }, signal)).translation })
    }
    return tracked(settings, resolved)
  }
  return tracked(settings, resolveProvider(settings))
}

async function checkRecovery(settings: Settings, state: ProviderHealth): Promise<void> {
  if (state.recovered) return
  if (probes.has(state.id)) return probes.get(state.id)
  const task = probe(settings, state).finally(() => probes.delete(state.id))
  probes.set(state.id, task)
  return task
}

async function probe(settings: Settings, state: ProviderHealth): Promise<void> {
  const probeAt = Date.now()
  const permitted = await withLock(KEY, async () => {
    const current = await storage().get<ProviderHealth>(KEY)
    if (current?.id !== state.id || !current.fallback || current.checkingUntil > probeAt) return false
    await storage().set(KEY, { ...current, probeAt, checkingUntil: probeAt + PROBE_MS + 1000 })
    return true
  })
  if (!permitted) return
  let recovered = false
  try {
    const resolved = resolveProvider({ ...settings, provider: state.original })
    if (resolved.downgradeReason || resolved.provider.id !== state.original) return
    const answer = await resolved.provider.translate({ text: 'Hello', targetLanguage: '简体中文' }, AbortSignal.timeout(PROBE_MS))
    recovered = !!answer.translation?.trim() && answer.translation.trim().toLowerCase() !== 'hello'
  } catch { /* Keep the temporary provider when the original is still unhealthy. */ }
  finally {
    await withLock(KEY, async () => {
      const current = await storage().get<ProviderHealth>(KEY)
      if (current?.id !== state.id || current.probeAt !== probeAt || current.fallback !== state.fallback) return
      if (await fingerprint(await getSettings(), state.original) !== state.fingerprint) return
      await storage().set(KEY, { ...current, recovered, checkingUntil: 0 })
    })
  }
}

export async function useTemporaryProvider(id: string, provider: ProviderId): Promise<{ ok: true }> {
  const settings = await getSettings()
  const state = await currentHealth(settings)
  if (!state || state.id !== id || provider === state.original || provider === 'mock') throw new Error(t('provider.stale'))
  const resolved = resolveProvider({ ...settings, provider })
  if (resolved.downgradeReason || resolved.provider.id !== provider) throw new Error(resolved.downgradeReason ?? t('provider.stale'))
  await withLock(KEY, async () => {
    const current = await storage().get<ProviderHealth>(KEY)
    if (current?.id !== id || await fingerprint(await getSettings(), state.original) !== state.fingerprint) throw new Error(t('provider.stale'))
    await storage().set(KEY, { ...current, fallback: provider, fallbackError: undefined, recovered: false, checkingUntil: 0 })
  })
  return { ok: true }
}

export async function restoreProvider(id: string): Promise<{ ok: true }> {
  const state = await currentHealth()
  if (!state || state.id !== id || !state.recovered) throw new Error(t('provider.stale'))
  await withLock(KEY, async () => {
    const current = await storage().get<ProviderHealth>(KEY)
    if (current?.id !== id || !current.recovered || await fingerprint(await getSettings(), state.original) !== state.fingerprint) throw new Error(t('provider.stale'))
    if ((await getSettings()).provider !== state.original) await saveSettings({ provider: state.original })
    await storage().remove(KEY)
  })
  return { ok: true }
}
