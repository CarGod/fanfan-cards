import { useI18n } from '@/i18n/react.ts'

/**
 * `Alt` in a manifest is already cross-platform: Chrome renders it as Alt on
 * Windows and Linux and maps it to Option on macOS, from the same declaration.
 * Only the human-readable hint has to differ, so this is the one place that
 * needs to know which machine it is on.
 */
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent)
const ALT = IS_MAC ? 'Option' : 'Alt'

/*
 * 键名放表里，文案在渲染时才取——常量表是模块加载时求值的，写死 `t()` 的结果
 * 会让切换界面语言之后这里还是旧语言。按键本身（Option / Alt）不是文案，
 * 它跟的是这台机器，不是界面语言。
 */
const COMMANDS = [
  { name: 'translate-page', label: 'options.shortcut.translate_page', keys: `${ALT} + A` },
  {
    name: 'explain-selection',
    label: 'options.shortcut.explain_selection',
    keys: `${ALT} + Shift + E`,
  },
  { name: 'open-app', label: 'options.shortcut.open_app', keys: `${ALT} + Shift + A` },
] as const

/**
 * Keyboard shortcuts.
 *
 * Chrome deliberately gives extensions no way to set a shortcut: only the user
 * can, from `chrome://extensions/shortcuts`, so that no extension can quietly
 * claim a key you use for something else. All this page can do is read the
 * current binding and take you there — which is worth saying out loud, because
 * otherwise a settings page that shows a shortcut but will not let you edit it
 * reads as broken.
 */
export function ShortcutSection({ shortcuts }: { shortcuts: Record<string, string> }) {
  const { t } = useI18n()

  return (
    <section className="card section-card">
      <div className="section-title">{t('options.shortcut.title')}</div>
      <div className="section-desc">
        {t('options.shortcut.desc_lead')}
        <strong>{t('options.shortcut.desc_em')}</strong>
        {t('options.shortcut.desc_tail')}
      </div>

      <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
        {COMMANDS.map((command) => (
          <div className="row-between" key={command.name}>
            <span>
              {t(command.label)}
              {command.keys ? (
                <span className="faint">
                  {' · '}
                  {t('options.shortcut.default', { keys: command.keys })}
                </span>
              ) : null}
            </span>
            <span className={shortcuts[command.name] ? 'chip mono' : 'faint'}>
              {shortcuts[command.name] || t('options.shortcut.unset')}
            </span>
          </div>
        ))}
      </div>

      <button
        className="btn"
        onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
      >
        {t('options.shortcut.open_chrome')}
      </button>
    </section>
  )
}
