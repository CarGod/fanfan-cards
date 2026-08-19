import { describe, expect, it } from 'vitest'
import { placePanel } from './position.ts'

const VIEWPORT = { width: 1200, height: 800 }
const CARD = { width: 360, height: 420 }

describe('placePanel', () => {
  it('places the card below the selection when there is room', () => {
    const place = placePanel({ top: 100, bottom: 120, left: 500, right: 560 }, CARD, VIEWPORT)
    expect(place.side).toBe('below')
    expect(place.top).toBe(126)
  })

  it('flips above when the selection is near the bottom', () => {
    const place = placePanel({ top: 700, bottom: 720, left: 500, right: 560 }, CARD, VIEWPORT)
    expect(place.side).toBe('above')
    expect(place.top).toBe(700 - CARD.height - 6)
  })

  it('centres horizontally on the selection', () => {
    const place = placePanel({ top: 100, bottom: 120, left: 500, right: 600 }, CARD, VIEWPORT)
    expect(place.left).toBe(550 - CARD.width / 2)
  })

  it('never leaves the viewport on the left edge', () => {
    const place = placePanel({ top: 100, bottom: 120, left: 0, right: 40 }, CARD, VIEWPORT)
    expect(place.left).toBe(8)
  })

  it('never leaves the viewport on the right edge', () => {
    const place = placePanel({ top: 100, bottom: 120, left: 1180, right: 1200 }, CARD, VIEWPORT)
    expect(place.left).toBe(VIEWPORT.width - CARD.width - 8)
  })

  it('grows the card into the room the placement found', () => {
    // Selection near the top of a 700px window: 580px of room below, so the
    // card may use it rather than stopping at some fixed cap.
    const roomy = placePanel({ top: 80, bottom: 100, left: 500, right: 560 }, CARD, {
      width: 1200,
      height: 700,
    })
    expect(roomy.side).toBe('below')
    expect(roomy.maxHeight).toBe(700 - 100 - 6 - 8)

    // Same window, selection lower down: less room, but never squeezed below
    // the comfortable height — a sliver of a card helps nobody.
    const cramped = placePanel({ top: 380, bottom: 400, left: 500, right: 560 }, CARD, {
      width: 1200,
      height: 700,
    })
    expect(cramped.maxHeight).toBeLessThan(roomy.maxHeight)
    expect(cramped.maxHeight).toBeGreaterThanOrEqual(460)
  })

  it('never proposes a card so short it is useless, nor so tall it stops being a popover', () => {
    // A genuinely tiny window: use it all rather than inventing空间.
    const tiny = placePanel({ top: 140, bottom: 160, left: 500, right: 560 }, CARD, {
      width: 1200,
      height: 300,
    })
    expect(tiny.maxHeight).toBe(300 - 16)

    const huge = placePanel({ top: 20, bottom: 40, left: 500, right: 560 }, CARD, {
      width: 1200,
      height: 4000,
    })
    expect(huge.maxHeight).toBe(720)
  })

  it('clamps a card taller than the viewport instead of pushing it off screen', () => {
    const tall = { width: 360, height: 900 }
    const place = placePanel({ top: 400, bottom: 420, left: 500, right: 560 }, tall, VIEWPORT)
    expect(place.top).toBe(8)
  })
})
