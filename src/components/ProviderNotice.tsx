import { useToast } from './hooks.ts'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { sendMessage } from '@/services/messaging.ts'
import { storage } from '@/storage/area.ts'
import { PROVIDER_NOTICE_DISMISSED_KEY, PROVIDER_HEALTH_KEY, type ProviderHealth } from '@/shared/providerHealth.ts'
import { getSettings, isHostEnabled, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { DEFAULT_SETTINGS, PROVIDER_CATALOGUE, providerLabel, providerMeta, type Settings } from '@/types/settings.ts'
import { AIError, aiErrorMessage, type ProviderId } from '@/types/ai.ts'
import { isExtensionAlive, isOrphaned, noteOrphanError, onOrphaned } from '@/shared/extensionContext.ts'
import { BrandMark } from './icons.tsx'
import { useI18n } from '@/i18n/react.ts'

export function ProviderNotice({ inline = false }: { inline?: boolean }) {
  const { t } = useI18n()
  const [toast, showToast] = useToast()
  const [health, setHealth] = useState<ProviderHealth | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hidden, setHidden] = useState<string[]>([])
  const [dismissalsLoaded, setDismissalsLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(isOrphaned)
  const [menuOpen, setMenuOpen] = useState(false)
  const picker = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const failure = (cause: unknown) => {
    if (noteOrphanError(cause)) { setStale(true); setMenuOpen(false); setError(''); return }
    setError(cause instanceof AIError ? aiErrorMessage(cause.code) : t('provider.notice.action_failed'))
  }
  useEffect(() => {
    let alive = true, revision = 0
    const refresh = () => {
      const request = ++revision
      void sendMessage('provider/status', {}).then(({ health: next }) => { if (alive && request === revision) setHealth(next) }).catch(cause => { if (alive) failure(cause) })
    }
    void getSettings().then(value => { if (alive) setSettings(value) }).catch(cause => { if (alive) failure(cause) })
    const loadDismissals = (value: unknown) => { if (alive) { setHidden(Array.isArray(value) ? value : []); setDismissalsLoaded(true) } }
    void storage().get(PROVIDER_NOTICE_DISMISSED_KEY).then(loadDismissals).catch(() => loadDismissals([]))
    const undismiss = storage().watch(PROVIDER_NOTICE_DISMISSED_KEY, loadDismissals)
    refresh()
    const unwatch = storage().watch(PROVIDER_HEALTH_KEY, refresh)
    const unsettings = watchSettings(value => { setSettings(value); refresh() })
    const unorphan = onOrphaned(() => { setStale(true); setMenuOpen(false); setError('') })
    const checkContext = () => { if (!isExtensionAlive()) noteOrphanError(new Error('Extension context invalidated')) }
    window.addEventListener('focus', checkContext)
    document.addEventListener('visibilitychange', checkContext)
    return () => { alive = false; undismiss(); unwatch(); unsettings(); unorphan(); window.removeEventListener('focus', checkContext); document.removeEventListener('visibilitychange', checkContext) }
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    picker.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (picker.current && !event.composedPath().includes(picker.current)) setMenuOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menuOpen])
  const signature = health ? `${health.id}/${health.recovered ? 'recovered' : health.fallbackError ? `fallback:${health.fallback}:${health.fallbackError}` : 'outage'}` : ''
  const quietFallback = health?.fallback && !health.recovered && !health.fallbackError
  const feedback = toast ? <div role="status" aria-live="polite" style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 2147483647, maxWidth: 'calc(100vw - 40px)', padding: '12px 16px', borderRadius: 12, background: '#252932', color: '#fff', boxShadow: '0 4px 20px #17203325', font: '13px/1.5 system-ui, sans-serif' }}>{toast}</div> : null
  if (!health || !dismissalsLoaded || hidden.includes(signature) || (quietFallback && !stale) || (!inline && !isHostEnabled(settings, location.hostname))) return feedback
  const dismiss = () => {
    const next = [...hidden.filter(item => item !== signature), signature].slice(-40)
    setHidden(next); setMenuOpen(false)
    void storage().set(PROVIDER_NOTICE_DISMISSED_KEY, next).catch(failure)
  }
  const state = health
  const current = state.fallback ?? state.original
  const name = (id: ProviderId) => providerLabel(providerMeta(id))
  const model = (id: ProviderId) => id === 'google' || id === 'mock' ? '' : settings.providers[id].model.trim() || providerMeta(id).defaultModel
  const configured = PROVIDER_CATALOGUE.filter(meta => meta.id !== 'google' && meta.id !== 'mock' && !meta.hidden && settings.providers[meta.id].apiKey.trim())
  // Legacy custom endpoints remain selectable if already configured.
  if (settings.providers.custom.apiKey.trim()) configured.push(providerMeta('custom'))
  const choices = [providerMeta('google'), ...configured]
  const guard = () => {
    if (stale || !isExtensionAlive()) { noteOrphanError(new Error('Extension context invalidated')); setStale(true); setMenuOpen(false); return false }
    return true
  }
  const action = async (provider?: ProviderId) => {
    if (!guard()) return
    setBusy(true); setError(''); setMenuOpen(false)
    try {
      if (provider && provider !== state.original) await sendMessage('provider/use', { id: state.id, provider })
      else await sendMessage('provider/restore', { id: state.id })
      showToast(t(provider && provider !== state.original ? 'feedback.temporary' : 'feedback.restored', { name: name(provider ?? state.original) }))
      const next = await sendMessage('provider/status', {})
      setHealth(next.health)
      window.dispatchEvent(new Event('fanfan:provider-changed'))
    } catch (cause) { failure(cause) }
    finally { setBusy(false) }
  }
  const openSettings = async () => {
    if (!guard()) return
    setBusy(true); setError(''); setMenuOpen(false)
    try { await sendMessage('options/open', {}); showToast(t('feedback.opened')) } catch (cause) { failure(cause) }
    finally { setBusy(false) }
  }
  const keyboard = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); trigger.current?.focus(); return }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...(picker.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])]
    const index = items.indexOf(event.target as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }
  const button: CSSProperties = { border: '1px solid #dfe2e8', borderRadius: 9, background: '#fff', color: '#343842', padding: '8px 12px', cursor: busy ? 'wait' : 'pointer', font: 'inherit', fontSize: 12 }
  const failingId = state.fallbackError && state.fallback ? state.fallback : state.original
  const failingModel = failingId === state.original ? state.model : model(failingId)
  return <>{feedback}<aside aria-label={`${t('app.name')} · ${t('provider.notice.title')}`} style={{ ...(inline ? { marginBottom: 16 } : { position: 'fixed', right: 18, bottom: 18, zIndex: 2147483647 }), width: inline ? 'auto' : 352, maxWidth: 'calc(100vw - 36px)', boxSizing: 'border-box', padding: 16, borderRadius: 16, border: '1px solid #e4e6ec', background: '#fff', color: '#252932', boxShadow: '0 8px 32px #17203320', font: '13px/1.5 system-ui, sans-serif', pointerEvents: 'auto' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 650, marginBottom: 12 }}><BrandMark size={18} /><span>{t('app.name')}</span><span style={{ color: '#757c88', fontSize: 12, fontWeight: 400 }}>· {t('provider.notice.title')}</span></div>
    <div role="status" aria-live="polite">
      <strong>{stale ? t('provider.notice.updated') : state.recovered ? t('provider.notice.recovered') : t('provider.notice.failed', { provider: name(failingId) })}</strong>
      {!stale && <div style={{ fontFamily: 'ui-monospace, monospace', overflowWrap: 'anywhere', fontSize: 12, color: '#636b78', marginTop: 2 }}>{state.recovered ? `${name(state.original)} · ${state.model}` : failingModel}</div>}
      <p style={{ margin: '8px 0', fontSize: 12, color: '#606875' }}>{stale ? t('provider.notice.refresh_hint') : state.recovered ? t('provider.notice.restore_hint') : aiErrorMessage(state.fallbackError ?? state.code)}</p>
      {!stale && state.fallback && <div style={{ background: '#f5f6f8', borderRadius: 8, padding: '8px 10px', marginTop: 10, fontSize: 12 }}><span style={{ color: '#707786' }}>{t('provider.notice.current')} </span><strong>{name(current)}</strong><div style={{ color: '#707786', overflowWrap: 'anywhere' }}>{model(current) || t('provider.notice.google_hint')}</div></div>}
      {!stale && <p style={{ color: '#7b8290', margin: '10px 0 0', fontSize: 11 }}>{t(state.fallback ? 'provider.notice.monitoring' : 'provider.notice.choose_hint')}</p>}
    </div>
    {error && <div role="alert" style={{ color: '#a32c22', marginTop: 8 }}>{error}</div>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
      {stale ? <button style={button} onClick={() => location.reload()}>{t('card.action.reload')}</button> : <>
        {state.recovered && <button style={button} disabled={busy} onClick={() => void action()}>{t('provider.restore')}</button>}
        <div ref={picker} style={{ position: 'relative' }}>
          <button ref={trigger} style={{ ...button, background: '#fff2eb', borderColor: '#ffcbb7', color: '#a63d1b', fontWeight: 600 }} disabled={busy} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { if (guard()) setMenuOpen(!menuOpen) }}>{t('provider.notice.switch')} <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" style={{ marginLeft: 5, verticalAlign: 'middle', transform: (inline ? menuOpen : !menuOpen) ? 'rotate(180deg)' : undefined, transition: 'transform 150ms ease' }}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          {menuOpen && <div role="menu" aria-label={t('provider.notice.switch')} onKeyDown={keyboard} style={{ position: 'absolute', ...(inline ? { top: 'calc(100% + 8px)' } : { bottom: 'calc(100% + 8px)' }), left: 0, width: 284, maxWidth: 'calc(100vw - 70px)', maxHeight: 'min(320px, calc(100vh - 150px))', overflowY: 'auto', background: '#fff', border: '1px solid #e1e4ea', borderRadius: 12, boxShadow: '0 8px 28px #17203326', padding: 5, zIndex: 2 }}>
            {choices.map(meta => {
              const unavailable = meta.id === state.original && !state.recovered
              return <button key={meta.id} role="menuitemradio" aria-checked={meta.id === current} disabled={busy || unavailable || meta.id === current} onClick={() => void action(meta.id)} style={{ ...button, border: 0, textAlign: 'left', width: '100%', padding: '9px 10px', opacity: unavailable ? .5 : 1, background: meta.id === current ? '#f4f5f8' : '#fff' }}><span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}><strong>{name(meta.id)}</strong><span style={{ fontSize: 11 }}>{unavailable ? t('provider.notice.unavailable') : meta.id === current ? t('provider.notice.in_use') : ''}</span></span><span style={{ display: 'block', color: '#777f8b', fontSize: 11, overflowWrap: 'anywhere' }}>{model(meta.id) || t('provider.notice.google_hint')}</span></button>
            })}
            <button role="menuitem" disabled={busy} onClick={() => void openSettings()} style={{ ...button, width: '100%', border: 0, borderTop: '1px solid #eceef2', borderRadius: 0, textAlign: 'left', color: '#b34a26', marginTop: 4 }}>＋ {t('provider.notice.add')} ↗</button>
          </div>}
        </div>
      </>}
      <button style={{ ...button, borderColor: 'transparent', color: '#737b87' }} disabled={busy} onClick={dismiss}>{t(state.recovered ? 'provider.keep' : 'provider.dismiss')}</button>
    </div>
  </aside></>
}
