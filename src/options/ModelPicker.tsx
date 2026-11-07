import { useEffect, useId, useState } from 'react'
import { useI18n } from '@/i18n/react.ts'
import type { ProviderConfig, Settings } from '@/types/settings.ts'
import { useModelDiscovery } from './useModelDiscovery.ts'

/** Presets stay visible even when one is selected; arbitrary model IDs remain supported. */
export function ModelPicker({ value, defaultModel, suggestions, onChange, provider, config }: {
  value: string; defaultModel: string; suggestions: string[]; onChange: (value: string) => void
  provider?: keyof Settings['providers']; config?: ProviderConfig
}) {
  const { t } = useI18n()
  const discovery = useModelDiscovery(provider, config)
  const descriptionId = useId()
  const [custom, setCustom] = useState(false)
  const [search, setSearch] = useState('')
  useEffect(() => { setSearch(''); setCustom(false) }, [provider, config?.apiKey, config?.baseUrl])
  const effective = value.trim() || defaultModel
  const query = search.trim().toLocaleLowerCase()
  const discoveredNames = new Map(discovery.models.map(model => [model.id, model.name ?? '']))
  const presets = suggestions.filter(model => `${model} ${discoveredNames.get(model) ?? ''}`.toLocaleLowerCase().includes(query))
  const candidates = discovery.models.filter(model => !suggestions.includes(model.id)
    && `${model.id} ${model.name ?? ''}`.toLocaleLowerCase().includes(query))
  const knownModel = suggestions.includes(effective) || discovery.models.some(model => model.id === effective)
  const isCustom = custom || !knownModel
  const pinned = effective && !presets.includes(effective) && !candidates.some(model => model.id === effective)
  return <div style={{ display: 'grid', gap: 8 }}>
    {discovery.available && <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={discovery.status === 'loading'} onClick={() => void discovery.fetchModels()}>
          {t(discovery.status === 'loading' ? 'options.model.discovery.loading' : discovery.fetchedAt !== null ? 'options.model.discovery.refresh' : 'options.model.discovery.fetch')}
        </button>
        {discovery.status === 'loading' && <button type="button" className="btn" onClick={discovery.cancel}>{t('options.model.discovery.cancel')}</button>}
      </div>
      <input type="search" aria-label={t('options.model.discovery.search')} placeholder={t('options.model.discovery.search')} value={search} onChange={event => setSearch(event.target.value)} />
    </>}
    <select aria-label={t('options.model.model')} aria-describedby={discovery.available ? descriptionId : undefined} value={custom || !effective ? '' : effective} onChange={event => {
      const next = event.target.value
      setCustom(!next)
      if (next) onChange(next)
    }}>
      {pinned && <optgroup label={t('options.model.discovery.current')}><option value={effective}>
        {effective}{knownModel && !suggestions.includes(effective) ? ` · ${t('options.model.discovery.untested')}` : ''}
      </option></optgroup>}
      {presets.length > 0 && <optgroup label={t('options.model.discovery.builtin')}>
        {presets.map(model => <option key={model} value={model}>{model}</option>)}
      </optgroup>}
      {candidates.length > 0 && <optgroup label={t('options.model.discovery.candidates')}>
        {candidates.map(model => <option key={model.id} value={model.id}>
          {model.id}{model.name && model.name !== model.id ? ` (${model.name})` : ''} · {t('options.model.discovery.untested')}
        </option>)}
      </optgroup>}
      <option value="">{t('options.model.custom')}</option>
    </select>
    {isCustom && <input aria-label={t('options.model.custom_name')} type="text" value={value} placeholder={defaultModel} onChange={event => onChange(event.target.value)} />}
    {discovery.available && <>
      {query && presets.length + candidates.length === 0 && <div className="faint">{t('options.model.discovery.no_match')}</div>}
      <div id={descriptionId} className="field-hint" style={{ marginTop: 0 }}>{t('options.model.discovery.hint')}</div>
      <div role="status" aria-live="polite" aria-atomic="true" className="field-hint" style={{ marginTop: 0 }}>
        {discovery.status === 'loading' ? t('options.model.discovery.loading')
          : discovery.status === 'ready' ? t('options.model.discovery.loaded', { count: discovery.models.length })
          : discovery.status === 'cancelled' ? t('options.model.discovery.cancelled')
          : discovery.error ? t(discovery.error) : null}
        {discovery.status === 'error' && discovery.fetchedAt !== null && <> {t('options.model.discovery.retained')}</>}
      </div>
    </>}
  </div>
}
