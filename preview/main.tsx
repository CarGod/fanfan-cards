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
import './chrome-stub.ts'
import { SAMPLE_EXPLANATION } from './chrome-stub.ts'
import { createRoot } from 'react-dom/client'
import { BrandMark } from '@/components/icons.tsx'
import '@/components/ui.css'
import contentStyles from '@/content/styles.css?inline'
import { CardError, CardSkeleton, WordCard } from '@/content/ui/WordCard.tsx'
import { App } from '@/app/App.tsx'
import { Popup } from '@/popup/Popup.tsx'
import { Options } from '@/options/Options.tsx'
import { FeedShowcase } from './FeedShowcase.tsx'
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

const WORDS: VocabularyEntry[] = [
  entry('w1', 'migration'),
  entry(
    'w2',
    'deprecated',
    {
      meaning: '已弃用的；不推荐使用的',
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
          onOpenBook={() => {}}
          onClose={() => {}}
        />
      </ShadowFrame>

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
            onOpenBook={() => {}}
            onClose={() => {}}
          />
        </ShadowMount>
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

  const view = params.get('view') ?? 'card'
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
