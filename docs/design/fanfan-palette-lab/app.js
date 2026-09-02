(function runPaletteLab(global) {
  'use strict'

const { DEFAULT_CONFIG, LEVELS, PALETTES } = global.FanfanPaletteLabData

const state = { ...DEFAULT_CONFIG }
const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

function renderPaletteChoices() {
  $('#palette-choices').innerHTML = Object.entries(PALETTES).map(([id, palette]) => `
    <button class="choice" type="button" data-palette="${id}" aria-pressed="${id === state.palette}">
      ${palette.name} <span>${palette.tag}</span>
    </button>
  `).join('')
}

function rgbaParts(value) {
  const [r, g, b, a] = value.match(/[\d.]+/g).map(Number)
  return { r, g, b, a }
}

function composite(value, background) {
  const { r, g, b, a } = rgbaParts(value)
  const base = background.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16))
  return [r, g, b].map((channel, index) => channel * a + base[index] * (1 - a))
}

function hex(rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase()
}

function rgbFromHex(value) {
  return value.match(/[\da-f]{2}/gi).map((part) => parseInt(part, 16))
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return .2126 * r + .7152 * g + .0722 * b
}

function contrast(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (lighter + .05) / (darker + .05)
}

function render() {
  const palette = PALETTES[state.palette]
  const colors = palette[state.backdrop]
  document.documentElement.dataset.backdrop = state.backdrop
  document.documentElement.style.colorScheme = state.backdrop
  document.body.style.setProperty('--reading-bg', state.backdrop === 'light' ? '#ffffff' : '#15171c')
  document.body.style.setProperty('--reading-ink', state.backdrop === 'light' ? '#25272b' : '#eceef2')

  LEVELS.forEach((level, index) => {
    document.body.style.setProperty(`--level-${index}`, colors[index])
    $$(`[data-level="${index}"]`).forEach((element) => {
      element.hidden = index === 3 && !state.showMastered
    })
  })

  $('#palette-title').textContent = palette.name
  $('#palette-summary').textContent = palette.summary
  $('#theme-badge').textContent = palette.badge
  $('#mastered-label').textContent = state.showMastered ? '显示已掌握' : '隐藏已掌握'

  $('#swatches').innerHTML = LEVELS.map((level, index) => {
    const base = state.backdrop === 'light' ? '#FFFFFF' : '#15171C'
    const ink = state.backdrop === 'light' ? '#25272B' : '#ECEEF2'
    const compositeRgb = composite(colors[index], base)
    const backdropContrast = contrast(compositeRgb, rgbFromHex(base)).toFixed(2)
    const textContrastRaw = contrast(compositeRgb, rgbFromHex(ink))
    const textContrast = textContrastRaw.toFixed(1)
    const retention = (textContrastRaw / contrast(rgbFromHex(base), rgbFromHex(ink))).toFixed(2)
    return `<li><button class="swatch" type="button" data-copy="${colors[index]}" aria-label="复制${level.name}色值 ${colors[index]}">
      <span class="swatch-color" style="--swatch:${colors[index]}"></span>
      <span><strong>${level.id} · ${level.name}</strong><small>${colors[index]}</small><small>合成 ${hex(compositeRgb)} · 对底 ${backdropContrast}:1</small><small>正文 ${textContrast}:1 · 留存 ${retention}</small></span>
    </button></li>`
  }).join('')

  $$('[data-palette]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.palette === state.palette))
  $$('[data-backdrop]').forEach((button) => button.setAttribute('aria-pressed', button.dataset.backdrop === state.backdrop))
  $('#show-mastered').checked = state.showMastered
}

function copyWithSelection(text) {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()

  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

async function copy(text, button) {
  let copied = false

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      // Clipboard API is commonly unavailable on file://. Use the selection
      // fallback below so a directly opened lab remains useful.
    }
  }

  if (!copied) copied = copyWithSelection(text)

  if (!copied) {
    $('#toast').textContent = '复制失败，请手动复制色值'
    $('#toast').classList.add('show')
    setTimeout(() => $('#toast').classList.remove('show'), 1800)
    return
  }

  const original = button.getAttribute('aria-label')
  button.setAttribute('aria-label', '已复制')
  $('#toast').textContent = '已复制到剪贴板'
  $('#toast').classList.add('show')
  setTimeout(() => {
    $('#toast').classList.remove('show')
    button.setAttribute('aria-label', original)
  }, 1400)
}

function exportConfig() {
  const palette = PALETTES[state.palette]
  const output = {
    version: 1,
    id: state.palette,
    label: palette.name,
    light: palette.light,
    dark: palette.dark,
    showMastered: state.showMastered,
  }
  copy(JSON.stringify(output, null, 2), $('#export'))
}

document.addEventListener('click', (event) => {
  const palette = event.target.closest('[data-palette]')
  const backdrop = event.target.closest('[data-backdrop]')
  const copyButton = event.target.closest('[data-copy]')
  if (palette) state.palette = palette.dataset.palette
  if (backdrop) state.backdrop = backdrop.dataset.backdrop
  if (copyButton) void copy(copyButton.dataset.copy, copyButton)
  if (palette || backdrop) render()
})

$('#show-mastered').addEventListener('change', (event) => {
  state.showMastered = event.target.checked
  render()
})
$('#export').addEventListener('click', exportConfig)
renderPaletteChoices()
render()
})(window)
