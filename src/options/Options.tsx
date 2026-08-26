import { useEffect, useRef, useState } from 'react'
import { Field, SegmentedControl, Select, Toggle } from '@/components/index.tsx'
import { BrandMark } from '@/components/icons.tsx'
import { useEntries, useSettings, useToast } from '@/components/hooks.ts'
import { resolveProvider } from '@/ai/index.ts'
import { requestOptionalApiAccess } from '@/ai/hostPermission.ts'
import { AIError, aiErrorMessage } from '@/types/ai.ts'
import {
  PROVIDER_CATALOGUE,
  providerLabel,
  providerMeta,
  type ProviderConfig,
} from '@/types/settings.ts'
import { clearCache } from '@/storage/repositories/cacheRepo.ts'
import { clearTranslationCache } from '@/storage/repositories/translationCacheRepo.ts'
import { replaceAll } from '@/storage/repositories/vocabularyRepo.ts'
import {
  buildSnapshot,
  downloadText,
  importSnapshot,
  snapshotFilename,
} from '@/services/exportService.ts'
import { useI18n } from '@/i18n/react.ts'
import { UI_LANGUAGES, type MessageKey, type UiLanguage } from '@/i18n/index.ts'
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/shared/language.ts'
import { SyncSection } from './SyncSection.tsx'
import { ReviewSection } from './ReviewSection.tsx'
import { ShortcutSection } from './ShortcutSection.tsx'
import { truncate } from '@/shared/utils.ts'

type Category = 'model' | 'reading' | 'review' | 'shortcut' | 'sync' | 'data'

// 存键而不是存文案：这个常量在模块加载时就求值了，那时用户的语言偏好还没读出来。
// 真正的取词推迟到渲染里的 `t(item.labelKey)`，切换语言才跟得上。
const CATEGORIES: ReadonlyArray<{ id: Category; labelKey: MessageKey }> = [
  { id: 'model', labelKey: 'options.nav.model' },
  { id: 'reading', labelKey: 'options.nav.reading' },
  { id: 'review', labelKey: 'options.nav.review' },
  { id: 'shortcut', labelKey: 'options.nav.shortcut' },
  { id: 'sync', labelKey: 'options.nav.sync' },
  { id: 'data', labelKey: 'options.nav.data' },
]

type TestState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'ok'; word: string; contextMeaning: string; model: string }
  | { kind: 'fail'; message: string }

/**
 * Sentences for the connection test.
 *
 * Two jobs, and the second one is why these are not arbitrary nice quotes.
 * A test that asks about a word with one obvious meaning only proves the
 * network call worked; it proves nothing about the thing this product exists
 * for. Every line below hinges on a word whose meaning here is *not* its
 * dictionary meaning — water as adaptability, `fell` as a verb rather than the
 * past tense of fall, roots and mother as metaphors. If the model comes back
 * with 「水」 instead of 「像水一样顺应形势」, the test has told you something
 * real about the model you just configured.
 *
 * That they are also about persistence is the point of the product: this page
 * is the first thing a new user sees.
 */
/** Only the label differs by platform; the behaviour is the same key. */
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent)

const TEST_QUOTES = [
  { text: 'Be water, my friend.', word: 'water', author: 'Bruce Lee' },
  { text: 'Little strokes fell great oaks.', word: 'fell', author: 'Benjamin Franklin' },
  {
    text: 'Repetition is the mother of learning.',
    word: 'mother',
    // 人名照原样显示；只有这一条作者是描述性的，需要跟着界面语言走。
    authorKey: 'options.test.author_latin',
  },
  {
    text: 'The roots of education are bitter, but the fruit is sweet.',
    word: 'roots',
    author: 'Aristotle',
  },
  { text: 'Slow and steady wins the race.', word: 'steady', author: 'Aesop' },
] as const

type TestQuote = (typeof TEST_QUOTES)[number]

const pickQuote = (previous?: TestQuote): TestQuote => {
  const pool = previous ? TEST_QUOTES.filter((item) => item !== previous) : TEST_QUOTES
  return pool[Math.floor(Math.random() * pool.length)]!
}

/**
 * Settings page.
 *
 * The provider section is deliberately hands-on: a key that silently does not
 * work is the worst failure mode for this product, so there is a real test call
 * that shows the actual contextual explanation the model produced.
 */
export function Options() {
  const { t } = useI18n()
  const { settings, update, loading } = useSettings()
  const { entries } = useEntries()
  const [toast, showToast] = useToast()
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  // Re-testing gives you a different sentence, so a second run is a second
  // data point rather than a cached-looking repeat of the first.
  const [quote, setQuote] = useState<TestQuote>(() => pickQuote())
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})

  useEffect(() => {
    void chrome.commands?.getAll().then((commands) => {
      const map: Record<string, string> = {}
      for (const command of commands) {
        if (command.name) map[command.name] = command.shortcut || ''
      }
      setShortcuts(map)
    })
  }, [])
  // One long scroll made the important settings hard to find; each category is
  // now a page of its own, and the URL hash keeps a reload where you were.
  const [category, setCategory] = useState<Category>(
    () => (CATEGORIES.find((item) => `#${item.id}` === location.hash)?.id ?? 'model'),
  )
  const fileRef = useRef<HTMLInputElement>(null)

  const welcome = new URLSearchParams(location.search).has('welcome')
  const meta = providerMeta(settings.provider)
  // `mock` is the one provider with nothing to configure, so it has no entry in
  // `settings.providers`; the blank config keeps the form code branch-free.
  const activeKey = settings.provider === 'mock' ? null : settings.provider
  const config: ProviderConfig = activeKey
    ? settings.providers[activeKey]
    : { apiKey: '', model: '', baseUrl: '' }

  const patchProvider = (patch: Partial<ProviderConfig>) => {
    if (!activeKey) return
    void update({
      providers: { ...settings.providers, [activeKey]: { ...config, ...patch } },
    })
  }

  const runTest = async () => {
    const current = test.kind === 'idle' ? quote : pickQuote(quote)
    setQuote(current)
    setTest({ kind: 'running' })
    try {
      // An explicit base URL may point at a user-chosen gateway that is not in
      // the required provider allow-list. Request exactly that origin while
      // this click still counts as a Chrome user gesture.
      if (config.baseUrl.trim()) await requestOptionalApiAccess(config.baseUrl)

      const { provider, downgradeReason } = resolveProvider(settings)
      if (downgradeReason) {
        setTest({ kind: 'fail', message: downgradeReason })
        return
      }
      const result = await provider.explainWord({
        text: current.word,
        context: current.text,
        pageTitle: 'authorKey' in current ? t(current.authorKey) : current.author,
      })
      setTest({
        kind: 'ok',
        word: result.word,
        contextMeaning: result.contextMeaning,
        model: `${provider.model} @ ${config.baseUrl.trim() || meta.defaultBaseUrl || t('options.test.official_sdk')}`,
      })
    } catch (error) {
      const message =
        error instanceof AIError
          ? t('options.test.error_detail', {
              message: aiErrorMessage(error.code),
              detail: truncate(error.message, 120),
            })
          : error instanceof Error
            ? error.message
            : String(error)
      setTest({ kind: 'fail', message })
    }
  }

  const exportAll = async () => {
    const snapshot = await buildSnapshot()
    downloadText(snapshotFilename(), JSON.stringify(snapshot, null, 2))
    showToast(t('options.data.exported', { count: snapshot.counts.entries }))
  }

  const importFile = async (file: File) => {
    try {
      const result = await importSnapshot(JSON.parse(await file.text()))
      showToast(
        t('options.data.imported', {
          added: result.added,
          merged: result.merged,
          skipped: result.skipped,
        }),
      )
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('options.data.import_failed'))
    }
  }

  const wipe = async () => {
    if (!confirm(t('options.data.wipe_confirm', { count: entries.length }))) return
    await replaceAll([])
    showToast(t('options.data.wiped'))
  }

  if (loading) return <div className="options muted">{t('common.loading')}</div>

  const select = (next: Category) => {
    setCategory(next)
    history.replaceState(null, '', `#${next}`)
  }

  return (
    <div className="options">
      <div className="options-head">
        <BrandMark size={26} />
        <h1 style={{ fontSize: 20 }}>{t('options.title', { name: t('app.name') })}</h1>
        {/*
          界面语言放在页头，不放进某个分类里。
          它是整个应用的外壳偏好——一个看不懂中文的人，恰恰没法在中文分类标签里
          找到「界面语言」这一项。所以它必须在他打开设置页的第一眼就在那儿。
        */}
        <label className="options-lang" title={t('options.ui_language.hint')}>
          <span className="faint">{t('options.ui_language')}</span>
          <Select
            value={settings.uiLanguage}
            label={t('options.ui_language')}
            options={UI_LANGUAGES.map((item) => ({ value: item.code, label: item.label }))}
            onChange={(next) => void update({ uiLanguage: next as UiLanguage })}
          />
        </label>
      </div>

      <div className="options-body">
      <nav className="settings-nav">
        {CATEGORIES.map((item) => (
          <button
            key={item.id}
            className="settings-tab"
            data-active={item.id === category}
            onClick={() => select(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </nav>

      <div>
      {welcome ? (
        <div className="banner">
          <strong>{t('options.welcome.title')}</strong> {t('options.welcome.privacy')}
        </div>
      ) : null}

      {category === 'model' ? (
      <section className="card section-card">
        <div className="section-title">{t('options.nav.model')}</div>
        <div className="section-desc">{t('options.model.desc')}</div>

        <div className="provider-grid">
          {PROVIDER_CATALOGUE.map((item) => (
            <button
              key={item.id}
              className="provider-option"
              data-active={item.id === settings.provider}
              onClick={() => {
                void update({ provider: item.id })
                setTest({ kind: 'idle' })
              }}
            >
              {providerLabel(item)}
              {item.badge ? (
                <span className="provider-badge" data-tone={item.badge.tone}>
                  {t(item.badge.key)}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {settings.provider === 'mock' ? (
          <div className="banner">{t('options.provider.mock_notice')}</div>
        ) : (
          <>
            <Field
              label={t('options.model.api_key')}
              hint={
                meta.keyUrl
                  ? t('options.model.api_key_hint', { url: meta.keyUrl })
                  : t('options.model.api_key_hint_optional')
              }
            >
              <input
                type="password"
                value={config.apiKey}
                placeholder={
                  meta.requiresKey
                    ? t('options.model.placeholder_required')
                    : t('options.model.placeholder_optional')
                }
                onChange={(event) => patchProvider({ apiKey: event.target.value })}
                autoComplete="off"
              />
            </Field>

            <Field
              label={t('options.model.model')}
              hint={
                config.model.trim()
                  ? t('options.model.hint_active', { value: config.model.trim() })
                  : t('options.model.hint_default', {
                      value: meta.defaultModel || t('options.model.manual_required'),
                    })
              }
            >
              <input
                type="text"
                value={config.model}
                placeholder={meta.defaultModel}
                list={`models-${meta.id}`}
                onChange={(event) => patchProvider({ model: event.target.value })}
              />
              <datalist id={`models-${meta.id}`}>
                {meta.modelSuggestions.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </Field>

            <Field
              label={t('options.model.base_url')}
              hint={
                config.baseUrl.trim()
                  ? t('options.model.base_url_hint_active', { value: config.baseUrl.trim() })
                  : t('options.model.hint_default', {
                      value: meta.defaultBaseUrl || t('options.model.manual_required'),
                    })
              }
            >
              <input
                type="text"
                value={config.baseUrl}
                placeholder={meta.defaultBaseUrl}
                onChange={(event) => patchProvider({ baseUrl: event.target.value })}
              />
            </Field>
          </>
        )}

        <div className="row" style={{ gap: 10 }}>
          <button className="btn btn-primary" onClick={() => void runTest()} disabled={test.kind === 'running'}>
            {test.kind === 'running' ? t('options.test.running') : t('options.test.run')}
          </button>
          <span className="faint">
            {t('options.test.quote', {
              text: quote.text,
              author: 'authorKey' in quote ? t(quote.authorKey) : quote.author,
            })}
          </span>
        </div>

        {test.kind === 'ok' ? (
          <div className="banner banner-success" style={{ marginTop: 14, marginBottom: 0 }}>
            <strong>{t('options.test.ok', { model: test.model })}</strong>
            <div style={{ marginTop: 4 }}>
              {t('options.test.meaning', { word: test.word, meaning: test.contextMeaning })}
            </div>
          </div>
        ) : null}
        {test.kind === 'fail' ? (
          <div className="banner banner-danger" style={{ marginTop: 14, marginBottom: 0 }}>
            {test.message}
          </div>
        ) : null}
      </section>
      ) : null}

      {category === 'reading' ? (
      <section className="card section-card">
        <div className="section-title">{t('options.reading.title')}</div>
        <div className="section-desc">{t('options.reading.desc')}</div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Field
              label={t('options.reading.source_language')}
              hint={t('options.reading.source_language.hint')}
            >
              <Select
                value={settings.sourceLanguage}
                label={t('options.reading.source_language')}
                options={SOURCE_LANGUAGES.map((item) => ({
                  value: item.code,
                  label: t(item.labelKey),
                }))}
                onChange={(next) => void update({ sourceLanguage: next })}
              />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field
              label={t('options.reading.target_language')}
              hint={t('options.reading.target_language.hint')}
            >
              <Select
                value={settings.targetLanguage}
                label={t('options.reading.target_language')}
                options={TARGET_LANGUAGES.map((item) => ({
                  value: item.code,
                  label: t(item.labelKey),
                }))}
                onChange={(next) => void update({ targetLanguage: next })}
              />
            </Field>
          </div>
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('options.reading.enable')}</div>
            <div className="faint">{t('options.reading.enable.hint')}</div>
          </div>
          <Toggle
            checked={settings.enabled}
            onChange={(next) => void update({ enabled: next })}
            label={t('options.reading.enable')}
          />
        </div>

        <Field label={t('options.reading.trigger')}>
          <SegmentedControl
            value={settings.triggerMode}
            options={[
              { value: 'button', label: t('options.reading.trigger.button') },
              { value: 'auto', label: t('options.reading.trigger.auto') },
              { value: 'hotkey', label: t('options.reading.trigger.hotkey') },
            ]}
            onChange={(next) => void update({ triggerMode: next })}
          />
        </Field>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('options.reading.auto_speak')}</div>
            <div className="faint">{t('options.reading.auto_speak.hint')}</div>
          </div>
          <Toggle
            checked={settings.autoSpeak}
            onChange={(next) => void update({ autoSpeak: next })}
            label={t('options.reading.auto_speak')}
          />
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>{t('options.reading.english_definition')}</div>
            <div className="faint">{t('options.reading.english_definition.hint')}</div>
          </div>
          <Toggle
            checked={settings.showEnglishDefinition}
            onChange={(next) => void update({ showEnglishDefinition: next })}
            label={t('options.reading.english_definition')}
          />
        </div>

        <Field
          label={t('options.reading.max_length')}
          hint={t('options.reading.max_length.hint')}
        >
          <input
            type="number"
            min={10}
            max={400}
            value={settings.maxSelectionLength}
            onChange={(event) => void update({ maxSelectionLength: Number(event.target.value) || 120 })}
          />
        </Field>

        <Field
          label={t('options.reading.page_range')}
          hint={t('options.reading.page_range.hint')}
        >
          <SegmentedControl
            value={settings.pageTranslationRange}
            options={[
              { value: 'content' as const, label: t('options.reading.page_range.content') },
              { value: 'all' as const, label: t('options.reading.page_range.all') },
            ]}
            onChange={(next) => void update({ pageTranslationRange: next })}
          />
        </Field>

        <Field
          label={t('options.reading.display_mode')}
          hint={t('options.reading.display_mode.hint')}
        >
          <SegmentedControl
            value={settings.translationMode}
            options={[
              { value: 'bilingual', label: t('popup.display_mode.bilingual') },
              { value: 'translationOnly', label: t('popup.display_mode.translation_only') },
            ]}
            onChange={(next) => void update({ translationMode: next })}
          />
        </Field>

        {/*
          翻翻模式放在阅读这一节，紧挨着显示方式：它们回答的是同一个问题——
          「一个网页在我眼里应该长什么样」。
        */}
        <Field label={t('fanfan.mode.title')} hint={t('fanfan.options.hint')}>
          <div className="row-between">
            <span className="faint">
              {settings.fanfanMode ? t('fanfan.mode.hint_on') : t('fanfan.mode.hint_off')}
            </span>
            <Toggle
              checked={settings.fanfanMode}
              onChange={(next) => void update({ fanfanMode: next })}
              label={t('fanfan.mode.aria')}
            />
          </div>
        </Field>

        <Field
          label={t('popup.paragraph.title')}
          hint={t('options.reading.paragraph.hint')}
        >
          <Select
            value={settings.paragraphTriggerKey}
            label={t('popup.paragraph.aria')}
            options={[
              { value: 'backtick', label: t('options.reading.paragraph.backtick') },
              {
                value: 'alt',
                label: t('options.reading.paragraph.hold', { key: IS_MAC ? 'Option' : 'Alt' }),
              },
              {
                value: 'ctrl',
                label: t('options.reading.paragraph.hold', { key: IS_MAC ? 'Command' : 'Ctrl' }),
              },
              { value: 'shift', label: t('options.reading.paragraph.hold', { key: 'Shift' }) },
              { value: 'off', label: t('common.off') },
            ]}
            onChange={(next) => void update({ paragraphTriggerKey: next })}
          />
        </Field>

        <Field
          label={t('options.reading.examples')}
          hint={t('options.reading.examples.hint')}
        >
          <Select
            value={String(settings.exampleCount)}
            label={t('options.reading.examples')}
            options={[
              { value: '0', label: t('options.reading.examples.none') },
              ...[1, 2, 3, 4, 5, 6].map((count) => ({
                value: String(count),
                // 英文的 1 不能跟着复数走，所以单数单独一条键。
                label:
                  (count === 1
                    ? t('options.reading.examples.count_one')
                    : t('options.reading.examples.count', { count })) +
                  (count === 3 ? t('options.reading.examples.default_suffix') : ''),
              })),
            ]}
            onChange={(next) => void update({ exampleCount: Number(next) })}
          />
        </Field>

        <Field
          label={t('options.reading.cache_ttl')}
          hint={t('options.reading.cache_ttl.hint')}
        >
          <input
            type="number"
            min={0}
            max={720}
            value={settings.cacheTtlHours}
            onChange={(event) => void update({ cacheTtlHours: Number(event.target.value) || 0 })}
          />
        </Field>

        {settings.blockedHosts.length > 0 ? (
          <Field label={t('options.reading.blocked')}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {settings.blockedHosts.map((host) => (
                <button
                  key={host}
                  className="chip"
                  onClick={() =>
                    void update({ blockedHosts: settings.blockedHosts.filter((item) => item !== host) })
                  }
                  title={t('options.reading.blocked.restore')}
                >
                  {host} ✕
                </button>
              ))}
            </div>
          </Field>
        ) : null}
      </section>
      ) : null}

      {category === 'review' ? <ReviewSection settings={settings} update={update} /> : null}

      {category === 'shortcut' ? <ShortcutSection shortcuts={shortcuts} /> : null}

      {category === 'sync' ? <SyncSection onToast={showToast} /> : null}

      {category === 'data' ? (
      <section className="card section-card">
        <div className="section-title">{t('options.data.title')}</div>
        <div className="section-desc">{t('options.data.desc', { count: entries.length })}</div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void exportAll()}>
            {t('options.data.export')}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            {t('options.data.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => {
              void clearCache()
              void clearTranslationCache()
              showToast(t('options.data.cache_cleared'))
            }}
          >
            {t('options.data.clear_cache')}
          </button>
          <div className="spacer" />
          <button className="btn btn-danger" onClick={() => void wipe()}>
            {t('options.data.wipe')}
          </button>
        </div>
      </section>
      ) : null}

      <div className="faint" style={{ textAlign: 'center' }}>
        {t('options.footer', { name: t('app.name') })}
      </div>
      </div>
      </div>
      {toast ? <div className="toast-fixed">{toast}</div> : null}
    </div>
  )
}
