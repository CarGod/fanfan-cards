/**
 * `Alt` in a manifest is already cross-platform: Chrome renders it as Alt on
 * Windows and Linux and maps it to Option on macOS, from the same declaration.
 * Only the human-readable hint has to differ, so this is the one place that
 * needs to know which machine it is on.
 */
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent)
const ALT = IS_MAC ? 'Option' : 'Alt'

const COMMANDS = [
  { name: 'translate-page', label: '翻译 / 还原整页', note: `默认 ${ALT} + A` },
  { name: 'explain-selection', label: '解释选中的英文', note: `默认 ${ALT} + Shift + E` },
  { name: 'open-app', label: '打开词卡与复习', note: `默认 ${ALT} + Shift + A` },
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
  return (
    <section className="card section-card">
      <div className="section-title">快捷键</div>
      <div className="section-desc">
        Chrome 只允许你本人修改扩展快捷键——这是它的安全设计，扩展无法自行占用按键。
        下面显示的是当前<strong>实际生效</strong>的绑定（Chrome 会按你的系统显示，
        macOS 上的 Option 就是 Windows 上的 Alt）。
      </div>

      <div className="stack" style={{ gap: 10, marginBottom: 16 }}>
        {COMMANDS.map((command) => (
          <div className="row-between" key={command.name}>
            <span>
              {command.label}
              {command.note ? <span className="faint"> · {command.note}</span> : null}
            </span>
            <span className={shortcuts[command.name] ? 'chip mono' : 'faint'}>
              {shortcuts[command.name] || '未设置'}
            </span>
          </div>
        ))}
      </div>

      <button
        className="btn"
        onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
      >
        去 Chrome 修改快捷键
      </button>
    </section>
  )
}
