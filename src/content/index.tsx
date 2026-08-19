import { createRoot, type Root } from 'react-dom/client'
import { CONTENT_HOST_ID } from '@/shared/constants.ts'
import { warmUpVoices } from '@/services/speech.ts'
import styles from './styles.css?inline'
import { App } from './ui/App.tsx'

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

const root = mount()
if (root) {
  warmUpVoices()
  // Chrome fires this when the extension is reloaded or updated; without the
  // teardown the page keeps a React tree bound to a dead message channel.
  window.addEventListener('pagehide', () => root.unmount(), { once: true })
}
