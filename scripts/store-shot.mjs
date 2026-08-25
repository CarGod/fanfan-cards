/**
 * Turns a raw screenshot into a Chrome Web Store screenshot.
 *
 * The store rejects anything that is not exactly 1280×800 or 640×400, and a
 * rejected listing goes back to the end of the review queue — so this does the
 * arithmetic rather than trusting a window to be the right size. `sips` can
 * scale but only crops from the centre, which cannot remove a toolbar at the
 * top, so the pixel work happens here.
 *
 * Padding uses the app's own background colour rather than white: a dark UI
 * letterboxed in white looks like a mistake, letterboxed in its own ink it
 * looks composed.
 *
 * Usage: node scripts/store-shot.mjs <input.png> <output.png> [cropTop] [bg]
 */
import { deflateSync, inflateSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, output, cropTopArg = '0', bg = '#0e1014'] = process.argv
if (!input || !output) {
  console.error('usage: node scripts/store-shot.mjs <input.png> <output.png> [cropTop] [bg]')
  process.exit(1)
}

const TARGET_W = 1280
const TARGET_H = 800
const cropTop = Number(cropTopArg)
const [bgR, bgG, bgB] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16))

// --- PNG decode (filters 0-4, 8-bit RGB/RGBA) -------------------------------

function decodePng(buffer) {
  let position = 8
  let width = 0
  let height = 0
  let colourType = 6
  const idat = []
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position)
    const type = buffer.toString('ascii', position + 4, position + 8)
    const data = buffer.subarray(position + 8, position + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colourType = data[9]
    }
    if (type === 'IDAT') idat.push(data)
    position += 12 + length
  }
  const channels = colourType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  let previous = Buffer.alloc(stride)

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const current = Buffer.alloc(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? current[i - channels] : 0
      const b = previous[i]
      const c = i >= channels ? previous[i - channels] : 0
      const x = line[i]
      let value
      if (filter === 0) value = x
      else if (filter === 1) value = x + a
      else if (filter === 2) value = x + b
      else if (filter === 3) value = x + ((a + b) >> 1)
      else {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        value = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
      }
      current[i] = value & 0xff
    }
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 4
      pixels[to] = current[from]
      pixels[to + 1] = current[from + 1]
      pixels[to + 2] = current[from + 2]
      pixels[to + 3] = channels === 4 ? current[from + 3] : 255
    }
    previous = current
  }
  return { width, height, pixels }
}

// --- PNG encode -------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()
const crc32 = (buffer) => {
  let crc = -1
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}
const chunk = (type, data) => {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}
function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- crop, scale, pad -------------------------------------------------------

const source = decodePng(readFileSync(input))
const cropY = Math.min(cropTop, source.height - 1)
const cropH = source.height - cropY
const scale = Math.min(TARGET_W / source.width, TARGET_H / cropH)
const drawW = Math.round(source.width * scale)
const drawH = Math.round(cropH * scale)
const offsetX = Math.floor((TARGET_W - drawW) / 2)
const offsetY = Math.floor((TARGET_H - drawH) / 2)

const out = Buffer.alloc(TARGET_W * TARGET_H * 4)
for (let i = 0; i < TARGET_W * TARGET_H; i++) {
  out[i * 4] = bgR
  out[i * 4 + 1] = bgG
  out[i * 4 + 2] = bgB
  out[i * 4 + 3] = 255
}

// Area average, so downscaled text stays readable instead of shimmering.
for (let y = 0; y < drawH; y++) {
  for (let x = 0; x < drawW; x++) {
    const sx0 = Math.floor((x / scale))
    const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / scale)))
    const sy0 = cropY + Math.floor((y / scale))
    const sy1 = Math.max(sy0 + 1, cropY + Math.floor(((y + 1) / scale)))
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let sy = sy0; sy < Math.min(sy1, source.height); sy++) {
      for (let sx = sx0; sx < Math.min(sx1, source.width); sx++) {
        const at = (sy * source.width + sx) * 4
        r += source.pixels[at]
        g += source.pixels[at + 1]
        b += source.pixels[at + 2]
        n++
      }
    }
    if (n === 0) continue
    const to = ((y + offsetY) * TARGET_W + (x + offsetX)) * 4
    out[to] = Math.round(r / n)
    out[to + 1] = Math.round(g / n)
    out[to + 2] = Math.round(b / n)
    out[to + 3] = 255
  }
}

writeFileSync(output, encodePng(out, TARGET_W, TARGET_H))
console.log(`${output}  ${TARGET_W}x${TARGET_H}  (source ${source.width}x${source.height}, cropped ${cropY}px off the top)`)
