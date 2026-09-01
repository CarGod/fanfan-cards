import { BrandMark } from '@/components/icons.tsx'
import { useHashRoute } from '@/components/hooks.ts'
import { Dashboard } from '@/dashboard/Dashboard.tsx'
import { VocabularyPage } from '@/vocabulary/VocabularyPage.tsx'
import { FlashcardPage } from '@/flashcard/FlashcardPage.tsx'
import { useI18n } from '@/i18n/react.ts'
import { type MessageKey } from '@/i18n/index.ts'

// 存键而不是存文案：这个常量在模块加载时就求值了，那时用户的语言偏好还没读出来。
// 真正的取词推迟到渲染里的 `t(item.labelKey)`，切换语言才跟得上。
const ROUTES: ReadonlyArray<{ hash: string; labelKey: MessageKey }> = [
  { hash: '#/dashboard', labelKey: 'common.dashboard' },
  { hash: '#/vocabulary', labelKey: 'app.nav.vocabulary' },
  { hash: '#/flashcard', labelKey: 'app.nav.flashcard' },
]

/**
 * The learning app: one tab, three surfaces.
 *
 * Dashboard, vocabulary and flashcards share the same live store, so they are
 * one page with hash routes rather than three extension pages — switching
 * between them keeps state and costs no reload.
 */
export function App() {
  const { t } = useI18n()
  const [route, navigate] = useHashRoute('#/dashboard')

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <BrandMark size={26} />
          {t('app.name')}
        </div>
        <nav className="nav">
          {ROUTES.map((item) => (
            <a
              key={item.hash}
              href={item.hash}
              data-active={route.startsWith(item.hash)}
              onClick={(event) => {
                event.preventDefault()
                navigate(item.hash)
              }}
            >
              {t(item.labelKey)}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void chrome.runtime.openOptionsPage()}>
          {t('common.settings')}
        </button>
      </header>

      <main className="app-main">
        {route.startsWith('#/vocabulary') ? <VocabularyPage /> : null}
        {route.startsWith('#/flashcard') ? <FlashcardPage onNavigate={navigate} /> : null}
        {!route.startsWith('#/vocabulary') && !route.startsWith('#/flashcard') ? (
          <Dashboard onNavigate={navigate} />
        ) : null}
      </main>
    </div>
  )
}
