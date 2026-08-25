import { useEffect, useRef, useState } from 'react'
import { Field, SegmentedControl, Toggle } from '@/components/index.tsx'
import { BrandMark } from '@/components/icons.tsx'
import { useEntries, useSettings, useToast } from '@/components/hooks.ts'
import { resolveProvider } from '@/ai/index.ts'
import { requestOptionalApiAccess } from '@/ai/hostPermission.ts'
import { AIError, AI_ERROR_MESSAGES } from '@/types/ai.ts'
import {
  PROVIDER_CATALOGUE,
  providerMeta,
  type ProviderConfig,
  type Settings,
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
import { APP_NAME } from '@/shared/constants.ts'
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '@/shared/language.ts'
import { SyncSection } from './SyncSection.tsx'
import { ReviewSection } from './ReviewSection.tsx'
import { ShortcutSection } from './ShortcutSection.tsx'
import { truncate } from '@/shared/utils.ts'

type Category = 'model' | 'reading' | 'review' | 'shortcut' | 'sync' | 'data'

const CATEGORIES: ReadonlyArray<{ id: Category; label: string }> = [
  { id: 'model', label: 'AI 模型' },
  { id: 'reading', label: '划词与翻译' },
  { id: 'review', label: '复习' },
  { id: 'shortcut', label: '快捷键' },
  { id: 'sync', label: 'GitHub 同步' },
  { id: 'data', label: '我的数据' },
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
  { text: 'Repetition is the mother of learning.', word: 'mother', author: '拉丁谚语' },
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
        pageTitle: current.author,
      })
      setTest({
        kind: 'ok',
        word: result.word,
        contextMeaning: result.contextMeaning,
        model: `${provider.model} @ ${config.baseUrl.trim() || meta.defaultBaseUrl || '官方 SDK'}`,
      })
    } catch (error) {
      const message =
        error instanceof AIError
          ? `${AI_ERROR_MESSAGES[error.code]}（${truncate(error.message, 120)}）`
          : error instanceof Error
            ? error.message
            : String(error)
      setTest({ kind: 'fail', message })
    }
  }

  const exportAll = async () => {
    const snapshot = await buildSnapshot()
    downloadText(snapshotFilename(), JSON.stringify(snapshot, null, 2))
    showToast(`已导出 ${snapshot.counts.entries} 个词条`)
  }

  const importFile = async (file: File) => {
    try {
      const result = await importSnapshot(JSON.parse(await file.text()))
      showToast(`导入完成：新增 ${result.added}，合并 ${result.merged}，跳过 ${result.skipped}`)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '导入失败')
    }
  }

  const wipe = async () => {
    if (!confirm(`确定要删除全部 ${entries.length} 个词条吗？此操作不可撤销，建议先导出备份。`)) return
    await replaceAll([])
    showToast('已清空词卡')
  }

  if (loading) return <div className="options muted">加载中…</div>

  const select = (next: Category) => {
    setCategory(next)
    history.replaceState(null, '', `#${next}`)
  }

  return (
    <div className="options">
      <div className="options-head">
        <BrandMark size={26} />
        <h1 style={{ fontSize: 20 }}>{APP_NAME} 设置</h1>
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
            {item.label}
          </button>
        ))}
      </nav>

      <div>
      {welcome ? (
        <div className="banner">
          <strong>欢迎使用！</strong>
          扩展只在你主动划词或翻译时读取选中文字、附近上下文、页面标题和网址；
          词卡、设置与 Key 默认只保存在本机。配置模型后，这些阅读内容会直接发送给你选择的模型服务商；
          启用 GitHub 同步后，词卡会发送到你自己的仓库。开发者没有中转服务器，也不收集这些数据。
          不配置 Key 也可以使用离线词典。
        </div>
      ) : null}

      {category === 'model' ? (
      <section className="card section-card">
        <div className="section-title">AI 模型</div>
        <div className="section-desc">
          所有请求都从扩展后台直接发往你选择的服务商，Key 只保存在本机 chrome.storage，不会经过任何第三方服务器。
        </div>

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
              {item.label}
              {item.badge ? (
                <span
                  className="provider-badge"
                  data-tone={item.badge === '推荐' ? 'recommend' : 'free'}
                >
                  {item.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {settings.provider === 'mock' ? (
          <div className="banner">
            离线词典模式：无需联网、无需 Key，但只能给出词典释义，无法结合上下文推断。
          </div>
        ) : (
          <>
            <Field
              label="API Key"
              hint={meta.keyUrl ? `没有 Key？到 ${meta.keyUrl} 申请` : '如果你的网关不校验 Key，可以留空'}
            >
              <input
                type="password"
                value={config.apiKey}
                placeholder={meta.requiresKey ? '必填' : '可选'}
                onChange={(event) => patchProvider({ apiKey: event.target.value })}
                autoComplete="off"
              />
            </Field>

            <Field
              label="模型"
              hint={
                config.model.trim()
                  ? `生效值：${config.model.trim()}`
                  : `留空 → 使用默认值 ${meta.defaultModel || '（此服务商必须手动填写）'}`
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
              label="API 地址（可选）"
              hint={
                config.baseUrl.trim()
                  ? `生效值：${config.baseUrl.trim()}（覆盖了默认值）`
                  : `留空 → 使用默认值 ${meta.defaultBaseUrl || '（此服务商必须手动填写）'}`
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
            {test.kind === 'running' ? '测试中…' : '测试连接'}
          </button>
          <span className="faint">
            用 “{quote.text}” 真实调用一次 · {quote.author}
          </span>
        </div>

        {test.kind === 'ok' ? (
          <div className="banner banner-success" style={{ marginTop: 14, marginBottom: 0 }}>
            <strong>连接正常（{test.model}）</strong>
            <div style={{ marginTop: 4 }}>
              「{test.word}」在这句里：{test.contextMeaning}
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
        <div className="section-title">划词行为</div>
        <div className="section-desc">决定选中文字之后会发生什么。</div>

        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <Field label="我在读的语言" hint="选「自动识别」时由模型判断；指定语言可以避免在别的语种上误触发。">
              <select
                value={settings.sourceLanguage}
                onChange={(event) => void update({ sourceLanguage: event.target.value })}
              >
                {SOURCE_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="解释用什么语言写" hint="固定不变——它是你思考用的语言，不该随页面变化。">
              <select
                value={settings.targetLanguage}
                onChange={(event) => void update({ targetLanguage: event.target.value })}
              >
                {TARGET_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>启用划词助手</div>
            <div className="faint">关闭后所有网页都不再注入 UI</div>
          </div>
          <Toggle checked={settings.enabled} onChange={(next) => void update({ enabled: next })} label="启用划词助手" />
        </div>

        <Field label="触发方式">
          <SegmentedControl
            value={settings.triggerMode}
            options={[
              { value: 'button', label: '显示小按钮' },
              { value: 'auto', label: '立即解释' },
              { value: 'hotkey', label: '按住 Alt 划词' },
            ]}
            onChange={(next) => void update({ triggerMode: next })}
          />
        </Field>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>自动朗读</div>
            <div className="faint">解释卡片出现时自动读一遍单词</div>
          </div>
          <Toggle checked={settings.autoSpeak} onChange={(next) => void update({ autoSpeak: next })} label="自动朗读" />
        </div>

        <div className="row-between" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 600 }}>显示英文释义</div>
            <div className="faint">在卡片上同时给出 English definition</div>
          </div>
          <Toggle
            checked={settings.showEnglishDefinition}
            onChange={(next) => void update({ showEnglishDefinition: next })}
            label="显示英文释义"
          />
        </div>

        <Field label="最长划选长度（字符）" hint="超过这个长度就不再触发，避免整段文字被当成单词发给模型">
          <input
            type="number"
            min={10}
            max={400}
            value={settings.maxSelectionLength}
            onChange={(event) => void update({ maxSelectionLength: Number(event.target.value) || 120 })}
          />
        </Field>

        <Field
          label="整页翻译范围"
          hint="「仅正文」会跳过导航栏、页眉页脚和侧边栏——它们通常是界面文字而不是你要读的内容。"
        >
          <SegmentedControl
            value={settings.pageTranslationRange}
            options={[
              { value: 'content' as const, label: '仅正文' },
              { value: 'all' as const, label: '整页' },
            ]}
            onChange={(next) => void update({ pageTranslationRange: next })}
          />
        </Field>

        <Field
          label="整段翻译"
          hint="按住这个键并把鼠标停在某一段上，就只翻译那一段；再按一次收起。适合「整页都读得懂，就那一段卡住」。"
        >
          <select
            value={settings.paragraphTriggerKey}
            onChange={(event) =>
              void update({
                paragraphTriggerKey: event.target
                  .value as Settings['paragraphTriggerKey'],
              })
            }
          >
            <option value="backtick">按 ` 反引号（默认，不与任何组合键冲突）</option>
            <option value="alt">按住 {IS_MAC ? 'Option' : 'Alt'}</option>
            <option value="ctrl">按住 {IS_MAC ? 'Command' : 'Ctrl'}</option>
            <option value="shift">按住 Shift</option>
            <option value="off">关闭</option>
          </select>
        </Field>

        <Field
          label="例句数量"
          hint="0 表示不要例句——例句是查询里最费时间的部分，关掉能明显加快出结果。"
        >
          <select
            value={String(settings.exampleCount)}
            onChange={(event) => void update({ exampleCount: Number(event.target.value) })}
          >
            <option value="0">不要例句</option>
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={String(count)}>
                {count} 句{count === 3 ? '（默认）' : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="解释缓存时长（小时）" hint="同一个词在同一句话里的解释会被缓存，0 表示不缓存">
          <input
            type="number"
            min={0}
            max={720}
            value={settings.cacheTtlHours}
            onChange={(event) => void update({ cacheTtlHours: Number(event.target.value) || 0 })}
          />
        </Field>

        {settings.blockedHosts.length > 0 ? (
          <Field label="已禁用的网站">
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {settings.blockedHosts.map((host) => (
                <button
                  key={host}
                  className="chip"
                  onClick={() =>
                    void update({ blockedHosts: settings.blockedHosts.filter((item) => item !== host) })
                  }
                  title="点击重新启用"
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
        <div className="section-title">我的知识库</div>
        <div className="section-desc">
          共 {entries.length} 个词条，全部保存在本机。导出的 JSON 与同步到 GitHub 的格式完全一致。
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void exportAll()}>
            导出全部数据
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            导入 JSON
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
              showToast('已清空解释与翻译缓存')
            }}
          >
            清空缓存
          </button>
          <div className="spacer" />
          <button className="btn btn-danger" onClick={() => void wipe()}>
            清空词卡
          </button>
        </div>
      </section>
      ) : null}

      <div className="faint" style={{ textAlign: 'center' }}>
        {APP_NAME} · 本地优先 · 数据永远属于你
      </div>
      </div>
      </div>
      {toast ? <div className="toast-fixed">{toast}</div> : null}
    </div>
  )
}
