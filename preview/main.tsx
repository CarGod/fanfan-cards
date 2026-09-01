/**
 * UI preview harness — `npm run preview`.
 *
 * Renders every surface against seeded in-memory data, outside Chrome. It
 * exists because a CSS or layout bug is invisible to typecheck, unit tests and
 * the bundle smoke test alike, and reloading an unpacked extension to look at a
 * card is a slow way to iterate.
 *
 * This directory is not part of the extension build.
 */
import { useEffect, useState } from 'react'
import { SegmentedControl } from '@/components/index.tsx'
import { setLanguage, type ResolvedLanguage } from '@/i18n/index.ts'
import './chrome-stub.ts'
import { SAMPLE_EXPLANATION } from './chrome-stub.ts'
import { createRoot } from 'react-dom/client'
import { BrandMark } from '@/components/icons.tsx'
import '@/components/ui.css'
import contentStyles from '@/content/styles.css?inline'
import { CardError, CardSkeleton, WordCard } from '@/content/ui/WordCard.tsx'
import { SavedWordCard } from '@/content/ui/SavedWordCard.tsx'
import { SavedWordHighlighter } from '@/content/highlight/highlighter.ts'
import { injectPageStyles } from '@/content/page/styles.ts'
import { App } from '@/app/App.tsx'
import { Popup } from '@/popup/Popup.tsx'
import { Options } from '@/options/Options.tsx'
import { FeedShowcase } from './FeedShowcase.tsx'
import { YouTubeShowcase } from './YouTubeShowcase.tsx'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { storage } from '@/storage/area.ts'
import { DAY_MS, dateKey } from '@/shared/utils.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import type { DailyActivity } from '@/types/vocabulary.ts'

const NOW = Date.now()

const SENTENCE = 'Database migration can be dangerous if you skip the dry run.'

function entry(
  id: string,
  word: string,
  patch: Partial<VocabularyEntry> = {},
  review: Partial<VocabularyEntry['review']> = {},
): VocabularyEntry {
  return {
    id,
    word,
    normalized: word.toLowerCase(),
    lemma: word.toLowerCase(),
    kind: 'word',
    phonetic: '/maɪˈɡreɪʃn/',
    partOfSpeech: 'noun',
    cefr: 'B2',
    meaning: '迁移；移民',
    senses: [],
    aiExplanation: SAMPLE_EXPLANATION.contextMeaning,
    englishDefinition: SAMPLE_EXPLANATION.englishDefinition,
    examples: SAMPLE_EXPLANATION.examples,
    sentenceTranslation: '如果跳过演练，数据库迁移可能非常危险。',
    synonyms: [
      { word: 'transfer', meaning: '泛指把东西从一处移到另一处' },
      { word: 'upgrade', meaning: '强调升到更新的版本' },
    ],
    source: {
      url: 'https://github.com/postgres/postgres',
      title: 'PostgreSQL — release notes',
      context: SENTENCE,
      wideContext: SENTENCE,
      capturedAt: NOW - DAY_MS,
    },
    origin: { providerId: 'claude', model: 'claude-opus-5', offline: false },
    review: {
      level: 0,
      status: 'new',
      dueAt: NOW - 1000,
      lastReviewedAt: null,
      reviewCount: 0,
      lapses: 0,
      streak: 0,
      ...review,
    },
    tags: [],
    notes: '',
    favorite: false,
    createdAt: NOW - DAY_MS,
    updatedAt: NOW - DAY_MS,
    deletedAt: null,
    ...patch,
  }
}

/** 多词性释义的形式对照。 */
const MULTI_SENSE = [
  {
    title: '两个词性',
    word: 'exclusive',
    sentence: 'Exclusive: post-GPT-6 is already running in the lab.',
    explanation: {
      ...SAMPLE_EXPLANATION,
      word: 'exclusive',
      lemma: 'exclusive',
      phonetic: '/ɪkˈskluːsɪv/',
      partOfSpeech: 'noun',
      cefr: 'B2' as const,
      meaning: '',
      senses: [
        { partOfSpeech: 'adjective', meaning: '独有的，排外的；不与他人共享的' },
        { partOfSpeech: 'noun', meaning: '独家新闻' },
      ],
      contextMeaning: '这里是名词用法，用作标题标签，意思是"独家消息"。',
      englishDefinition: 'not shared with others; or, a news story only one outlet has',
      sentenceTranslation: '独家：GPT-6 之后的那个模型已经在实验室里跑起来了。',
      examples: [
        {
          sentence: 'The magazine ran an exclusive on the merger.',
          translation: '这家杂志刊出了那桩并购的独家报道。',
        },
      ],
      synonyms: [{ word: 'scoop', meaning: '独家新闻，侧重抢先报道' }],
    },
  },
  {
    title: '三个词性',
    word: 'run',
    sentence: 'They run the migration twice before every release.',
    explanation: {
      ...SAMPLE_EXPLANATION,
      word: 'run',
      lemma: 'run',
      phonetic: '/rʌn/',
      partOfSpeech: 'verb',
      cefr: 'A1' as const,
      meaning: '',
      senses: [
        { partOfSpeech: 'verb', meaning: '运行，执行；也指跑步' },
        { partOfSpeech: 'noun', meaning: '一次运行，一趟；也指连续的一段' },
        { partOfSpeech: 'adjective', meaning: '（run-down）破旧的，疲惫的' },
      ],
      contextMeaning: '这里是动词，指执行迁移脚本，不是跑步。',
      englishDefinition: 'to execute a program or process',
      sentenceTranslation: '每次发版之前，他们都会把迁移跑两遍。',
      examples: [
        {
          sentence: 'We run the test suite on every commit.',
          translation: '我们在每次提交上都跑一遍测试。',
        },
      ],
      synonyms: [{ word: 'execute', meaning: '执行，更正式，多用于命令或程序' }],
    },
  },
  {
    title: '单义词（退回一行）',
    word: 'idempotent',
    sentence: 'Make the handler idempotent so a retry is harmless.',
    explanation: {
      ...SAMPLE_EXPLANATION,
      word: 'idempotent',
      lemma: 'idempotent',
      phonetic: '/aɪˈdempətənt/',
      partOfSpeech: 'adjective',
      cefr: 'C1' as const,
      meaning: '幂等的：做一次和做多次结果相同',
      // 单义词返回空数组，显示时退回那一行 meaning。
      senses: [],
      contextMeaning: '这里说的是这个处理函数重复执行也不会产生额外影响。',
      englishDefinition: 'producing the same result however many times it is applied',
      sentenceTranslation: '把这个处理函数写成幂等的，这样重试就不会有副作用。',
      examples: [
        {
          sentence: 'A PUT request should be idempotent.',
          translation: 'PUT 请求应当是幂等的。',
        },
      ],
      synonyms: [{ word: 'repeatable', meaning: '可重复的，强调能再做一次，不强调结果相同' }],
    },
  },
]

const WORDS: VocabularyEntry[] = [
  entry('w1', 'migration'),
  entry(
    'w2',
    'deprecated',
    {
      meaning: '已弃用的；不推荐使用的',
      senses: [],
      aiExplanation:
        '这里说的是这个 API 仍然可以调用，但官方不再推荐，且下一个大版本就会删除。不等于"已经删除"。',
      partOfSpeech: 'adjective',
      phonetic: '/ˈdeprəkeɪtɪd/',
      source: {
        url: 'https://react.dev/blog',
        title: 'React 19 upgrade guide',
        context: 'This lifecycle method is deprecated and will be removed in the next major release.',
        wideContext: '',
        capturedAt: NOW - 2 * DAY_MS,
      },
      createdAt: NOW - 2 * DAY_MS,
    },
    { level: 1, status: 'learning', dueAt: NOW + DAY_MS, reviewCount: 2, streak: 1 },
  ),
  entry(
    'w3',
    'idempotent',
    {
      meaning: '幂等的',
      senses: [],
      aiExplanation: '这里指同一个请求重复发送多次，服务端状态和只发送一次完全相同，所以重试是安全的。',
      partOfSpeech: 'adjective',
      phonetic: '/aɪˈdempətənt/',
      source: {
        url: 'https://stripe.com/docs/api',
        title: 'Stripe API reference',
        context: 'Make the endpoint idempotent so that retries are safe.',
        wideContext: '',
        capturedAt: NOW - 5 * DAY_MS,
      },
      createdAt: NOW - 5 * DAY_MS,
    },
    { level: 3, status: 'mastered', dueAt: NOW + 6 * DAY_MS, reviewCount: 7, streak: 4 },
  ),
  entry(
    'w4',
    'bottleneck',
    {
      meaning: '瓶颈',
      senses: [],
      aiExplanation: '这里指整个流水线里限制吞吐的那一环，作者测出来是磁盘 I/O 而不是 CPU。',
      phonetic: '/ˈbɑːtlnek/',
      createdAt: NOW - 9 * DAY_MS,
    },
    { level: 2, status: 'familiar', dueAt: NOW - DAY_MS, reviewCount: 3, streak: 2 },
  ),
]

const activity: Record<string, DailyActivity> = {}
const PATTERN = [3, 0, 5, 2, 8, 1, 0, 4, 6, 2, 0, 3, 7, 2]
PATTERN.forEach((saved, index) => {
  const key = dateKey(NOW - (PATTERN.length - 1 - index) * DAY_MS)
  activity[key] = { date: key, saved, reviewed: saved * 2, lookups: saved + 2 }
})

async function seed(): Promise<void> {
  const store = storage()
  await store.set(
    STORAGE_KEYS.words,
    Object.fromEntries(WORDS.map((item) => [item.id, item])),
  )
  await store.set(STORAGE_KEYS.activity, activity)
}

function CardShowcase() {
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <ShadowFrame title="结果态">
        <WordCard
          selection="migration"
          sentence={SENTENCE}
          explanation={SAMPLE_EXPLANATION}
          meta={{ providerId: 'claude', model: 'claude-opus-5', offline: false, cached: false }}
          savedEntry={null}
          saving={false}
          enriching={false}
          showEnglishDefinition
          autoSpeak={false}
          onSave={() => {}}
          onRemove={() => {}}
          onClose={() => {}}
        />
      </ShadowFrame>

      {/*
        多词性释义。
        这三张卡是形式对照：两个词性、三个词性、以及单义词退回一行的样子。
        单义那张同样重要——大多数词是单义的，这条路必须一直好用。
      */}
      {MULTI_SENSE.map((sample) => (
        <ShadowFrame key={sample.word} title={sample.title}>
          <WordCard
            selection={sample.word}
            sentence={sample.sentence}
            explanation={sample.explanation}
            meta={{ providerId: 'claude', model: 'claude-opus-5', offline: false, cached: false }}
            savedEntry={null}
            saving={false}
            enriching={false}
            showEnglishDefinition
            autoSpeak={false}
            onSave={() => {}}
            onRemove={() => {}}
            onClose={() => {}}
          />
        </ShadowFrame>
      ))}

      <ShadowFrame title="加载态">
        <CardSkeleton word="idempotent" onClose={() => {}} />
      </ShadowFrame>

      <ShadowFrame title="错误态">
        <CardError
          word="throttle"
          code="auth"
          message="HTTP 401: invalid x-api-key"
          onRetry={() => {}}
          onOffline={() => {}}
          onOpenSettings={() => {}}
          onClose={() => {}}
        />
      </ShadowFrame>

      <ShadowFrame title="触发按钮">
        <button className="trigger">
          <BrandMark size={16} className="mark" />
          <span>migration</span>
          <span className="hint">解释</span>
        </button>
      </ShadowFrame>
    </div>
  )
}

/**
 * Store screenshot #1: the real content card over a restrained article page.
 * Nothing here invents product behaviour — the article is only scenery and
 * the card is the exact component shipped in the extension.
 */
function StoreReaderShowcase() {
  return (
    <main
      style={{
        height: '100vh',
        overflow: 'hidden',
        background: '#fbfbfc',
        color: '#20232a',
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <header
        style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 64px',
          borderBottom: '1px solid #e6e7eb',
          background: '#fff',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <strong style={{ fontSize: 17, letterSpacing: '-0.01em' }}>Engineering Notes</strong>
        <span style={{ color: '#777d88', fontSize: 13 }}>DATABASES · RELIABILITY · TOOLING</span>
      </header>

      <article style={{ width: 760, marginLeft: 92, padding: '62px 0 80px' }}>
        <div
          style={{
            color: '#6f7580',
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            letterSpacing: '0.08em',
          }}
        >
          DATABASE RELIABILITY · 8 MIN READ
        </div>
        <h1
          style={{
            margin: '18px 0 18px',
            fontSize: 48,
            lineHeight: 1.08,
            letterSpacing: '-0.035em',
            fontWeight: 650,
          }}
        >
          A safer pattern for zero-downtime database migrations
        </h1>
        <p style={{ margin: '0 0 42px', color: '#747a84', fontFamily: 'var(--font-sans)', fontSize: 15 }}>
          Notes from a production schema change · August 18, 2026
        </p>
        <p style={{ fontSize: 21, lineHeight: 1.78, margin: '0 0 24px', color: '#363a42' }}>
          A database{' '}
          <span
            style={{
              background: '#f1eefb',
              color: '#3f2c90',
              borderBottom: '2px solid #5b45b0',
              borderRadius: 3,
              padding: '1px 3px',
            }}
          >
            migration
          </span>{' '}
          can be dangerous when a table is large, writes are continuous, and rollback has never
          been rehearsed.
        </p>
        <p style={{ fontSize: 21, lineHeight: 1.78, margin: '0 0 24px', color: '#363a42' }}>
          The safest changes are reversible and idempotent. Add the new structure first, move data
          in small batches, and remove the old path only after every reader has switched.
        </p>
        <blockquote
          style={{
            margin: '34px 0',
            padding: '6px 0 6px 24px',
            borderLeft: '3px solid #ff6a3d',
            color: '#525761',
            fontSize: 19,
            lineHeight: 1.7,
          }}
        >
          Treat every schema change as a deploy, not as a one-off command.
        </blockquote>
      </article>

      <div
        style={{
          position: 'absolute',
          right: 68,
          top: 92,
          width: 352,
          transform: 'scale(.86)',
          transformOrigin: 'top right',
        }}
      >
        <ShadowMount>
          <WordCard
            selection="migration"
            sentence={SENTENCE}
            explanation={SAMPLE_EXPLANATION}
            meta={{ providerId: 'claude', model: 'claude-opus-5', offline: false, cached: false }}
            savedEntry={null}
            saving={false}
            enriching={false}
            showEnglishDefinition
            autoSpeak={false}
            onSave={() => {}}
            onRemove={() => {}}
            onClose={() => {}}
          />
        </ShadowMount>
      </div>
    </main>
  )
}

/**
 * Store screenshot for FanFan mode: saved words are painted by the exact
 * CSS Custom Highlight implementation shipped in the extension, and the card
 * on the right is the real no-network saved-word card.
 */
function StoreFanFanModeShowcase() {
  useEffect(() => {
    setLanguage('zh-CN')
    injectPageStyles()
    const highlighter = new SavedWordHighlighter()
    highlighter.start(WORDS)
    return () => highlighter.stop()
  }, [])

  const saved = WORDS[2]!

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#f4f1eb',
        color: '#20232a',
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <header
        style={{
          height: 68,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 62px',
          borderBottom: '1px solid #dcd8d0',
          background: 'rgba(255,255,255,.72)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        <strong style={{ fontSize: 17, letterSpacing: '-.02em' }}>Field Notes</strong>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, color: '#6e716f', fontSize: 12, letterSpacing: '.08em' }}>
          <span>IDEAS</span><span>DESIGN</span><span>ENGINEERING</span>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff6a3d', boxShadow: '0 0 0 5px rgba(255,106,61,.12)' }} />
        </div>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 390px', gap: 54, padding: '48px 62px 56px' }}>
        <article style={{ maxWidth: 760 }}>
          <div style={{ color: '#787a77', fontFamily: 'var(--font-sans)', fontSize: 12, letterSpacing: '.12em' }}>
            SYSTEMS · 7 MIN READ
          </div>
          <h1 style={{ margin: '17px 0 22px', fontSize: 52, lineHeight: 1.02, letterSpacing: '-.045em', fontWeight: 620 }}>
            The quiet systems behind reliable products
          </h1>
          <p style={{ margin: '0 0 36px', color: '#767873', fontFamily: 'var(--font-sans)', fontSize: 14 }}>
            Notes on making change safer · August 27, 2026
          </p>
          <p style={{ margin: '0 0 22px', color: '#3c3e3b', fontSize: 21, lineHeight: 1.78 }}>
            A database migration is rarely difficult because of one command. The real work is
            designing an idempotent path that remains safe when traffic, retries, and partial
            failures arrive together.
          </p>
          <p style={{ margin: '0 0 22px', color: '#3c3e3b', fontSize: 21, lineHeight: 1.78 }}>
            Good teams remove a deprecated path deliberately. They observe the bottleneck,
            move data in small batches, and keep rollback boring enough to trust.
          </p>
          <blockquote style={{ margin: '34px 0 0', padding: '7px 0 7px 22px', borderLeft: '3px solid #ff6a3d', color: '#5f615e', fontSize: 18, lineHeight: 1.65 }}>
            Reliability is less about preventing every failure than making the next step obvious.
          </blockquote>
        </article>

        <aside style={{ position: 'relative', paddingTop: 34 }}>
          <div style={{ marginBottom: 15, display: 'flex', justifyContent: 'space-between', color: '#767873', fontFamily: 'var(--font-sans)', fontSize: 11, letterSpacing: '.08em' }}>
            <span>FANFAN MODE</span><strong style={{ color: '#c6431a' }}>4 SAVED WORDS FOUND</strong>
          </div>
          <div style={{ transform: 'scale(.9)', transformOrigin: 'top right' }}>
            <ShadowMount>
              <SavedWordCard
                entry={saved}
                enriching={false}
                enrichFailed={false}
                inLibrary
                onSave={() => {}}
                onRemove={() => {}}
                onClose={() => {}}
              />
            </ShadowMount>
          </div>
        </aside>
      </section>

      <div
        style={{
          position: 'absolute',
          left: 62,
          bottom: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: '#6f716e',
          fontFamily: 'var(--font-sans)',
          fontSize: 12,
        }}
      >
        <BrandMark size={24} />
        <strong style={{ color: '#20232a' }}>翻翻模式</strong>
        <span>收藏过的词留在阅读现场 · 点击即看 · 不再次调用 AI</span>
      </div>
    </main>
  )
}

/** Required 440x280 Chrome Web Store small promotional tile. */
function StorePromoTile() {
  return (
    <div
      style={{
        width: 440,
        height: 280,
        overflow: 'hidden',
        position: 'relative',
        display: 'grid',
        placeItems: 'center',
        background: 'linear-gradient(145deg, #fff1eb 0%, #ffffff 48%, #f1eefb 100%)',
      }}
    >
      <div
        style={{
          position: 'absolute',
          width: 250,
          height: 166,
          borderRadius: 28,
          background: '#5b45b0',
          opacity: 0.08,
          transform: 'translate(88px, 42px) rotate(10deg)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          width: 250,
          height: 166,
          borderRadius: 28,
          background: '#ff6a3d',
          opacity: 0.11,
          transform: 'translate(-92px, -38px) rotate(-10deg)',
        }}
      />
      <div
        style={{
          width: 152,
          height: 152,
          borderRadius: 34,
          display: 'grid',
          placeItems: 'center',
          background: 'rgba(255,255,255,.9)',
          border: '1px solid rgba(20,22,26,.08)',
          boxShadow: '0 24px 60px rgba(28,25,48,.16)',
        }}
      >
        <BrandMark size={104} />
      </div>
    </div>
  )
}

/** Mounts children in a real shadow root with the real content stylesheet. */
function ShadowFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="faint" style={{ marginBottom: 8 }}>
        {title}
      </div>
      <ShadowMount>{children}</ShadowMount>
    </div>
  )
}

function ShadowMount({ children }: { children: React.ReactNode }) {
  return (
    <div
      ref={(host) => {
        if (!host || host.shadowRoot) return
        // In the extension the host is a 0x0 fixed anchor and the layer is
        // positioned by JS. Store previews un-fix it so the real component can
        // be laid out inside the screenshot scene.
        host.style.setProperty('position', 'static', 'important')
        host.style.setProperty('width', 'auto', 'important')
        host.style.setProperty('height', 'auto', 'important')
        host.style.setProperty('display', 'block', 'important')

        const shadow = host.attachShadow({ mode: 'open' })
        const style = document.createElement('style')
        style.textContent = contentStyles
        shadow.appendChild(style)
        const mount = document.createElement('div')
        mount.className = 'layer'
        mount.style.setProperty('position', 'static', 'important')
        shadow.appendChild(mount)
        createRoot(mount).render(children)
      }}
    />
  )
}

/**
 * The dark palette lives in a `prefers-color-scheme` block, so on a dark
 * machine the light half is never seen. Re-declaring the light tokens in a
 * later stylesheet wins on order and lets us inspect both.
 */
function applyForcedTheme(): void {
  const params = new URLSearchParams(location.search)
  if (params.get('theme') !== 'light') return
  const style = document.createElement('style')
  style.textContent = `:root {
    --bg:#f7f7f9; --surface:#ffffff; --surface-soft:#efeff3; --border:#e2e2e9;
    --border-strong:#c9c9d4; --text:#14161a; --text-soft:#565b66; --text-faint:#878d99;
    --primary:#ff6a3d; --primary-strong:#e85426; --primary-soft:#fff1eb;
    --primary-line:#e85426; --primary-ink:#c6431a; --primary-text:#ffffff;
    --accent:#5b45b0; --accent-soft:#f1eefb;
    --success:#0c7d6f; --success-soft:#edf8f5; --warning:#9a5b00;
    --danger:#ce2c31; --danger-soft:#fdecec;
    --level-0:#ce2c31; --level-1:#9a5b00; --level-2:#3b5bc0; --level-3:#0c7d6f;
    color-scheme: light;
  }`
  document.head.appendChild(style)
}

function Harness() {
  const params = new URLSearchParams(location.search)
  const store = params.get('store')
  if (store === 'reader') return <StoreReaderShowcase />
  if (store === 'app') {
    // Chrome Web Store screenshots have an exact aspect ratio. The real app
    // reserves a scrollbar gutter to prevent navigation jumps, but the static
    // capture is one viewport and must not lose those pixels to an empty gutter.
    document.documentElement.style.scrollbarGutter = 'auto'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return <App />
  }
  if (store === 'promo') return <StorePromoTile />
  if (store === 'youtube') return <YouTubeShowcase />
  if (store === 'highlight') return <StoreFanFanModeShowcase />

  const view = params.get('view') ?? 'card'
  /*
   * 预览的语言由这里说了算，不跟着开发者的浏览器走。
   *
   * 不定死的话，同一个预览在两台机器上会长得不一样，而「英文标题被截断」这种问题
   * 只会出现在其中一台上——谁的机器是英文，谁才看得见。
   */
  const [language, setLang] = useState<ResolvedLanguage>('zh-CN')
  useEffect(() => setLanguage('zh-CN'), [])

  const views = [
    { id: 'card', label: '划词卡片' },
    { id: 'popup', label: 'Popup' },
    { id: 'app', label: '学习应用' },
    { id: 'options', label: '设置页' },
    { id: 'feed', label: '信息流（展开重译）' },
  ]

  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 20,
        }}
      >
        <strong style={{ marginRight: 8 }}>UI 预览</strong>
        {views.map((item) => (
          <a
            key={item.id}
            href={`?view=${item.id}`}
            className={view === item.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
          >
            {item.label}
          </a>
        ))}

        {/*
          语言开关。
          这是个双语产品，而中英两版的排版差别很大——英文标题更长、更容易折行或被截断。
          预览如果只能看一种语言，那另一种就只能靠上线之后有人报错才发现。
        */}
        <div style={{ marginLeft: 'auto' }}>
          <SegmentedControl
            value={language}
            options={[
              { value: 'zh-CN', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(next) => {
              setLanguage(next)
              setLang(next)
            }}
          />
        </div>
      </div>

      <div style={{ padding: view === 'app' || view === 'options' ? 0 : 24 }}>
        {view === 'card' ? <CardShowcase /> : null}
        {view === 'popup' ? (
          <div style={{ width: 328, border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <Popup />
          </div>
        ) : null}
        {view === 'app' ? <App /> : null}
        {view === 'options' ? <Options /> : null}
        {view === 'feed' ? <FeedShowcase /> : null}
      </div>
    </div>
  )
}

applyForcedTheme()

void seed().then(() => {
  const container = document.getElementById('root')
  if (container) createRoot(container).render(<Harness />)
})
