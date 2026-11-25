// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PageTranslator } from './pageTranslator.ts'
import { sendMessage } from '@/services/messaging.ts'

vi.mock('@/services/messaging.ts', () => ({ sendMessage: vi.fn() }))
const send = vi.mocked(sendMessage)
const settle = () => vi.advanceTimersByTimeAsync(650)
let page: PageTranslator
beforeEach(() => {
  vi.useFakeTimers()
  send.mockReset().mockImplementation(async (_type, payload) => ({
    translations: (payload as { texts: string[] }).texts.map(text => '译_' + text),
  }))
  page = new PageTranslator()
  page.setTranslationOnly(true)
})
afterEach(() => {
  page.stop()
  document.body.replaceChildren()
  vi.useRealTimers()
})

it('keeps controls, icons, text nodes, inline layout and listeners in place', async () => {
  document.body.innerHTML = `<main><h2 style="position:absolute; clip:rect(1px, 1px, 1px, 1px)">Keyboard shortcuts</h2>
    <div role="tablist" style="display:grid"><a role="tab" href="#account"><span>Account information</span><svg><title>Arrow icon</title></svg></a>
    <button> Help <em>Center</em> now </button><button hidden>Hidden action</button></div>
    <div contenteditable="true"><span>Unsent draft</span></div><p translate="no">Native label</p></main>`
  const html = document.body.innerHTML
  const nodes = [...document.body.querySelectorAll('*')]
  const label = document.querySelector('a span')!.firstChild!
  const button = document.querySelector('button')!
  const click = vi.fn()
  button.addEventListener('click', click)
  button.focus()
  page.toggle({ range: 'all' })
  await settle()

  expect(send).toHaveBeenCalledTimes(1)
  expect(send.mock.calls[0]![1]).toMatchObject({ texts: ['Account information', 'Help', 'Center', 'now'] })
  expect([...document.body.querySelectorAll('*')].every((el, i) => el === nodes[i])).toBe(true)
  expect(label).toBe(document.querySelector('a span')!.firstChild)
  expect(label.textContent).toBe('译_Account information')
  expect(button.textContent).toBe(' 译_Help 译_Center 译_now ')
  expect(document.activeElement).toBe(button)
  button.click()
  expect(click).toHaveBeenCalledOnce()
  page.toggle()
  expect(document.body.innerHTML).toBe(html)
})

it('follows reused and replaced text and restores the newest site value', async () => {
  document.body.innerHTML = '<a href="#settings">Settings</a><button>Show less</button>'
  page.start()
  await settle()
  const link = document.querySelector('a')!
  const text = link.firstChild as Text
  text.data = 'Resources'
  document.querySelector('button')!.textContent = 'Show more'
  await settle()
  expect(text.data).toBe('译_Resources')
  expect(document.querySelector('button')!.textContent).toBe('译_Show more')
  text.data = 'Reused before restore'
  page.stop()
  expect(link.textContent).toBe('Reused before restore')
  expect(document.querySelector('button')!.textContent).toBe('Show more')
})

it('discards late replies when a site reuses a node or the reader restores the page', async () => {
  const pending: ((value: { translations: string[] }) => void)[] = []
  send.mockImplementation(() => new Promise(resolve => pending.push(resolve)))
  document.body.innerHTML = '<button>First label</button>'
  const text = document.querySelector('button')!.firstChild as Text
  page.start()
  await vi.advanceTimersByTimeAsync(1)
  text.data = 'Second label'
  pending[0]!({ translations: ['旧译文'] })
  await settle()
  expect(text.data).toBe('Second label')
  page.stop()
  page.start()
  await vi.advanceTimersByTimeAsync(1)
  pending[2]!({ translations: ['新译文'] })
  pending[1]!({ translations: ['另一个过期结果'] })
  await settle()
  expect(text.data).toBe('新译文')
  page.stop()
  expect(text.data).toBe('Second label')
})

it('supports changing display mode while page translation is active', async () => {
  document.body.innerHTML = '<p>Help Center</p>'
  page.setTranslationOnly(false)
  page.start()
  await settle()
  expect(document.querySelector('.ara-translation')?.textContent).toBe('译_Help Center')
  page.setTranslationOnly(true)
  await settle()
  expect(document.querySelector('p')!.textContent).toBe('译_Help Center')
  expect(document.querySelector('.ara-translation')).toBeNull()
  page.setTranslationOnly(false)
  await settle()
  expect(document.querySelector('p')!.textContent).toBe('Help Center')
  expect(document.querySelectorAll('.ara-translation')).toHaveLength(1)
  expect(send).toHaveBeenCalledOnce()
})

it('skips a label that becomes an editor while the translation is pending', async () => {
  let answer!: (value: { translations: string[] }) => void
  send.mockImplementation(() => new Promise(resolve => { answer = resolve }))
  document.body.innerHTML = '<section><span>Article title</span></section>'
  page.start()
  await vi.advanceTimersByTimeAsync(1)
  document.querySelector('section')!.setAttribute('contenteditable', 'true')
  answer({ translations: ['文章标题'] })
  await settle()
  expect(document.querySelector('span')!.textContent).toBe('Article title')
})

it('preserves inline spaces and original source whitespace on restore', async () => {
  document.body.innerHTML = '<p>  An   ordinary\n    line.  </p><p style="white-space:pre-wrap">First line\n\nSecond line</p>'
  const original = document.body.innerHTML
  page.start()
  await settle()
  expect(send.mock.calls[0]![1]).toMatchObject({ texts: ['An ordinary line.', 'First line\n\nSecond line'] })
  expect(document.querySelector('p')!.textContent).toBe('  译_An ordinary line.  ')
  page.stop()
  expect(document.body.innerHTML).toBe(original)
})
