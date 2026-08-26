import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The design system, enforced.
 *
 * A bright orange brand colour buys shelf recognition and charges for it: at
 * #ff6a3d it scores 2.85:1 on white, so it works as a fill and fails as text,
 * as a hairline, and as a focus ring. `design-token.css` documents the split
 * (`--primary` / `--primary-line` / `--primary-ink`) — but documentation does
 * not survive contact with a hurried edit.
 *
 * Both checks below started as real defects: seven components were painting
 * links, focus rings, spinners and active borders with the fill colour, and the
 * contextual explanation wore the brand colour on one surface and the AI colour
 * on the other.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

// ---------------------------------------------------------------- contrast

function relativeLuminance(hex: string): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

/** Every `--name: value` inside the first `{ ... }` of a block. */
function declarations(block: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    map.set(name!, value!.trim())
  }
  return map
}

/** Resolves `var(--a)` chains down to a literal hex. */
function resolve(map: Map<string, string>, name: string, depth = 0): string {
  const value = map.get(name)
  if (value === undefined) throw new Error(`token not defined: ${name}`)
  if (depth > 8) throw new Error(`token cycle at ${name}`)
  const reference = /^var\((--[\w-]+)\)$/.exec(value)
  if (reference) return resolve(map, reference[1]!, depth + 1)
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} is not a plain hex: ${value}`)
  return value
}

function themes() {
  const css = stripComments(read('./design-token.css'))

  // The light palette is the first `:root, :host` block; dark overrides sit in
  // the prefers-color-scheme block and are layered on top.
  const blocks = [...css.matchAll(/:root,\s*:host\s*\{([\s\S]*?)\n\s*\}/g)].map((m) => m[1]!)
  expect(blocks.length, 'expected a light block and a dark block').toBe(2)

  const light = declarations(blocks[0]!)
  const dark = new Map(light)
  for (const [name, value] of declarations(blocks[1]!)) dark.set(name, value)
  return { light, dark }
}

/**
 * Deliberate deviations from AA, recorded rather than removed.
 *
 * Pinned to the measured ratio (±0.05) so that changing the brand colour makes
 * the test fail and forces the decision to be taken again, instead of letting
 * the shortfall drift quietly.
 */
const EXCEPTIONS: Array<[string, string, number, string]> = [
  [
    '--primary-text',
    '--primary',
    2.85,
    'White on flame is 2.85:1, below AA. Chosen over dark ink (6.37:1) because ' +
      'black on orange is the hazard palette, and over deepening the fill to ' +
      '#d14926/#c6431a because that reads brick and split the mark from the button.',
  ],
]

/** [foreground, background, minimum]. AA: 4.5 for text, 3 for UI elements. */
const PAIRS: Array<[string, string, number]> = [
  ['--text', '--surface', 4.5],
  ['--text', '--bg', 4.5],
  ['--text-soft', '--surface', 4.5],
  ['--text-faint', '--surface', 3],
  ['--primary-ink', '--surface', 4.5],
  ['--primary-line', '--surface', 3],
  ['--primary-ink', '--primary-soft', 4.5],
  ['--accent', '--surface', 4.5],
  ['--accent', '--accent-soft', 4.5],
  ['--success', '--surface', 4.5],
  ['--warning', '--surface', 4.5],
  ['--danger', '--surface', 4.5],
  ['--danger', '--danger-soft', 4.5],
  ['--success', '--success-soft', 4.5],
  ['--level-0', '--surface', 3],
  ['--level-1', '--surface', 3],
  ['--level-2', '--surface', 3],
  ['--level-3', '--surface', 3],
]

describe('design tokens', () => {
  it('declares on :host as well as :root, or the reading card loses every token', () => {
    // The card lives in a shadow root, which cannot see the page's :root. A
    // token file that targets :root alone fails silently on the one surface
    // that matters most.
    expect(stripComments(read('./design-token.css'))).toMatch(/:root,\s*:host\s*\{/)
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${theme}: ${fg} on ${bg} meets ${min}:1`, () => {
        const map = themes()[theme]
        const ratio = contrast(resolve(map, fg), resolve(map, bg))
        expect(Number(ratio.toFixed(2))).toBeGreaterThanOrEqual(min)
      })
    }
  }

  for (const [fg, bg, expected, why] of EXCEPTIONS) {
    it(`light: ${fg} on ${bg} is a known ${expected}:1 deviation — ${why.slice(0, 48)}…`, () => {
      const ratio = contrast(resolve(themes().light, fg), resolve(themes().light, bg))
      expect(ratio).toBeGreaterThan(expected - 0.05)
      expect(ratio).toBeLessThan(expected + 0.05)
    })
  }

  it('keeps a separate line colour wherever the fill is too weak to be a hairline', () => {
    for (const theme of ['light', 'dark'] as const) {
      const map = themes()[theme]
      const fill = resolve(map, '--primary')
      if (contrast(fill, resolve(map, '--surface')) >= 3) continue
      // The fill cannot carry a 1px border here, so --primary-line must be a
      // genuinely different, darker value — not an alias of --primary.
      expect(resolve(map, '--primary-line'), `${theme}: --primary-line`).not.toBe(fill)
      expect(contrast(resolve(map, '--primary-line'), resolve(map, '--surface'))).toBeGreaterThanOrEqual(3)
    }
  })
})

// -------------------------------------------------------------- stylesheet

/** Properties that paint text or a hairline, where the fill colour fails AA. */
const FILL_ONLY_VIOLATION =
  /(?:^|[;{]\s*)(color|border(?:-(?:top|right|bottom|left))?-color|outline|outline-color|fill|stroke|border(?:-(?:top|right|bottom|left))?)\s*:[^;]*var\(--primary\)/

describe('stylesheets', () => {
  for (const file of ['../components/ui.css', '../content/styles.css']) {
    it(`${file} never paints text or hairlines with --primary`, () => {
      const css = stripComments(read(file))
      const offenders = css
        .split('\n')
        .map((line, index) => [index + 1, line] as const)
        .filter(([, line]) => FILL_ONLY_VIOLATION.test(line))
        .map(([number, line]) => `${number}: ${line.trim()}`)

      // --primary is #ff6a3d: 2.85:1 on white. Use --primary-ink for text
      // (4.98:1) or --primary-line for borders and rings (3.67:1).
      expect(offenders).toEqual([])
    })

    it(`${file} has no hardcoded colours`, () => {
      const css = stripComments(read(file))
      expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([])
    })
  }
})

/**
 * Selectors that fill with the brand colour but never contain text.
 *
 * Everything else that paints `--primary` as a background must also state its
 * text colour in the same block. Inheriting it is how you end up with an orange
 * button wearing whatever colour the surrounding page happened to set — which
 * is exactly the bug this list exists to make impossible to reintroduce.
 */
const TEXTLESS_BRAND_FILLS = [
  ".toggle[data-on='true']",
  '.bar-today',
  '.progress-fill',
  // 下拉里标「当前是哪一项」的那条 3px 竖杠，是个 ::before 伪元素，装不下文字。
  ".select-option[data-selected='true']::before",
]

/** Crude but sufficient: `selector { declarations }` pairs, comments stripped. */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    out.push({ selector: selector!.trim().replace(/\s+/g, ' '), body: body! })
  }
  return out
}

describe('brand fills', () => {
  for (const file of ['../components/ui.css', '../content/styles.css']) {
    it(`${file} never fills with --primary without saying what colour the text is`, () => {
      const offenders = rules(stripComments(read(file)))
        .filter(({ body }) => /background(-color)?\s*:[^;]*var\(--primary\)/.test(body))
        .filter(({ body }) => !/(^|;)\s*color\s*:/.test(body))
        .map(({ selector }) => selector)
        .filter((selector) => !TEXTLESS_BRAND_FILLS.some((allowed) => selector.includes(allowed)))

      expect(offenders).toEqual([])
    })
  }
})
