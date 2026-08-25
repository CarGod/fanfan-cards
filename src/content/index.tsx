import { createRoot, type Root } from 'react-dom/client'
import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { warmUpVoices } from '@/services/speech.ts'
import styles from './styles.css?inline'
import { App } from './ui/App.tsx'
import { YouTubeSubtitles } from './video/youtube.ts'

/**
 * Content-script bootstrap.
 *
 * Three constraints shape this file:
 * 1. The host page must not be able to style us, and we must not be able to
 *    style it -> a shadow root with its own inlined stylesheet. `mode: 'open'`
 *    is deliberate: it costs nothing (a hostile page could reach the element
 *    either way) and makes the UI inspectable in DevTools.
 * 2. The extension may be injected twice (SPA navigation, manual re-inject) ->
 *    the host element id is checked first and the second run is a no-op.
 * 3. Some pages must be left alone entirely (our own pages, embedded frames).
 */

function shouldRun(): boolean {
  if (window.top !== window.self) return false // skip iframes: ads, embeds, players
  if (document.getElementById(CONTENT_HOST_ID)) return false
  const scheme = location.protocol
  return scheme === 'http:' || scheme === 'https:' || scheme === 'file:'
}

function mount(): Root | null {
  if (!shouldRun()) return null

  const host = document.createElement('div')
  host.id = CONTENT_HOST_ID
  // Our users are exactly the people who also run a page-translation extension.
  // Without these, a translator walks into our UI and translates the AI's
  // Chinese explanation into Chinese again.
  host.setAttribute('translate', 'no')
  host.classList.add('notranslate')
  // Attached to <html> rather than <body>: a transformed <body> would turn our
  // fixed positioning into containing-block-relative positioning.
  document.documentElement.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const sheet = document.createElement('style')
  sheet.textContent = styles
  shadow.appendChild(sheet)

  const container = document.createElement('div')
  shadow.appendChild(container)

  const root = createRoot(container)
  root.render(<App host={host} />)
  return root
}

/**
 * YouTube 走一条自己的路：字幕层和控制栏按钮长在播放器的 DOM 里，不在我们的 shadow
 * root 里——播放器全屏、剧场模式、迷你播放器的定位全靠它，自己另起一套只会更差。
 */
function mountYouTube(): YouTubeSubtitles | null {
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return null
  const subtitles = new YouTubeSubtitles()
  void subtitles.start()
  return subtitles
}

const root = mount()
if (root) {
  warmUpVoices()
  const subtitles = mountYouTube()
  // Chrome fires this when the extension is reloaded or updated; without the
  // teardown the page keeps a React tree bound to a dead message channel.
  window.addEventListener(
    'pagehide',
    () => {
      subtitles?.destroy()
      root.unmount()
    },
    { once: true },
  )
}
