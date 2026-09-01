/**
 * Inline SVG icons.
 *
 * Emoji were a shortcut and they look wrong here: they render in the platform's
 * colour font, so they ignore the card's palette, change shape between macOS,
 * Windows and Linux, and sit on a different optical baseline from the text
 * beside them. These are stroke icons on `currentColor`, so they inherit the
 * theme and stay identical everywhere.
 *
 * Deliberately dependency-free and importable from the content script, which
 * must not pull in the page bundle.
 */
interface IconProps {
  size?: number
  className?: string
}

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }
}

/** Speaker with two waves — reads as "play audio" at 16px. */
export function SpeakerIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M11 5 6 9H2v6h4l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5.2a10 10 0 0 1 0 13.6" />
    </svg>
  )
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

/**
 * 书签。空心 = 还没收，实心 = 已经在词库里。
 *
 * 只靠颜色区分这两种状态是不够的：图标只有 16px，而「收了没有」是读者在这张卡上
 * 最想一眼确认的事。填充是形状上的差别，扫一眼就分得出来，也不依赖辨色能力。
 */
export function BookmarkIcon({ size = 16, className, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})} fill={filled ? 'currentColor' : 'none'}>
      <path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
    </svg>
  )
}

export function CheckIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

export function TrashIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

/**
 * 齿轮。
 *
 * 必须是**连着的轮廓**，不能是从圆心射出去的辐条——第一版就是那么画的，
 * 渲染出来是一个太阳。齿轮之所以读作「设置」，靠的是齿和轮缘连成一体，
 * 而不是「圆心周围有八根线」。
 *
 * 这个尺寸下齿轮是最没有歧义的那个符号：滑块要两个才认得出来，三个点是「更多」。
 */
export function SettingsIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}

/** 斜向外的箭头：这个链接会把你带出这个弹窗。 */
export function ExternalIcon({ size = 12, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

export function ArrowLeftIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  )
}

export function ArrowRightIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size)} {...(className ? { className } : {})}>
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

/**
 * The 翻翻词卡 mark — a card with its top-right corner turned.
 *
 * Three meanings in two shapes: the fold is the gesture the product is named
 * after (翻), the rounded rectangle is the card itself, and lifting a corner is
 * what "look at the other side" looks like. It carries none of the vocabulary
 * of a translation tool — no globe, no A→文, no two-way arrows — which is the
 * whole point. See `docs/BRAND_GUIDELINE.md`.
 *
 * The colours are fixed rather than themed: a logo is a constant, and the fold
 * has to stay near-white against the flame tile in both themes. Pass `mono` for
 * the single-colour form (print, watermark, disabled states), which inherits
 * `currentColor` instead.
 *
 * Below 24px the two text lines on the card face are dropped. At 16px a 5.5-unit
 * bar is well under one physical pixel and would only render as grey haze — the
 * mark has to survive as "card + fold" alone, so it is drawn that way rather
 * than scaled down and hoped for.
 */
interface MarkProps extends IconProps {
  /** Render in `currentColor` only, for print, watermarks and disabled states. */
  mono?: boolean
}

export function BrandMark({ size = 26, className, mono = false }: MarkProps) {
  const svg = {
    width: size,
    height: size,
    viewBox: '0 0 64 64',
    'aria-hidden': true,
    focusable: false,
    ...(className ? { className } : {}),
  }
  const CARD = 'M14 6h27l17 17v27a8 8 0 0 1-8 8H14a8 8 0 0 1-8-8V14a8 8 0 0 1 8-8Z'

  // Mono is not "the same shapes in one colour" — a filled tile leaves nothing
  // for the fold to read against. It becomes an outline, where the fold is the
  // two inner edges of the turned corner.
  if (mono) {
    return (
      <svg {...svg}>
        <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="round" strokeLinecap="round">
          <path d={CARD} />
          <path d="M41 7v16h16" />
        </g>
      </svg>
    )
  }

  return (
    <svg {...svg}>
      <path d={CARD} fill="#FF6A3D" />
      {size >= 24 ? (
        <>
          <rect x="14" y="33" width="24" height="5.5" rx="2.75" fill="#FFF0E6" opacity="0.92" />
          <rect x="14" y="44" width="15" height="5.5" rx="2.75" fill="#FFF0E6" opacity="0.5" />
        </>
      ) : null}
      <path d="M41 6 58 23H41Z" fill="#FFC6AE" />
    </svg>
  )
}
