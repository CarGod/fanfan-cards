/**
 * Generates the 翻翻词卡 extension icons as PNGs, with no image dependencies.
 *
 * Chrome only accepts raster icons, and checking four binary blobs into a repo
 * makes the mark impossible to tweak — a brand colour change would mean opening
 * a design tool. This draws them from the same geometry as
 * `public/logo-mark.svg`, evaluating a signed distance field per pixel.
 *
 * Why a distance field rather than "render at 128 and downscale": at 16px the
 * card's fold is about two physical pixels and the text bars are under one.
 * Downscaling turns both into grey haze. Sampling the geometry at the target
 * resolution keeps the edges crisp, and lets each size drop the detail it
 * cannot hold — the bars disappear below 24px, exactly as the React mark does.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
const SIZES = [16, 32, 48, 128]

/**
 * Flame 500 for the card, flame 200 for the turned corner, warm white for the
 * text bars. See design-token.css.
 *
 * The fold is a lighter *orange*, not white: white is indistinguishable from
 * the page behind the icon, which makes the corner read as chamfered rather
 * than folded — and the fold is the entire idea. A lighter tone of the card's
 * own colour is also what the back of a folded card actually looks like.
 */
const FLAME = [255, 106, 61]
const FOLD = [255, 198, 174]
const PAPER = [255, 240, 230]

/*
 * Geometry as proportions of the card, not fixed 64-unit coordinates.
 *
 * The reason is pixel alignment. At 16px the design's 6/64 margin lands on
 * 1.5px, so every edge of the card straddles two pixels and the whole mark
 * renders as a soft grey smear. Snapping the card's box to whole pixels first,
 * then deriving the radius, the fold and the bars from that box, gives crisp
 * edges at every size while keeping the shape identical to logo-mark.svg.
 */
const CARD_RADIUS = 8 / 52 // of the card's width, from the 64-unit drawing
const CHAMFER = 17 / 52 // the fold's leg length
const BARS = [
  { x: [8 / 52, 32 / 52], y: [27 / 52, 32.5 / 52], r: 2.75 / 52, alpha: 0.92 },
  { x: [8 / 52, 23 / 52], y: [38 / 52, 43.5 / 52], r: 2.75 / 52, alpha: 0.5 },
]
/** Below this the bars are under a physical pixel and only add haze. */
const DETAIL_MIN_PX = 24

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** The card's box in pixels, snapped to the grid, plus everything derived. */
function layout(size) {
  const pad = Math.max(1, Math.round((6 / 64) * size))
  const x0 = pad
  const y0 = pad
  const x1 = size - pad
  const y1 = size - pad
  const w = x1 - x0
  return {
    card: { x0, y0, x1, y1, r: CARD_RADIUS * w },
    // The chamfer runs from (x1 - c, y0) to (x1, y0 + c); the line through it
    // is x - y = k.
    c: CHAMFER * w,
    k: x1 - CHAMFER * w - y0,
    bars: BARS.map((b) => ({
      x0: x0 + b.x[0] * w,
      x1: x0 + b.x[1] * w,
      y0: y0 + b.y[0] * w,
      y1: y0 + b.y[1] * w,
      r: b.r * w,
      alpha: b.alpha,
    })),
  }
}

/** Signed distance to a rounded rectangle: negative inside. */
function sdRoundRect(x, y, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - r
  const hy = (y1 - y0) / 2 - r
  const dx = Math.abs(x - cx) - hx
  const dy = Math.abs(y - cy) - hy
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0))
  return outside + Math.min(Math.max(dx, dy), 0) - r
}

/** Coverage of a signed distance, anti-aliased over `softness` pixels. */
const cover = (sd, softness) => clamp01(0.5 - sd / softness)

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4)
  const L = layout(size)
  // One pixel wide. Wider looks soft; narrower starts to alias.
  const softness = 1
  const withDetail = size >= DETAIL_MIN_PX

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Sample at the pixel centre, in pixel space.
      const x = px + 0.5
      const y = py + 0.5

      // Distance to the fold line, positive on the cut-away side.
      const lineSd = (x - y - L.k) / Math.SQRT2

      // The card is the rounded rectangle with its top-right corner cut off,
      // which is an intersection: max() of the two signed distances.
      const cardCov = cover(Math.max(sdRoundRect(x, y, L.card), lineSd), softness)
      if (cardCov <= 0) continue

      let [r, g, b] = FLAME

      // The turned corner is the triangle inside the card whose hypotenuse is
      // the card's own chamfered edge.
      const foldSd = Math.max(L.card.x1 - L.c - x, y - (L.card.y0 + L.c), lineSd)
      const fold = cover(foldSd, softness)
      if (fold > 0) {
        r = Math.round(r + (FOLD[0] - r) * fold)
        g = Math.round(g + (FOLD[1] - g) * fold)
        b = Math.round(b + (FOLD[2] - b) * fold)
      }

      // Text bars, painted on the card face; dropped entirely at small sizes.
      let paper = 0
      if (withDetail) {
        for (const bar of L.bars) {
          paper = Math.max(paper, cover(sdRoundRect(x, y, bar), softness) * bar.alpha)
        }
      }
      if (paper > 0) {
        r = Math.round(r + (PAPER[0] - r) * paper)
        g = Math.round(g + (PAPER[1] - g) * paper)
        b = Math.round(b + (PAPER[2] - b) * paper)
      }

      const offset = (py * size + px) * 4
      pixels[offset] = r
      pixels[offset + 1] = g
      pixels[offset + 2] = b
      pixels[offset + 3] = Math.round(cardCov * 255)
    }
  }
  return encodePng(pixels, size, size)
}

// --- minimal PNG encoder ----------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(rgba, width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // colour type: RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(OUT_DIR, { recursive: true })
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`)
  writeFileSync(file, renderIcon(size))
  console.log(`wrote ${file}`)
}
