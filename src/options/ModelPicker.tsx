import { useState } from 'react'
import { useI18n } from '@/i18n/react.ts'

/** Presets stay visible even when one is selected; arbitrary model IDs remain supported. */
export function ModelPicker({ value, defaultModel, suggestions, onChange }: {
  value: string; defaultModel: string; suggestions: string[]; onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const [custom, setCustom] = useState(false)
  const effective = value.trim() || defaultModel
  const isCustom = custom || !suggestions.includes(effective)
  return <>
    <select aria-label={t('options.model.model')} value={isCustom ? '' : effective} onChange={event => {
      const next = event.target.value
      setCustom(!next)
      if (next) onChange(next)
    }}>
      {suggestions.map(model => <option key={model} value={model}>{model}</option>)}
      <option value="">{t('options.model.custom')}</option>
    </select>
    {isCustom && <input aria-label={t('options.model.custom_name')} type="text" value={value} placeholder={defaultModel} onChange={event => onChange(event.target.value)} />}
  </>
}
