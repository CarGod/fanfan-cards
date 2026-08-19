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

/** Mounts children in a real shadow root with the real content stylesheet. */
function ShadowFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="faint" style={{ marginBottom: 8 }}>
        {title}
      </div>
      <div
        ref={(host) => {
          if (!host || host.shadowRoot) return
          // In the extension the host is a 0x0 fixed anchor and the layer is
          // positioned by JS. For side-by-side inspection we un-fix it inline
          // (inline styles beat the `:host` rule).
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
    </div>
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
    --bg:#f7f8fc; --surface:#ffffff; --surface-soft:#f1f2f8; --border:#e4e6ef;
    --border-strong:#d3d6e3; --text:#191d27; --text-soft:#5a6272; --text-faint:#8c94a5;
    --primary:#5b5bd6; --primary-soft:#eeeefc; --primary-text:#ffffff;
    --success:#0f9d76; --success-soft:#e4f7f1; --warning:#c2820b;
    --danger:#d1435b; --danger-soft:#fdedef;
    --shadow:0 1px 2px rgba(16,22,43,.05), 0 8px 28px rgba(16,22,43,.07);
    --level-0:#d1435b; --level-1:#c2820b; --level-2:#3b82c4; --level-3:#0f9d76;
    color-scheme: light;
  }`
  document.head.appendChild(style)
}

function Harness() {
  const view = new URLSearchParams(location.search).get('view') ?? 'card'
  const views = [
    { id: 'card', label: '划词卡片' },
    { id: 'popup', label: 'Popup' },
    { id: 'app', label: '学习应用' },
    { id: 'options', label: '设置页' },
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
      </div>
    </div>
  )
}

applyForcedTheme()

void seed().then(() => {
  const container = document.getElementById('root')
  if (container) createRoot(container).render(<Harness />)
})
