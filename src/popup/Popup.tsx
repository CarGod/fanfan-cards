import { useEffect, useMemo, useState } from 'react'
import { Toggle } from '@/components/index.tsx'
import { BrandMark } from '@/components/icons.tsx'
import { useActivity, useEntries, useSettings } from '@/components/hooks.ts'
import { computeStreak, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue } from '@/flashcard/scheduler.ts'
import { APP_PAGE, APP_SHORT_NAME } from '@/shared/constants.ts'
import { providerMeta, type Settings } from '@/types/settings.ts'
import { unique } from '@/shared/utils.ts'

/**
 * The popup is a launcher and a switch, not a workspace.
 *
 * Three numbers, one per-site toggle, three buttons. Anything that needs
 * scrolling belongs in the app page.
 */
/**
 * Key labels, in the symbols the user's own keyboard is wearing.
 *
 * `Alt` is one declaration in the manifest and two different keycaps in the
 * world; showing a Mac reader "Alt" makes them look for a key that is not there.
 */
const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.userAgent)

const KEY_LABELS: Record<Exclude<Settings['paragraphTriggerKey'], 'off'>, string> = {
  backtick: '`',
  alt: IS_MAC ? '⌥' : 'Alt',
  ctrl: IS_MAC ? '⌘' : 'Ctrl',
  shift: IS_MAC ? '⇧' : 'Shift',
}

export function Popup() {
  const { entries, loading } = useEntries()
  const activity = useActivity()
  const { settings, update } = useSettings()
  const [host, setHost] = useState('')
  const [tabId, setTabId] = useState<number | null>(null)
  const [translating, setTranslating] = useState(false)
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({})

  useEffect(() => {
    // Show the binding the user actually has, not the one we suggested — they
    // may well have changed it.
    void chrome.commands?.getAll().then((commands) => {
      const map: Record<string, string> = {}
      for (const command of commands) {
        if (command.name && command.shortcut) map[command.name] = command.shortcut
      }
      setShortcuts(map)
    })
  }, [])

  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
      const tab = tabs[0]
      const url = tab?.url ?? ''
      try {
        setHost(new URL(url).hostname)
      } catch {
        setHost('')
      }
      if (tab?.id === undefined) return
      setTabId(tab.id)

      // Host-keyed, like the worker stores it: a tab id would go stale the
      // moment the site navigated.
      const host = (() => {
        try {
          return new URL(url).hostname
        } catch {
          return ''
        }
      })()
      if (!host) return
      const key = `ara:translateHost:${host}`
      const stored = await chrome.storage.session.get(key)
      setTranslating(stored[key] === true)
    })
  }, [])

  const togglePageTranslation = () => {
    if (tabId === null) return
    void chrome.tabs
      .sendMessage(tabId, { type: 'content/toggle-page-translation' })
      .catch(() => undefined)
    window.close()
  }

  const stats = useMemo(() => {
    const now = Date.now()
    return {
      total: entries.length,
      due: countDue(entries, now),
      streak: computeStreak(activity, now),
      today: todayActivity(activity, now),
    }
  }, [entries, activity])

  const siteEnabled = host ? !settings.blockedHosts.includes(host) : true
  const provider = providerMeta(settings.provider)

  const open = (route: string) => {
    void chrome.tabs.create({ url: chrome.runtime.getURL(`${APP_PAGE}${route}`) })
    window.close()
  }

  const toggleSite = (next: boolean) => {
    if (!host) return
    const blocked = next
      ? settings.blockedHosts.filter((item) => item !== host)
      : unique([...settings.blockedHosts, host])
    void update({ blockedHosts: blocked })
  }

  return (
    <div className="popup">
      <div className="popup-head">
        <BrandMark size={26} />
        <div style={{ lineHeight: 1.3 }}>
          <div style={{ fontWeight: 700 }}>{APP_SHORT_NAME}</div>
          <div className="faint">
            {provider.label}
            {settings.provider !== 'mock' && !settings.providers[settings.provider].apiKey
              ? ' · 未配置 Key'
              : ''}
          </div>
        </div>
      </div>

      {/* The popup gets ~200ms of first impression; rendering 0 and then
          snapping to the real number reads as a broken extension. */}
      <div className="popup-stats">
        <div className="card popup-stat">
          <div className="stat-value">{loading ? '—' : stats.total}</div>
          <div className="faint">收藏</div>
        </div>
        <div className="card popup-stat">
          <div className="stat-value" style={{ color: stats.due > 0 ? 'var(--primary-ink)' : undefined }}>
            {loading ? '—' : stats.due}
          </div>
          <div className="faint">待复习</div>
        </div>
        <div className="card popup-stat">
          <div className="stat-value">{loading ? '—' : stats.streak}</div>
          <div className="faint">连续天数</div>
        </div>
      </div>

      {/*
        The paragraph gesture belongs here rather than only in settings: it is
        something you reach for mid-article — "this page is fine, that bit is
        not" — so burying it a page away means never changing it.
      */}
      <div className="card card-pad" style={{ padding: 12, marginBottom: 10 }}>
        <div className="row-between" style={{ gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>整段翻译</div>
            <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.paragraphTriggerKey === 'off'
                ? '已关闭'
                : `悬停 + ${KEY_LABELS[settings.paragraphTriggerKey]} 翻译这一段`}
            </div>
          </div>
          <select
            className="popup-select"
            value={settings.paragraphTriggerKey}
            aria-label="整段翻译触发键"
            onChange={(event) =>
              void update({
                paragraphTriggerKey: event.target.value as Settings['paragraphTriggerKey'],
              })
            }
          >
            <option value="backtick">{KEY_LABELS.backtick}</option>
            <option value="alt">{KEY_LABELS.alt}</option>
            <option value="ctrl">{KEY_LABELS.ctrl}</option>
            <option value="shift">{KEY_LABELS.shift}</option>
            <option value="off">关闭</option>
          </select>
        </div>
      </div>

      <div className="card card-pad" style={{ padding: 12, marginBottom: 12 }}>
        <div className="row-between">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>在此网站启用划词</div>
            <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {host || '当前页面不支持'}
            </div>
          </div>
          <Toggle checked={siteEnabled && settings.enabled} onChange={toggleSite} label="在此网站启用" />
        </div>
        {!settings.enabled ? (
          <div className="faint" style={{ marginTop: 8 }}>
            扩展已全局关闭，可在设置页重新开启。
          </div>
        ) : null}
      </div>

      <div className="popup-actions">
        {/* Translating the page you are on is the thing you came here to do;
            reviewing is something you choose to sit down for. */}
        <button
          className={translating ? 'btn btn-on' : 'btn btn-primary'}
          onClick={togglePageTranslation}
          disabled={tabId === null}
          title={shortcuts['translate-page'] ?? 'Alt+A'}
        >
          {translating ? '还原原文' : '翻译整页'}
          {shortcuts['translate-page'] ? (
            <span className="key-hint">{shortcuts['translate-page']}</span>
          ) : null}
        </button>
        <button className="btn" onClick={() => open('#/flashcard')}>
          {!loading && stats.due > 0 ? `开始复习 ${stats.due} 张卡片` : '进入闪卡复习'}
        </button>
        <button className="btn" onClick={() => open('#/vocabulary')}>
          打开词卡
        </button>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => open('#/dashboard')}>
            学习面板
          </button>
          <button
            className="btn btn-ghost"
            style={{ flex: 1 }}
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            设置
          </button>
        </div>
      </div>

      <div className="faint" style={{ marginTop: 10, textAlign: 'center' }}>
        今日 +{stats.today.saved} 词 · 复习 {stats.today.reviewed} 张
      </div>
    </div>
  )
}
