import { z } from 'zod'

/** Zod is the single source of truth for settings: parse on read, migrate on miss. */

export const providerIdSchema = z.enum(['mock', 'openai', 'claude', 'deepseek', 'gemini', 'custom'])

/** How the word card is summoned after a selection. */
export const triggerModeSchema = z.enum(['button', 'auto', 'hotkey'])
export type TriggerMode = z.infer<typeof triggerModeSchema>

export const providerConfigSchema = z
  .object({
    apiKey: z.string().default(''),
    model: z.string().default(''),
    /** Override for proxies / self-hosted gateways. Empty means provider default. */
    baseUrl: z.string().default(''),
  })
  // Each entry defaults on its own so that adding a sixth provider later cannot
  // make an existing user's stored settings fail to parse — which would reset
  // every other provider's API key along with it.
  .default({ apiKey: '', model: '', baseUrl: '' })
export type ProviderConfig = z.infer<typeof providerConfigSchema>

/**
 * GitHub sync.
 *
 * A Personal Access Token rather than OAuth: the device flow needs a registered
 * OAuth App whose client id would have to ship inside the extension, and
 * GitHub's token endpoints are not reliably CORS-enabled for browser contexts.
 * A PAT is a plain `api.github.com` call - no middleman, no hosted callback.
 */
export const syncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  /** Personal Access Token. Stored locally, used only from the service worker. */
  token: z.string().default(''),
  /** Resolved from `GET /user` when the token is verified. */
  owner: z.string().default(''),
  repo: z.string().default('ai-reader-vocabulary'),
  branch: z.string().default('main'),
  /** Sync on a timer as well as on demand. */
  autoSync: z.boolean().default(true),
  intervalMinutes: z.number().int().min(5).max(1440).default(30),
})
export type SyncConfig = z.infer<typeof syncConfigSchema>

export const settingsSchema = z.object({
  /** Active provider. `mock` keeps the whole product usable with zero setup. */
  provider: providerIdSchema.default('mock'),
  providers: z
    .object({
      openai: providerConfigSchema,
      claude: providerConfigSchema,
      deepseek: providerConfigSchema,
      gemini: providerConfigSchema,
      custom: providerConfigSchema,
    })
    .default({
      openai: { apiKey: '', model: '', baseUrl: '' },
      claude: { apiKey: '', model: '', baseUrl: '' },
      deepseek: { apiKey: '', model: '', baseUrl: '' },
      gemini: { apiKey: '', model: '', baseUrl: '' },
      custom: { apiKey: '', model: '', baseUrl: '' },
    }),

  /** What the user is reading. `auto` lets the model detect it. */
  sourceLanguage: z.string().default('auto'),
  /**
   * What explanations are written in. Deliberately never auto-detected: it is
   * the language the user thinks in, not a property of the page.
   */
  targetLanguage: z.string().default('zh-CN'),

  triggerMode: triggerModeSchema.default('button'),
  /** Global kill switch for the content script UI. */
  enabled: z.boolean().default(true),
  /** Hostnames where the content script stays silent. */
  blockedHosts: z.array(z.string()).default([]),
  /** Speak the word automatically when a card opens. */
  autoSpeak: z.boolean().default(false),
  /** Show the English definition block on the card. */
  showEnglishDefinition: z.boolean().default(true),
  /** `content` skips nav/header/footer chrome; `all` translates everything. */
  pageTranslationRange: z.enum(['content', 'all']).default('content'),
  /**
   * Hold this key and hover a paragraph to translate just that paragraph.
   *
   * Backtick by default because it is the only option that collides with
   * nothing: Alt is taken by hold-to-explain, Ctrl is right-click on macOS, and
   * Shift extends a selection. Its cost is that it is also a character someone
   * might be typing, which the trigger guards against.
   */
  paragraphTriggerKey: z.enum(['off', 'backtick', 'alt', 'ctrl', 'shift']).default('backtick'),
  /**
   * 视频字幕：显示模式与字号。
   *
   * 存在设置里而不是只存在面板里，是因为读者在播放器上调完之后换一个视频、换一台
   * 设备，期待的是「我调过了」，而不是每次从头再调一遍。
   */
  videoSubtitleMode: z.enum(['bilingual', 'translationOnly']).default('bilingual'),
  videoSubtitleFontScale: z.number().min(0.6).max(2).default(1),
  /** 字幕底衬的不透明度。0 是完全透明，靠描边压住画面。 */
  videoSubtitleBackground: z.number().min(0).max(1).default(0.7),
  /** 打开视频就自动开字幕，而不是每次手动点一下。 */
  videoSubtitleAuto: z.boolean().default(false),

  /** Example sentences per lookup. 0 turns them off (and makes lookups faster). */
  exampleCount: z.number().int().min(0).max(6).default(3),
  /** Cap on selection length (characters) that will be sent to the model. */
  maxSelectionLength: z.number().int().min(1).max(400).default(120),
  /** Reuse identical (word, context) explanations for this many hours. 0 disables. */
  cacheTtlHours: z.number().int().min(0).max(24 * 30).default(72),
  /**
   * How the review queue is ordered.
   *
   * `curve` is the memory-curve mode — it is what actually implements spaced
   * repetition, and the others are conveniences layered on the same due set.
   */
  reviewMode: z.enum(['curve', 'recent', 'random', 'hardest']).default('curve'),
  /**
   * How aggressive the schedule is. Everyone's forgetting curve is different,
   * and this is the one knob that changes it without pretending to model it.
   */
  reviewIntensity: z.enum(['relaxed', 'standard', 'intensive']).default('standard'),
  /** Daily review target, used by the dashboard ring and the session size. */
  dailyReviewGoal: z.number().int().min(1).max(500).default(20),
  /** Daily nudge when cards are due. */
  reminderEnabled: z.boolean().default(false),
  /** Local wall-clock time, `HH:MM`. */
  reminderTime: z.string().regex(/^\d{2}:\d{2}$/).default('20:00'),
  theme: z.enum(['system', 'light', 'dark']).default('system'),

  sync: syncConfigSchema.default({
    enabled: false,
    token: '',
    owner: '',
    repo: 'ai-reader-vocabulary',
    branch: 'main',
    autoSync: true,
    intervalMinutes: 30,
  }),
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({})

/** Catalogue used by the options UI and the provider factory. */
export interface ProviderMeta {
  id: z.infer<typeof providerIdSchema>
  label: string
  /** Short qualifier shown as a pill: 推荐 / 免费. Vendor blurbs are not our job. */
  badge?: string
  defaultModel: string
  defaultBaseUrl: string
  modelSuggestions: string[]
  requiresKey: boolean
  keyUrl: string
}

export const PROVIDER_CATALOGUE: readonly ProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    badge: '推荐',
    defaultModel: 'deepseek-v4-flash',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    modelSuggestions: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    requiresKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'claude',
    label: 'Claude',
    defaultModel: 'claude-opus-5',
    defaultBaseUrl: '',
    modelSuggestions: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    requiresKey: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelSuggestions: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    requiresKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: '',
    modelSuggestions: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    requiresKey: true,
    keyUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'custom',
    label: '自定义',
    defaultModel: '',
    defaultBaseUrl: '',
    modelSuggestions: [],
    requiresKey: true,
    keyUrl: '',
  },
  {
    id: 'mock',
    label: '离线词典',
    badge: '免费',
    defaultModel: 'local-heuristic-v1',
    defaultBaseUrl: '',
    modelSuggestions: [],
    requiresKey: false,
    keyUrl: '',
  },
]

export function providerMeta(id: Settings['provider']): ProviderMeta {
  const found = PROVIDER_CATALOGUE.find((p) => p.id === id)
  if (!found) throw new Error(`Unknown provider: ${id}`)
  return found
}
