import { useEffect, useRef } from 'react'
import { SubtitleControl, mountControl } from '@/content/video/controlButton.ts'
import { SubtitleOverlay } from '@/content/video/subtitleOverlay.ts'
import { injectVideoStyles } from '@/content/video/styles.ts'
import { setLanguage } from '@/i18n/index.ts'
import { BrandMark } from '@/components/icons.tsx'

const source = 'Great products make the next step feel obvious.'
const translation = '好的产品，会让下一步变得自然清晰。'

/**
 * A deterministic Chrome Web Store scene for the YouTube subtitle feature.
 * The video artwork is original scenery; the overlay, button and settings
 * panel are the actual components shipped in the extension.
 */
export function YouTubeShowcase() {
  const playerRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const player = playerRef.current
    const controls = controlsRef.current
    if (!player || !controls) return

    setLanguage('zh-CN')
    injectVideoStyles()

    const overlay = new SubtitleOverlay({ mode: 'bilingual', fontScale: 1.25, background: 0.7 })
    overlay.setPlayerWidth(player.clientWidth)
    overlay.render([{ startMs: 0, endMs: 12_000, text: source }], [translation], 3_000)
    player.append(overlay.element)

    const control = new SubtitleControl(
      {
        enabled: true,
        status: 'on',
        mode: 'bilingual',
        fontScale: 1.25,
        background: 0.7,
        trackLabel: 'English（自动生成）',
        error: '',
      },
      { onToggle() {}, onMode() {}, onFontScale() {}, onBackground() {} },
    )
    mountControl(controls, control)
    player.append(control.panelElement)
    control.buttonElement.click()

    return () => {
      overlay.destroy()
      control.destroy()
    }
  }, [])

  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0f0f0f',
        color: '#fff',
        fontFamily: 'Roboto, Arial, sans-serif',
      }}
    >
      <header
        style={{
          height: 62,
          display: 'grid',
          gridTemplateColumns: '240px 1fr 240px',
          alignItems: 'center',
          padding: '0 28px',
          gap: 28,
          background: '#0f0f0f',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 17 }}>
          <span style={{ fontSize: 24, color: '#f1f1f1' }}>☰</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 800, fontSize: 20 }}>
            <span
              style={{
                width: 31,
                height: 22,
                display: 'grid',
                placeItems: 'center',
                borderRadius: 7,
                background: '#ff0033',
                fontSize: 12,
              }}
            >
              ▶
            </span>
            YouTube
          </div>
        </div>
        <div
          style={{
            height: 38,
            maxWidth: 610,
            width: '100%',
            justifySelf: 'center',
            display: 'flex',
            alignItems: 'center',
            padding: '0 18px',
            border: '1px solid #303030',
            borderRadius: 22,
            color: '#8f8f8f',
            fontSize: 14,
          }}
        >
          搜索
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20 }}>
          <span style={{ color: '#d9d9d9', fontSize: 20 }}>⌕</span>
          <span style={{ color: '#d9d9d9', fontSize: 19 }}>＋</span>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#5b45b0', display: 'grid', placeItems: 'center', fontWeight: 800 }}>L</div>
        </div>
      </header>

      <section style={{ width: 1136, margin: '8px auto 0' }}>
        <div
          id="movie_player"
          ref={playerRef}
          style={{
            position: 'relative',
            width: 1136,
            height: 639,
            overflow: 'hidden',
            borderRadius: 4,
            background: '#18202b',
            boxShadow: '0 18px 70px rgba(0,0,0,.45)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'radial-gradient(circle at 78% 26%, rgba(255,106,61,.28), transparent 24%), radial-gradient(circle at 20% 88%, rgba(91,69,176,.34), transparent 31%), linear-gradient(135deg,#111922 0%,#202c3a 52%,#0f151d 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: 70,
              top: 60,
              color: 'rgba(255,255,255,.58)',
              fontSize: 13,
              letterSpacing: '.18em',
              fontWeight: 700,
            }}
          >
            PRODUCT NOTES · EPISODE 04
          </div>
          <div style={{ position: 'absolute', left: 70, top: 102, width: 510 }}>
            <div style={{ fontSize: 58, lineHeight: 1.02, letterSpacing: '-.055em', fontWeight: 750 }}>
              Design for focus,
              <br />
              not for noise.
            </div>
            <div style={{ width: 86, height: 5, marginTop: 30, borderRadius: 8, background: '#ff6a3d' }} />
          </div>

          <div
            style={{
              position: 'absolute',
              right: 68,
              top: 68,
              width: 380,
              height: 305,
              padding: 26,
              border: '1px solid rgba(255,255,255,.12)',
              borderRadius: 22,
              background: 'rgba(7,11,16,.72)',
              boxShadow: '0 28px 70px rgba(0,0,0,.28)',
              transform: 'rotate(1.5deg)',
            }}
          >
            <div style={{ display: 'flex', gap: 7, marginBottom: 28 }}>
              <i style={{ width: 9, height: 9, borderRadius: '50%', background: '#ff6a3d' }} />
              <i style={{ width: 9, height: 9, borderRadius: '50%', background: '#f4bf4f' }} />
              <i style={{ width: 9, height: 9, borderRadius: '50%', background: '#34b57a' }} />
            </div>
            <pre
              style={{
                margin: 0,
                color: '#cbd5e1',
                fontFamily: "'SFMono-Regular', Consolas, monospace",
                fontSize: 14,
                lineHeight: 1.8,
              }}
            >
              <span style={{ color: '#9b8bea' }}>const</span> product = {'{'}
              {'\n'}  purpose: <span style={{ color: '#82cfa9' }}>'clear'</span>,
              {'\n'}  defaults: <span style={{ color: '#82cfa9' }}>'useful'</span>,
              {'\n'}  attention: <span style={{ color: '#f4a582' }}>'respected'</span>,
              {'\n'}  data: <span style={{ color: '#82cfa9' }}>'yours'</span>,
              {'\n'}{'}'}
            </pre>
          </div>

          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 76,
              background: 'linear-gradient(transparent, rgba(0,0,0,.92))',
            }}
          >
            <div style={{ position: 'absolute', left: 14, right: 14, top: 14, height: 3, background: 'rgba(255,255,255,.35)' }}>
              <div style={{ width: '42%', height: '100%', background: '#f00' }} />
            </div>
            <div style={{ position: 'absolute', left: 18, bottom: 4, height: 48, display: 'flex', alignItems: 'center', gap: 21, fontSize: 19 }}>
              <span>▶</span><span>▮▮</span><span>🔊</span><span style={{ fontSize: 13 }}>6:18 / 14:42</span>
            </div>
            <div ref={controlsRef} className="ytp-right-controls" style={{ position: 'absolute', right: 14, bottom: 4, height: 48, display: 'flex', alignItems: 'center' }}>
              <span style={{ width: 48, textAlign: 'center', fontSize: 18 }}>⚙</span>
              <span style={{ width: 48, textAlign: 'center', fontSize: 18 }}>▭</span>
              <span style={{ width: 48, textAlign: 'center', fontSize: 18 }}>⛶</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 15 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 19, lineHeight: 1.25 }}>Build products people can understand</h1>
            <p style={{ margin: '6px 0 0', color: '#aaa', fontSize: 13 }}>Product Notes · 128K views · English</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 13px', border: '1px solid #303030', borderRadius: 20, color: '#e8e8e8', fontSize: 13 }}>
            <BrandMark size={24} />
            翻翻词卡 · 双语字幕已开启
          </div>
        </div>
      </section>
    </main>
  )
}
