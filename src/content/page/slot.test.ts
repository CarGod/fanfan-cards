// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { clearSlot, createSlot, fillSlot, slotFor, sweepOrphanSlots } from './slot.ts'
import { TRANSLATED_MARK } from './walker.ts'

/**
 * Slot bookkeeping.
 *
 * These tests exist because of a stuck 「翻译中…」 on x.com: the slot used to be
 * found as `element.nextElementSibling`, and a feed that re-renders around our
 * node breaks that link permanently — the answer arrives and has nowhere to go.
 */
function paragraph(text = 'A migration can lock a table for minutes.'): HTMLElement {
  document.body.innerHTML = `<p id="p">${text}</p>`
  return document.getElementById('p')!
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('slot', () => {
  it('finds its slot again after something is inserted between the two', () => {
    const source = paragraph()
    const slot = createSlot(source)
    source.after(slot)

    // Exactly what a feed does: drop an ad or a spacer in between.
    source.after(document.createElement('div'))

    expect(slotFor(source)).toBe(slot)
  })

  it('fills the slot with the translation and marks the source done', () => {
    const source = paragraph()
    source.after(createSlot(source))

    expect(fillSlot(source, source.textContent!, '一次迁移可能把表锁住好几分钟。')).toBe(true)
    expect(slotFor(source)?.textContent).toBe('一次迁移可能把表锁住好几分钟。')
    expect(source.getAttribute(TRANSLATED_MARK)).toBe('done')
  })

  it('refuses a translation identical to the source and leaves no trace', () => {
    const source = paragraph('中文内容不该被"翻译"成同样的中文')
    source.after(createSlot(source))

    expect(fillSlot(source, source.textContent!, source.textContent!)).toBe(false)
    expect(slotFor(source)).toBeNull()
    expect(source.hasAttribute(TRANSLATED_MARK)).toBe(false)
  })

  it('clears everything it added, including the link attribute', () => {
    const source = paragraph()
    source.after(createSlot(source))
    fillSlot(source, source.textContent!, '译文')

    clearSlot(source)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(0)
    expect(source.getAttributeNames().filter((name) => name.startsWith('data-ara'))).toEqual([])
  })

  it('sweeps a placeholder whose paragraph the page threw away', () => {
    const source = paragraph()
    source.after(createSlot(source))
    // The feed recycles the node while the request is still in flight.
    source.remove()

    expect(sweepOrphanSlots()).toBe(1)
    expect(document.querySelectorAll('.ara-translation')).toHaveLength(0)
  })

  it('keeps a placeholder whose paragraph is still there', () => {
    const source = paragraph()
    source.after(createSlot(source))
    expect(sweepOrphanSlots()).toBe(0)
  })

  it('reuses one id per source, so a re-created slot still matches', () => {
    const source = paragraph()
    source.after(createSlot(source))
    const first = source.getAttribute('data-ara-id')
    slotFor(source)!.remove()
    source.after(createSlot(source))
    expect(source.getAttribute('data-ara-id')).toBe(first)
    expect(slotFor(source)).not.toBeNull()
  })
})
