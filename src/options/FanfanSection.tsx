import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Toggle } from '@/components/index.tsx'
import { useI18n } from '@/i18n/react.ts'
import {
  DEFAULT_FANFAN_PALETTE,
  FANFAN_PALETTE_LIST,
  type FanfanPaletteId,
} from '@/shared/fanfanPalette.ts'
import type { Settings } from '@/types/settings.ts'

const LEVEL_KEYS = [
  'fanfan.level.new',
  'fanfan.level.learning',
  'fanfan.level.familiar',
  'fanfan.level.mastered',
] as const

const BACKDROP_KEYS = {
  light: 'fanfan.palette.light',
  dark: 'fanfan.palette.dark',
} as const

export function FanfanSection({
  settings,
  update,
}: {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
}) {
  const { t } = useI18n()
  /*
   * Radio groups have one tab stop, not six independent buttons.
   *
   * Keep the selected item optimistic so aria-checked/tabIndex change in the
   * same interaction as the key press; chrome.storage can finish a moment
   * later. An update arriving from another extension surface still wins via
   * the effect below.
   */
  const [selectedPalette, setSelectedPalette] = useState<FanfanPaletteId>(
    settings.fanfanPalette ?? DEFAULT_FANFAN_PALETTE,
  )
  const paletteRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => setSelectedPalette(settings.fanfanPalette), [settings.fanfanPalette])

  const commitPalette = (index: number, moveFocus: boolean): void => {
    const palette = FANFAN_PALETTE_LIST[index]
    if (!palette) return
    setSelectedPalette(palette.id)
    void update({ fanfanPalette: palette.id })
    if (moveFocus) paletteRefs.current[index]?.focus()
  }

  const onPaletteKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const total = FANFAN_PALETTE_LIST.length
    /* Two columns above 620px, one below it — the same breakpoint as ui.css. */
    const columns =
      typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 620px)').matches
        ? 1
        : 2
    let next: number | null = null

    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % total
        break
      case 'ArrowLeft':
        next = (index - 1 + total) % total
        break
      case 'ArrowDown':
        next = (index + columns) % total
        break
      case 'ArrowUp':
        next = (index - columns + total) % total
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = total - 1
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        commitPalette(index, false)
        return
      default:
        return
    }

    event.preventDefault()
    commitPalette(next, true)
  }

  const selectedIndex = Math.max(
    0,
    FANFAN_PALETTE_LIST.findIndex((palette) => palette.id === selectedPalette),
  )

  return (
    <section className="card section-card fanfan-settings">
      <div className="section-title">{t('fanfan.mode.title')}</div>
      <div className="section-desc">{t('fanfan.options.hint')}</div>

      <div className="fanfan-setting-row">
        <div>
          <div className="fanfan-setting-label">{t('fanfan.mode.enable')}</div>
          <div className="faint">
            {settings.fanfanMode ? t('fanfan.mode.hint_on') : t('fanfan.mode.hint_off')}
          </div>
        </div>
        <Toggle
          checked={settings.fanfanMode}
          onChange={(next) => void update({ fanfanMode: next })}
          label={t('fanfan.mode.aria')}
        />
      </div>

      <div className="fanfan-theme-heading">
        <div>
          <div className="fanfan-setting-label">{t('fanfan.palette.title')}</div>
          <div className="faint">{t('fanfan.palette.hint')}</div>
        </div>
      </div>

      <div
        className="fanfan-palette-grid"
        role="radiogroup"
        aria-label={t('fanfan.palette.aria')}
      >
        {FANFAN_PALETTE_LIST.map((palette, index) => {
          const active = index === selectedIndex
          return (
            <button
              type="button"
              className="fanfan-palette-option"
              data-active={active}
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              key={palette.id}
              ref={(element) => {
                paletteRefs.current[index] = element
              }}
              onClick={() => commitPalette(index, false)}
              onKeyDown={(event) => onPaletteKeyDown(event, index)}
            >
              <span className="fanfan-palette-head">
                <strong>{t(palette.labelKey)}</strong>
                {palette.id === 'warmField' ? (
                  <span className="fanfan-recommended">{t('fanfan.palette.recommended')}</span>
                ) : null}
              </span>
              <span className="fanfan-palette-summary">{t(palette.summaryKey)}</span>
              <span className="fanfan-palette-preview" aria-hidden="true">
                {(['light', 'dark'] as const).map((backdrop) => (
                  <span className="fanfan-preview-row" data-backdrop={backdrop} key={backdrop}>
                    <span className="fanfan-preview-label">
                      {t(BACKDROP_KEYS[backdrop])}
                    </span>
                    <span className="fanfan-preview-swatches">
                      {palette[backdrop].map((color, level) => (
                        <span
                          className="fanfan-preview-swatch"
                          data-level={level}
                          key={color}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </span>
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>

      <div className="fanfan-level-legend" aria-label={t('fanfan.levels.aria')}>
        {LEVEL_KEYS.map((key, level) => (
          <span key={key}>
            <i aria-hidden="true">{level}</i>
            {t(key)}
          </span>
        ))}
      </div>

      <div className="fanfan-setting-row fanfan-mastered-row">
        <div>
          <div className="fanfan-setting-label">{t('fanfan.mastered.title')}</div>
          <div className="faint">
            {settings.fanfanShowMastered
              ? t('fanfan.mastered.hint_on')
              : t('fanfan.mastered.hint_off')}
          </div>
        </div>
        <Toggle
          checked={settings.fanfanShowMastered}
          onChange={(next) => void update({ fanfanShowMastered: next })}
          label={t('fanfan.mastered.aria')}
        />
      </div>

      <div className="banner fanfan-backdrop-note">{t('fanfan.palette.backdrop_note')}</div>
    </section>
  )
}
