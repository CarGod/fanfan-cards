import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryAdapter, setStorageAdapter } from '@/storage/area.ts'
import { saveSettings } from '@/storage/repositories/settingsRepo.ts'
import {
  readTranslations,
  translationCacheSize,
  translationKey,
  writeTranslations,
} from '@/storage/repositories/translationCacheRepo.ts'
import { handleTranslatePage } from './handlers/translate.ts'

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
