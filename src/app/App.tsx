import { BrandMark } from '@/components/icons.tsx'
import { useHashRoute } from '@/components/hooks.ts'
import { APP_SHORT_NAME } from '@/shared/constants.ts'
import { Dashboard } from '@/dashboard/Dashboard.tsx'
import { VocabularyPage } from '@/vocabulary/VocabularyPage.tsx'
import { FlashcardPage } from '@/flashcard/FlashcardPage.tsx'

const ROUTES = [
  { hash: '#/dashboard', label: '学习面板' },
  { hash: '#/vocabulary', label: '词卡' },
  { hash: '#/flashcard', label: '闪卡复习' },
] as const

/**
 * The learning app: one tab, three surfaces.
 *
 * Dashboard, vocabulary and flashcards share the same live store, so they are
 * one page with hash routes rather than three extension pages — switching
 * between them keeps state and costs no reload.
 */
export function App() {
  const [route, navigate] = useHashRoute('#/dashboard')

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <BrandMark size={26} />
          {APP_SHORT_NAME}
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
              {item.label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void chrome.runtime.openOptionsPage()}>
          设置
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
