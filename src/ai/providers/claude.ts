import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { ZodType } from 'zod'

import { AIError, type AIProvider } from '@/types/ai.ts'
import type {
  ExplainWordInput,
  GenerateExampleInput,
  GeneratedExample,
  SummarizeInput,
  SummaryResult,
  TranslateBatchInput,
  TranslateInput,
  TranslateResult,
  WordExplanation,
} from '@/types/ai.ts'
import {
  batchTranslateSystemPrompt,
  buildBatchTranslatePrompt,
  buildExamplePrompt,
  buildExplainPrompt,
  buildSummarizePrompt,
  buildTranslatePrompt,
  exampleSystemPrompt,
  explainSystemPrompt,
  summarizeSystemPrompt,
  translateSystemPrompt,
} from '../prompts.ts'
import {
  coerceBatchTranslations,
  coerceExplanation,
  strictBatchTranslationSchema,
  strictExampleSchema,
  strictExplanationSchemaFor,
  strictSummarySchema,
  strictTranslationSchema,
} from '../schema.ts'

export interface ClaudeOptions {
  apiKey: string
  model: string
  /** Optional gateway/proxy base URL. */
  baseUrl?: string
}

/**
 * Server-side refusal fallback. A reading assistant is pointed at whatever the
 * user happens to be reading, so a lookup can legitimately land on drug slang,
 * a slur, or an exploit name. Without this, such a lookup surfaces as a hard
 * error to a learner who did nothing wrong; with it the request is re-routed
 * server-side. Dropped automatically if the account cannot use the beta.
 */
const REFUSAL_FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/**
 * Anthropic provider, built on the official SDK.
 *
 * Word lookup is latency-sensitive and cognitively easy, so it defaults to
 * `effort: 'low'` with adaptive thinking left on (the default on Opus 5).
 *
 * 读者在设置里选「关闭思考」时，这里**仍然只是把 effort 压到 low**，不发
 * `thinking: {type:'disabled'}`。官方文档写明了关掉思考的两种坏法：模型偶尔会把
 * 工具调用写进**可见正文**（那一轮成功、调用没执行、也不报错），以及把
 * `<thinking>` 标签漏进回答里。对一张给读者看的词卡来说，第二种就是直接的破相。
 * 低 effort 已经拿到了绝大部分的提速，没必要为剩下那点去冒这个险。
 */
export class ClaudeProvider implements AIProvider {
  readonly id = 'claude' as const
  readonly label = 'Claude (Anthropic)'
  readonly model: string
  readonly offline = false

  private readonly client: Anthropic
  /** Flips to false the first time the account rejects the fallback beta. */
  private useRefusalFallback = true

  constructor(options: ClaudeOptions) {
    if (!options.apiKey) throw new AIError('no_api_key', 'Anthropic API key is missing', this.id)
    this.model = options.model

    this.client = new Anthropic({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      // The extension calls the API from its own service-worker origin, never
      // from a page: keys are read from chrome.storage and never touch the DOM.
      dangerouslyAllowBrowser: true,
      maxRetries: 1,
      timeout: 30_000,
    })
  }

  async explainWord(input: ExplainWordInput, signal?: AbortSignal): Promise<WordExplanation> {
    const detail = input.detail ?? 'full'
    const parsed = await this.parseJson({
      system: explainSystemPrompt(input.languages),
      user: buildExplainPrompt(input),
      schema: strictExplanationSchemaFor(detail),
      maxTokens: 3000,
      // 「关闭思考」在这里也只是 low——见类文档：关掉思考会让标签漏进正文。
      effort: input.thinkingLevel === 'high' ? 'high' : 'low',
      signal,
    })
    return coerceExplanation(parsed, input.text, this.id, detail)
  }

  async translate(input: TranslateInput, signal?: AbortSignal): Promise<TranslateResult> {
    const parsed = await this.parseJson({
      system: translateSystemPrompt(input.targetLanguage),
      user: buildTranslatePrompt(input),
      schema: strictTranslationSchema,
      maxTokens: 4000,
      signal,
    })
    return parsed.note ? { translation: parsed.translation, note: parsed.note } : { translation: parsed.translation }
  }

  async translateBatch(input: TranslateBatchInput, signal?: AbortSignal): Promise<string[]> {
    const parsed = await this.parseJson({
      system: batchTranslateSystemPrompt(input.targetLanguage),
      user: buildBatchTranslatePrompt(input.texts, input.hint),
      schema: strictBatchTranslationSchema,
      maxTokens: 16000,
      signal,
    })
    return coerceBatchTranslations(parsed, input.texts.length)
  }

  async generateExample(
    input: GenerateExampleInput,
    signal?: AbortSignal,
  ): Promise<GeneratedExample> {
    return this.parseJson({
      system: exampleSystemPrompt(input.targetLanguage),
      user: buildExamplePrompt(input),
      schema: strictExampleSchema,
      maxTokens: 2000,
      signal,
    })
  }

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummaryResult> {
    return this.parseJson({
      system: summarizeSystemPrompt(input.targetLanguage),
      user: buildSummarizePrompt(input),
      schema: strictSummarySchema,
      maxTokens: 4000,
      signal,
    })
  }

  private async parseJson<T>(args: {
    system: string
    user: string
    schema: ZodType<T>
    maxTokens: number
    /** 不传时按 low 走：这个产品里绝大多数请求都是查词。 */
    effort?: 'low' | 'high'
    signal?: AbortSignal | undefined
  }): Promise<T> {
    try {
      return await this.request({ ...args, effort: args.effort ?? 'low' }, this.useRefusalFallback)
    } catch (error) {
      // An account without the beta rejects the request outright; retry clean
      // once and remember, so this costs at most one extra round trip ever.
      if (this.useRefusalFallback && error instanceof Anthropic.BadRequestError) {
        this.useRefusalFallback = false
        return this.request({ ...args, effort: args.effort ?? 'low' }, false)
      }
      throw this.toAIError(error, args.signal)
    }
  }

  private async request<T>(
    args: {
      system: string
      user: string
      schema: ZodType<T>
      maxTokens: number
      effort: 'low' | 'high'
      signal?: AbortSignal | undefined
    },
    withFallback: boolean,
  ): Promise<T> {
    const message = await this.client.beta.messages.parse(
      {
        model: this.model,
        max_tokens: args.maxTokens,
        system: args.system,
        messages: [{ role: 'user', content: args.user }],
        output_config: {
          effort: args.effort,
          format: betaZodOutputFormat(args.schema),
        },
        ...(withFallback ? { betas: [REFUSAL_FALLBACK_BETA], fallbacks: 'default' as const } : {}),
      },
      args.signal ? { signal: args.signal } : {},
    )

    if (message.stop_reason === 'refusal') {
      throw new AIError('refused', 'Claude declined to explain this selection', this.id)
    }
    const parsed = message.parsed_output
    if (!parsed) throw new AIError('bad_response', 'Claude returned no structured output', this.id)
    return parsed
  }

  private toAIError(error: unknown, signal?: AbortSignal | undefined): AIError {
    if (error instanceof AIError) return error
    if (error instanceof Anthropic.APIUserAbortError) {
      return signal?.aborted
        ? new AIError('aborted', 'Request cancelled', this.id)
        : new AIError('timeout', 'Request timed out', this.id)
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return new AIError('auth', 'Anthropic API key rejected', this.id, error.status)
    }
    if (error instanceof Anthropic.RateLimitError) {
      return new AIError('rate_limit', 'Anthropic rate limit hit', this.id, error.status)
    }
    if (error instanceof Anthropic.APIConnectionTimeoutError) {
      return new AIError('timeout', 'Anthropic request timed out', this.id)
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return new AIError('network', error.message, this.id)
    }
    if (error instanceof Anthropic.APIError) {
      const status = typeof error.status === 'number' ? error.status : undefined
      return new AIError('unknown', error.message, this.id, status)
    }
    return new AIError('unknown', error instanceof Error ? error.message : String(error), this.id)
  }
}
