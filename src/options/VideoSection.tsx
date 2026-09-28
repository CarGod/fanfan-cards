import { useEffect, useState } from 'react'
import { Field, SegmentedControl, Toggle } from '@/components/index.tsx'
import { useI18n } from '@/i18n/react.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { sourceLanguage, SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/shared/language.ts'
import { storage } from '@/storage/area.ts'
import type { Settings } from '@/types/settings.ts'

/**
 * 视频双语字幕。
 *
 * 这些开关在播放器上也能调（YouTube 的控制栏、其他站视频右上角的按钮），这里是同一份
 * 设置的另一个入口：读者想「先设好再看」，或者想知道为什么某支视频没开，得有个地方看。
 * 步进值和播放器菜单保持一致，两边改的是同一个数。
 */

/*
 * 表里存的是键，不是文案：模块加载时就求值了，放 `t()` 的结果会把语言冻在那一刻。
 */
const SIZES = [
  { value: '0.85', label: 'video.control.size_small' },
  { value: '1', label: 'video.control.size_normal' },
  { value: '1.25', label: 'video.control.size_large' },
] as const

const BACKGROUNDS = [
  { value: '0', label: 'video.control.background_none' },
  { value: '0.4', label: 'video.control.background_light' },
  { value: '0.7', label: 'video.control.background_medium' },
  { value: '0.9', label: 'video.control.background_dark' },
] as const

/** 设置里可能存着播放器菜单以外的值（旧版本、手改），显示时贴到最近的一档。 */
function nearest<T extends { value: string }>(steps: ReadonlyArray<T>, value: number): T['value'] {
  let best = steps[0]!
  for (const step of steps) {
    if (Math.abs(Number(step.value) - value) < Math.abs(Number(best.value) - value)) best = step
  }
  return best.value
}

export function VideoSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}) {
  const { t } = useI18n()
  const [sites, setSites] = useState<Record<string, string>>({})

  useEffect(() => {
    void storage()
      .get<Record<string, string>>(STORAGE_KEYS.videoSubtitleSelectors)
      .then((stored) => setSites(stored ?? {}))
      .catch(() => undefined)
  }, [])

  const forget = async (host: string): Promise<void> => {
    const next = { ...sites }
    delete next[host]
    setSites(next)
    await storage().set(STORAGE_KEYS.videoSubtitleSelectors, next).catch(() => undefined)
  }

  const source = sourceLanguage(settings.videoSubtitleSourceLanguage)
  const hosts = Object.keys(sites).sort()

  return (
    <>
      <section className="card section-card">
        <div className="section-title">{t('options.video.title')}</div>
        <div className="section-desc">{t('options.video.desc', { lang: t(source.labelKey) })}</div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('options.video.auto')}</div>
            <div className="faint">{t('options.video.auto_desc')}</div>
          </div>
          <Toggle
            checked={settings.videoSubtitleAuto}
            onChange={(next) => void update({ videoSubtitleAuto: next })}
            label={t('options.video.auto')}
          />
        </div>

        <Field label={t('video.control.source_language')}>
          <select className="input" value={settings.videoSubtitleSourceLanguage}
            aria-label={t('video.control.source_language')}
            onChange={(event) => void update({ videoSubtitleSourceLanguage: event.target.value })}>
            {SOURCE_LANGUAGES.filter((item) => item.code !== 'auto').map((item) => (
              <option key={item.code} value={item.code}>{t(item.labelKey)}</option>
            ))}
          </select>
        </Field>
        <Field label={t('video.control.target_language')}>
          <select className="input" value={settings.videoSubtitleTargetLanguage}
            aria-label={t('video.control.target_language')}
            onChange={(event) => void update({ videoSubtitleTargetLanguage: event.target.value })}>
            {TARGET_LANGUAGES.map((item) => (
              <option key={item.code} value={item.code}>{t(item.labelKey)}</option>
            ))}
          </select>
        </Field>

        <Field label={t('options.video.mode')}>
          <SegmentedControl
            value={settings.videoSubtitleMode}
            options={[
              { value: 'bilingual', label: t('video.control.mode_bilingual') },
              { value: 'translationOnly', label: t('video.control.mode_translation') },
            ]}
            onChange={(next) => void update({ videoSubtitleMode: next })}
          />
        </Field>

        <Field label={t('options.video.size')}>
          <SegmentedControl
            value={nearest(SIZES, settings.videoSubtitleFontScale)}
            options={SIZES.map((step) => ({ value: step.value, label: t(step.label) }))}
            onChange={(next) => void update({ videoSubtitleFontScale: Number(next) })}
          />
        </Field>

        <Field label={t('options.video.background')} hint={t('options.video.background_hint')}>
          <SegmentedControl
            value={nearest(BACKGROUNDS, settings.videoSubtitleBackground)}
            options={BACKGROUNDS.map((step) => ({ value: step.value, label: t(step.label) }))}
            onChange={(next) => void update({ videoSubtitleBackground: Number(next) })}
          />
        </Field>
      </section>

      <section className="card section-card">
        <div className="section-title">{t('options.video.sites.title')}</div>
        <div className="section-desc">{t('options.video.sites.desc')}</div>
        {hosts.length === 0 ? (
          <div className="faint">{t('options.video.sites.empty')}</div>
        ) : (
          <div className="stack">
            {hosts.map((host) => (
              <div key={host} className="row-between">
                <div>
                  <div style={{ fontWeight: 600 }}>{host}</div>
                  <div className="faint" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                    {sites[host]}
                  </div>
                </div>
                <button className="btn btn-sm" onClick={() => void forget(host)}>
                  {t('options.video.sites.forget')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}
