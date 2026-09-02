import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { PROMPT_VERSION } from '@/ai/prompts.ts'
import { saveSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  readTranslations,
  translationCacheSize,
  translationKey,
  writeTranslations,
} from '@/storage/repositories/translationCacheRepo.ts'
import { handleTranslateInput, handleTranslatePage } from './handlers/translate.ts'

beforeEach(() => setStorageAdapter(createMemoryAdapter()))
afterEach(() => {
  vi.unstubAllGlobals()
  setStorageAdapter(null)
})

/** Counts what actually reached a provider, which is what the cache is for. */
function stubProvider() {
  const sent: string[][] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
    const user = body.messages[1]?.content ?? ''
    const texts = [...user.matchAll(/^\[\d+\] (.+)$/gm)].map((match) => match[1] ?? '')
    sent.push(texts)
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ translations: texts.map((text) => `译:${text}`) }),
            },
          },
        ],
      }),
      { status: 200 },
    )
  })
  return sent
}

async function useDeepSeek() {
  await saveSettings({
    provider: 'deepseek',
    providers: {
      openai: { apiKey: '', model: '', baseUrl: '' },
      claude: { apiKey: '', model: '', baseUrl: '' },
      deepseek: { apiKey: 'k', model: 'test-model', baseUrl: 'https://api.example.com/v1' },
      gemini: { apiKey: '', model: '', baseUrl: '' },
      custom: { apiKey: '', model: '', baseUrl: '' },
    },
  })
}

describe('page translation cache', () => {
  it('translates every segment the first time', async () => {
    const sent = stubProvider()
    await useDeepSeek()

    const result = await handleTranslatePage({ texts: ['One', 'Two'] })
    expect(result.translations).toEqual(['译:One', '译:Two'])
    expect(sent).toEqual([['One', 'Two']])
  })

  // Toggling translation off and on, or scrolling back up, must not re-bill the
  // user for text that was already translated.
  it('sends nothing at all when every segment is already cached', async () => {
    const sent = stubProvider()
    await useDeepSeek()

    await handleTranslatePage({ texts: ['One', 'Two'] })
    const again = await handleTranslatePage({ texts: ['One', 'Two'] })

    expect(again.translations).toEqual(['译:One', '译:Two'])
    expect(sent).toHaveLength(1)
  })

  it('sends only the segments it has never seen, and keeps the order', async () => {
    const sent = stubProvider()
    await useDeepSeek()

    await handleTranslatePage({ texts: ['One'] })
    const mixed = await handleTranslatePage({ texts: ['One', 'Two', 'Three'] })

    expect(sent[1]).toEqual(['Two', 'Three'])
    expect(mixed.translations).toEqual(['译:One', '译:Two', '译:Three'])
  })

  it('retries an omitted batch member alone and never caches the hole', async () => {
    const sent: string[][] = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const user = body.messages[1]?.content ?? ''
      const texts = [...user.matchAll(/^\[\d+\] (.+)$/gm)].map((match) => match[1] ?? '')
      sent.push(texts)
      const translations =
        texts.length > 1 ? texts.map((text, index) => (index === 1 ? '' : `译:${text}`)) : [`补:${texts[0]}`]
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations }) } }] }),
        { status: 200 },
      )
    })
    await useDeepSeek()

    const result = await handleTranslatePage({ texts: ['One', 'Two', 'Three'] })
    const again = await handleTranslatePage({ texts: ['One', 'Two', 'Three'] })

    expect(result.translations).toEqual(['译:One', '补:Two', '译:Three'])
    expect(again.translations).toEqual(result.translations)
    expect(sent).toEqual([['One', 'Two', 'Three'], ['Two']])
  })

  it('treats a cached source echo as a miss instead of a permanent blank', async () => {
    const sent = stubProvider()
    await useDeepSeek()
    const text = 'Where are the gift-card terms?'
    await writeTranslations([
      [
        translationKey({
          providerId: 'deepseek',
          model: 'test-model',
          promptVersion: PROMPT_VERSION,
          target: 'zh-CN',
          text,
        }),
        text,
      ],
    ])

    const result = await handleTranslatePage({ texts: [text] })

    expect(result.translations).toEqual([`译:${text}`])
    expect(sent).toEqual([[text]])
  })
})

describe('input translation', () => {
  function stubSingleTranslation() {
    const prompts: Array<{ system: string; user: string }> = []
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>
      }
      prompts.push({
        system: body.messages.find((message) => message.role === 'system')?.content ?? '',
        user: body.messages.find((message) => message.role === 'user')?.content ?? '',
      })
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ translation: 'translated text', note: '' }),
              },
            },
          ],
        }),
        { status: 200 },
      )
    })
    return prompts
  }

  it('uses English by default even when page translation targets another language', async () => {
    const prompts = stubSingleTranslation()
    await useDeepSeek()
    await saveSettings({ targetLanguage: 'ja' })

    const result = await handleTranslateInput({ text: '你好，世界' })

    expect(result).toEqual({ translation: 'translated text', targetLanguage: 'en' })
    expect(prompts[0]?.system).toContain('into English')
  })

  it('follows the page target only when the user explicitly selects follow', async () => {
    const prompts = stubSingleTranslation()
    await useDeepSeek()
    await saveSettings({
      targetLanguage: 'ja',
      inputTranslationTargetLanguage: 'follow',
    })

    const result = await handleTranslateInput({ text: 'Hello' })

    expect(result.targetLanguage).toBe('ja')
    expect(prompts[0]?.system).toContain('into 日本語')
  })

  it('can override the page target with its own persisted language', async () => {
    const prompts = stubSingleTranslation()
    await useDeepSeek()
    await saveSettings({
      targetLanguage: 'en',
      inputTranslationTargetLanguage: 'ja',
    })

    const result = await handleTranslateInput({ text: 'Hello' })

    expect(result.targetLanguage).toBe('ja')
    expect(prompts[0]?.system).toContain('into 日本語')
  })

  it('reuses a cached input translation without billing the provider again', async () => {
    const prompts = stubSingleTranslation()
    await useDeepSeek()

    await handleTranslateInput({ text: 'Hello' })
    const second = await handleTranslateInput({ text: 'Hello' })

    expect(second.translation).toBe('translated text')
    expect(prompts).toHaveLength(1)
  })

  it('does not replace a draft with the offline provider placeholder', async () => {
    await expect(handleTranslateInput({ text: 'Hello world' })).rejects.toMatchObject({
      code: 'no_api_key',
    })
  })
})

describe('translationCacheRepo', () => {
  const key = (text: string) =>
    translationKey({ providerId: 'p', model: 'm', promptVersion: 'v', target: 'zh-CN', text })

  it('reads back what it wrote, and misses cleanly', async () => {
    await writeTranslations([[key('a'), '译a']])
    expect(await readTranslations([key('a'), key('b')])).toEqual(['译a', null])
  })

  it('never caches an empty translation', async () => {
    await writeTranslations([[key('a'), '  ']])
    expect(await translationCacheSize()).toBe(0)
  })

  it('keys on the text itself, so edited text is simply a different entry', async () => {
    await writeTranslations([[key('hello'), '你好']])
    expect(await readTranslations([key('hello!')])).toEqual([null])
  })
})
