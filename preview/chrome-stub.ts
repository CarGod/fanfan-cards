/**
 * Minimal `chrome` stand-in for the preview harness.
 *
 * Deliberately omits `chrome.storage` so the storage layer falls back to its
 * in-memory adapter — the preview is seeded with sample data and must never be
 * able to touch a real profile.
 */
import type { Reply } from '@/types/messages.ts'

const SAMPLE_EXPLANATION = {
  word: 'migration',
  lemma: 'migration',
  kind: 'word' as const,
  phonetic: '/maɪˈɡreɪʃn/',
  partOfSpeech: 'noun',
  cefr: 'B2' as const,
  meaning: '迁移；移民',
  contextMeaning:
    '这里指数据库结构或数据从旧版本迁移到新版本的过程，不是人口迁徙。作者强调它"危险"，是因为一旦迁移脚本在生产库上执行出错，数据可能无法回滚。',
  englishDefinition:
    'the process of moving a database schema or its data from one version to another',
  examples: [
    {
      sentence: 'We rehearsed the migration on a staging copy before touching production.',
      translation: '我们先在预发布副本上演练了这次迁移，才动生产库。',
    },
    {
      sentence: 'The migration failed halfway and left the schema in a mixed state.',
      translation: '迁移执行到一半失败，表结构停在一个混合状态。',
    },
    {
      sentence: 'Write every migration so it can be rolled back.',
      translation: '每个迁移都要写成可以回滚的。',
    },
  ],
  sentenceTranslation: '如果跳过演练，数据库迁移可能非常危险。',
  synonyms: [
    { word: 'transfer', meaning: '泛指把东西从一处移到另一处，不含"版本升级"的意味' },
    { word: 'upgrade', meaning: '强调升到更新的版本，未必涉及数据搬迁' },
    { word: 'port', meaning: '把程序移植到另一平台，对象是代码而非数据' },
  ],
}

const listeners = new Set<(message: unknown) => void>()

const stub = {
  runtime: {
    id: 'preview',
    getManifest: () => ({ version: '0.1.0-preview' }),
    getURL: (path: string) => `./${path}`,
    openOptionsPage: async () => {
      location.search = '?view=options'
    },
    onMessage: {
      addListener: (fn: (message: unknown) => void) => listeners.add(fn),
      removeListener: (fn: (message: unknown) => void) => listeners.delete(fn),
    },
    async sendMessage(envelope: { type: string; payload?: unknown }): Promise<Reply<'ping'>> {
      /*
       * Page translation answers fast and echoes the length it was given, so the
       * preview can show whether a re-translation actually carried the longer
       * text — which is the whole point of the 「显示更多」 exercise.
       */
      if (envelope.type === 'page/translate') {
        const texts = (envelope.payload as { texts: string[] }).texts
        await new Promise((resolve) => setTimeout(resolve, 300))
        return {
          ok: true,
          data: {
            translations: texts.map(
              (text) => `【译文 ${text.length} 字】${text.slice(0, 60)}…（此处应为中文译文）`,
            ),
          },
        } as unknown as Reply<'ping'>
      }
      if (envelope.type === 'page/shouldTranslate') {
        return { ok: true, data: { translating: false } } as unknown as Reply<'ping'>
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      if (envelope.type === 'ai/explain') {
        return {
          ok: true,
          data: {
            explanation: SAMPLE_EXPLANATION,
            providerId: 'claude',
            model: 'claude-opus-5',
            offline: false,
            cached: false,
          },
        } as unknown as Reply<'ping'>
      }
      return { ok: true, data: { entry: null } } as unknown as Reply<'ping'>
    },
  },
  tabs: {
    query: async () => [{ id: 1, url: 'https://github.com/postgres/postgres' }],
    create: async () => ({}),
    update: async () => ({}),
    sendMessage: async () => {},
  },
  windows: { update: async () => ({}) },
}

Object.defineProperty(globalThis, 'chrome', { value: stub, writable: true })

export { SAMPLE_EXPLANATION }
