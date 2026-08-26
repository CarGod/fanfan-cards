import { useEffect, useMemo, useState } from 'react'
import { Select, Toggle } from '@/components/index.tsx'
import { BrandMark, ExternalIcon, SettingsIcon } from '@/components/icons.tsx'
import { useActivity, useEntries, useSettings } from '@/components/hooks.ts'
import { computeStreak, todayActivity } from '@/storage/repositories/activityRepo.ts'
import { countDue } from '@/flashcard/scheduler.ts'
import { APP_PAGE } from '@/shared/constants.ts'
import { useI18n } from '@/i18n/react.ts'
import type { ResolvedLanguage } from '@/i18n/index.ts'
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

/**
 * 版本号从 manifest 读，不写死。
 *
 * 写死的版本号只会在某一次发布时忘记改，然后长期显示一个错的数字——而它存在的
 * 全部意义就是「让人一眼看出装的是哪一版」。取不到时返回空串，由调用方决定不渲染，
 * 总比显示一个 `vundefined` 好。
 */
/**
 * 项目主页，跟着**界面语言**走，不跟着浏览器走。
 *
 * 读者把界面切成英文，是在说「英文我读得动」——那这个链接也该带他去英文页，
 * 而不是去一个他刚刚主动切走的语言。
 */
export function aboutUrl(language: ResolvedLanguage): string {
  return language === 'en'
    ? 'https://luffyliu.com/en/fanfan-cards/'
    : 'https://luffyliu.com/fanfan-cards/'
}

function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version ?? ''
  } catch {
    return ''
  }
}

const KEY_LABELS: Record<Exclude<Settings['paragraphTriggerKey'], 'off'>, string> = {
  backtick: '`',
  alt: IS_MAC ? '⌥' : 'Alt',
  ctrl: IS_MAC ? '⌘' : 'Ctrl',
  shift: IS_MAC ? '⇧' : 'Shift',
}

export function Popup() {
  const { t, language } = useI18n()
  const version = extensionVersion()
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
          <div style={{ fontWeight: 700 }}>{t('app.name')}</div>
          <div className="faint">
            {provider.label}
            {settings.provider !== 'mock' && !settings.providers[settings.provider].apiKey
              ? t('popup.provider.no_key')
              : ''}
          </div>
        </div>
        {/*
          版本号贴在页头右上角。
          它不是给读者每天看的，是「出问题时第一个要问的数字」——所以要在
          随手就能打开的地方，但不能抢走三个统计数字的位置。
        */}
        <div className="popup-head-actions">
          {version ? (
            <span className="popup-version" title={t('popup.version.title')}>
              v{version}
            </span>
          ) : null}
          {/*
            设置挪到页头。
            它是「偶尔来一次」的入口，占着底部一整行不值——那一行的高度
            正是弹窗从「一屏装得下」变成「要滚动」的那几十像素之一。
          */}
          <button
            className="icon-btn"
            title={t('popup.action.open_settings')}
            aria-label={t('popup.action.open_settings')}
            onClick={() => {
              void chrome.runtime.openOptionsPage()
              window.close()
            }}
          >
            <SettingsIcon size={16} />
          </button>
        </div>
      </div>

      {/* The popup gets ~200ms of first impression; rendering 0 and then
          snapping to the real number reads as a broken extension. */}
      <div className="popup-stats">
        <div className="card popup-stat">
          <div className="stat-value">{loading ? '—' : stats.total}</div>
          <div className="faint">{t('popup.stat.saved')}</div>
        </div>
        <div className="card popup-stat">
          <div className="stat-value" style={{ color: stats.due > 0 ? 'var(--primary-ink)' : undefined }}>
            {loading ? '—' : stats.due}
          </div>
          <div className="faint">{t('common.due')}</div>
        </div>
        <div className="card popup-stat">
          <div className="stat-value">{loading ? '—' : stats.streak}</div>
          <div className="faint">{t('popup.stat.streak')}</div>
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
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('popup.paragraph.title')}</div>
            <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.paragraphTriggerKey === 'off'
                ? t('popup.paragraph.off')
                : t('popup.paragraph.hint', { key: KEY_LABELS[settings.paragraphTriggerKey] })}
            </div>
          </div>
          <Select
            className="popup-select"
            value={settings.paragraphTriggerKey}
            label={t('popup.paragraph.aria')}
            options={[
              { value: 'backtick', label: KEY_LABELS.backtick },
              { value: 'alt', label: KEY_LABELS.alt },
              { value: 'ctrl', label: KEY_LABELS.ctrl },
              { value: 'shift', label: KEY_LABELS.shift },
              { value: 'off', label: t('common.off') },
            ]}
            onChange={(next) => void update({ paragraphTriggerKey: next })}
          />
        </div>
      </div>

      {/*
        译文怎么显示。整页翻译和悬停整段翻译共用。
        和触发键一样，这是读到一半才会做的决定——「这篇我要快速扫完」和
        「这篇我要对着学」是两种读法，埋进设置页就等于不存在。
      */}
      <div className="card card-pad" style={{ padding: 12, marginBottom: 10 }}>
        <div className="row-between" style={{ gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('popup.display_mode.title')}</div>
            <div className="faint" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {settings.translationMode === 'translationOnly'
                ? t('popup.display_mode.hint_translation_only')
                : t('popup.display_mode.hint_bilingual')}
            </div>
          </div>
          <Select
            className="popup-select"
            value={settings.translationMode}
            label={t('popup.display_mode.aria')}
            options={[
              { value: 'bilingual', label: t('popup.display_mode.bilingual') },
              { value: 'translationOnly', label: t('popup.display_mode.translation_only') },
            ]}
            onChange={(next) => void update({ translationMode: next })}
          />
        </div>
      </div>

      {/*
        两个开关一排。
        它俩回答的是同一个问题——「这个网页上，扩展要做到什么程度」——所以本来就该
        并排；分成两张卡多出来的那几十像素，正是弹窗从「一屏装得下」变成
        「要滚动」的原因之一。
      */}
      <div className="card card-pad popup-duo">
        <div className="popup-duo-item">
          <div className="row-between" style={{ gap: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('fanfan.mode.short')}</div>
            <Toggle
              checked={settings.fanfanMode}
              onChange={(next) => void update({ fanfanMode: next })}
              label={t('fanfan.mode.aria')}
            />
          </div>
          <div className="faint popup-duo-hint">
            {settings.fanfanMode ? t('fanfan.mode.hint_on') : t('fanfan.mode.hint_off')}
          </div>
        </div>

        <div className="popup-duo-line" />

        <div className="popup-duo-item">
          <div className="row-between" style={{ gap: 6 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('popup.site.short')}</div>
            <Toggle
              checked={siteEnabled && settings.enabled}
              onChange={toggleSite}
              label={t('popup.site.aria')}
            />
          </div>
          <div className="faint popup-duo-hint">
            {!settings.enabled
              ? t('popup.site.globally_off')
              : host || t('popup.site.unsupported')}
          </div>
        </div>
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
          {translating ? t('popup.action.restore') : t('popup.action.translate')}
          {shortcuts['translate-page'] ? (
            <span className="key-hint">{shortcuts['translate-page']}</span>
          ) : null}
        </button>
        <button className="btn" onClick={() => open('#/flashcard')}>
          {!loading && stats.due > 0
            ? t('popup.action.review_count', { count: stats.due })
            : t('popup.action.review')}
        </button>
        <button className="btn" onClick={() => open('#/vocabulary')}>
          {t('popup.action.vocabulary')}
        </button>
      </div>

      <div className="popup-foot faint">
        <span>{t('popup.today', { saved: stats.today.saved, reviewed: stats.today.reviewed })}</span>
        <span aria-hidden="true">·</span>
        <button
          className="popup-link"
          onClick={() => {
            void chrome.tabs.create({ url: aboutUrl(language) })
            window.close()
          }}
        >
          {t('popup.about')}
          <ExternalIcon size={11} />
        </button>
      </div>
    </div>
  )
}
