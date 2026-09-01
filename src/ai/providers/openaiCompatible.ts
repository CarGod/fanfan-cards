import {
  AIError,
  type AIProvider,
  type ProviderId,
  type ThinkingLevel,
} from '@/types/ai.ts'
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
import { t } from '@/i18n/index.ts'
import { postJson } from '../http.ts'
import { extractJson } from '../json.ts'
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
  BATCH_TRANSLATION_JSON_SCHEMA,
  coerceBatchTranslations,
  coerceExplanation,
  describeSchemaForPrompt,
  EXAMPLE_JSON_SCHEMA,
  exampleSchema,
  summarySchema,
  SUMMARY_JSON_SCHEMA,
  translationSchema,
  TRANSLATION_JSON_SCHEMA,
  explanationJsonSchema,
} from '../schema.ts'

/**
 * Reasoning models (DeepSeek v4, o-series, and most "flash thinking" variants)
 * spend tokens on a chain of thought *before* writing a single character of the
 * answer. A budget sized for the answer alone gets consumed entirely by
 * reasoning, and the response comes back with `finish_reason: "length"` and an
 * empty `content` — which reads as "the model said nothing".
 *
 * `max_tokens` is a ceiling, not a charge: unused headroom costs nothing.
 */
/**
 * 这个端点用哪一套参数表达「少想一点」。
 *
 * - `deepseek`：`reasoning_effort`（low/high/max，**默认 high**）加
 *   `thinking: {type}` 开关。
 * - `openai`：`reasoning_effort`，没有独立的开关字段。
 * - `none`：什么都不发。自建网关和不确定的端点走这条——多发一个不认识的字段，
 *   代价是整个配置 400，而收益只是快一点。
 */
export type ReasoningDialect = 'deepseek' | 'openai' | 'none'

export const EXPLAIN_MAX_TOKENS = 4000

/**
 * People paste whatever their provider's docs showed them: a bare host, a path
 * with a trailing slash, or the full completions endpoint. All three should
 * work rather than producing a 404 they have to debug.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '')
    .replace(/\/+$/, '')
}

/** How strictly the endpoint can constrain output shape. */
export type StructuredOutputMode = 'json_schema' | 'json_object' | 'none'

export interface OpenAICompatibleOptions {
  id: ProviderId
  label: string
  apiKey: string
  model: string
  baseUrl: string
  structuredOutput: StructuredOutputMode
  /**
   * 这个端点认哪一套推理参数。
   *
   * **只对确认支持的服务商发。** 「OpenAI 兼容」是个很宽的说法：Ollama、
   * LM Studio、各种自建网关都自称兼容，而它们对不认识的字段的反应是
   * 直接 400——那会让一个本来能用的配置彻底不能用，只为了一个可有可无的加速。
   */
  reasoning?: ReasoningDialect
  /** Extra headers, e.g. OpenRouter attribution. */
  headers?: Record<string, string>
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      /** Reasoning models put their chain of thought here, not in `content`. */
      reasoning_content?: string | null
      reasoning?: string | null
    }
    finish_reason?: string
  }>
  usage?: { completion_tokens?: number }
}

/**
 * Covers OpenAI, DeepSeek, and every "OpenAI-compatible" gateway (OpenRouter,
 * SiliconFlow, Ollama, corporate proxies). One transport, three configs — the
 * differences that matter are the base URL and how strictly the endpoint can
 * constrain JSON output.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly id: ProviderId
  readonly label: string
  readonly model: string
  readonly offline = false

  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly structuredOutput: StructuredOutputMode
  private readonly reasoning: ReasoningDialect
  private readonly extraHeaders: Record<string, string>

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id
    this.label = options.label
    this.model = options.model
    this.apiKey = options.apiKey
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.structuredOutput = options.structuredOutput
    this.reasoning = options.reasoning ?? 'none'
    this.extraHeaders = options.headers ?? {}

    if (!this.baseUrl) throw new AIError('unknown', 'Base URL is not configured', this.id)
    if (!this.model) throw new AIError('unknown', 'Model is not configured', this.id)
  }

  async explainWord(input: ExplainWordInput, signal?: AbortSignal): Promise<WordExplanation> {
    const detail = input.detail ?? 'full'
    const raw = await this.chatJson({
      system: explainSystemPrompt(input.languages),
      user: buildExplainPrompt(input),
      schemaName: 'word_explanation',
      schema: explanationJsonSchema(detail),
      maxTokens: EXPLAIN_MAX_TOKENS,
      thinkingLevel: input.thinkingLevel,
      signal,
    })
    return coerceExplanation(raw, input.text, this.id, detail)
  }

  async translate(input: TranslateInput, signal?: AbortSignal): Promise<TranslateResult> {
    const raw = await this.chatJson({
      system: translateSystemPrompt(input.targetLanguage),
      user: buildTranslatePrompt(input),
      schemaName: 'translation',
      schema: TRANSLATION_JSON_SCHEMA,
      maxTokens: 4000,
      signal,
    })
    const parsed = translationSchema.parse(raw)
    return parsed.note ? { translation: parsed.translation, note: parsed.note } : { translation: parsed.translation }
  }

  async translateBatch(input: TranslateBatchInput, signal?: AbortSignal): Promise<string[]> {
    const raw = await this.chatJson({
      system: batchTranslateSystemPrompt(input.targetLanguage),
      user: buildBatchTranslatePrompt(input.texts, input.hint),
      schemaName: 'batch_translation',
      schema: BATCH_TRANSLATION_JSON_SCHEMA,
      maxTokens: 8000,
      signal,
    })
    return coerceBatchTranslations(raw, input.texts.length)
  }

  async generateExample(input: GenerateExampleInput, signal?: AbortSignal): Promise<GeneratedExample> {
    const raw = await this.chatJson({
      system: exampleSystemPrompt(input.targetLanguage),
      user: buildExamplePrompt(input),
      schemaName: 'example_sentence',
      schema: EXAMPLE_JSON_SCHEMA,
      maxTokens: 1500,
      signal,
    })
    return exampleSchema.parse(raw)
  }

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummaryResult> {
    const raw = await this.chatJson({
      system: summarizeSystemPrompt(input.targetLanguage),
      user: buildSummarizePrompt(input),
      schemaName: 'summary',
      schema: SUMMARY_JSON_SCHEMA,
      maxTokens: 2000,
      signal,
    })
    return summarySchema.parse(raw)
  }

  private async chatJson(args: {
    system: string
    user: string
    schemaName: string
    schema: object
    maxTokens: number
    thinkingLevel?: ThinkingLevel | undefined
    signal?: AbortSignal | undefined
  }): Promise<unknown> {
    // `json_object` guarantees valid JSON, not *our* JSON: the field contract
    // has to travel in the prompt or the model invents its own key names.
    const user =
      this.structuredOutput === 'json_schema'
        ? args.user
        : `${args.user}\n\n${describeSchemaForPrompt(args.schema as never)}`

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: args.maxTokens,
      temperature: 0.2,
      messages: [
        { role: 'system', content: args.system },
        { role: 'user', content: user },
      ],
    }

    applyReasoning(body, this.reasoning, args.thinkingLevel)

    if (this.structuredOutput === 'json_schema') {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: args.schemaName, strict: true, schema: args.schema },
      }
    } else if (this.structuredOutput === 'json_object') {
      body['response_format'] = { type: 'json_object' }
    }

    const headers: Record<string, string> = { ...this.extraHeaders }
    if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`

    const response = await postJson<ChatCompletionResponse>({
      url: `${this.baseUrl}/chat/completions`,
      headers,
      body,
      providerId: this.id,
      signal: args.signal,
    })

    const choice = response.choices?.[0]
    if (choice?.finish_reason === 'content_filter') {
      throw new AIError('refused', 'The provider filtered this content', this.id)
    }

    const message = choice?.message
    const content = message?.content?.trim()
    if (content) return extractJson(content, this.id)

    // Empty `content` has two very different causes, and the user deserves to
    // know which one they hit rather than being told "no content".
    const reasoning = (message?.reasoning_content ?? message?.reasoning ?? '').trim()
    if (reasoning) {
      // Some gateways stream the whole answer into the reasoning channel.
      // If a JSON object is in there, use it rather than failing the lookup.
      try {
        return extractJson(reasoning, this.id)
      } catch {
        // fall through to the error below
      }
    }
    if (choice?.finish_reason === 'length') {
      throw new AIError(
        'bad_response',
        t('error.provider.token_budget_spent', {
          limit: args.maxTokens,
          used: response.usage?.completion_tokens ?? '?',
        }),
        this.id,
      )
    }
    throw new AIError(
      'bad_response',
      t('error.provider.no_content', {
        reason: choice?.finish_reason ?? 'unknown',
        note: reasoning ? t('error.provider.reasoning_no_json') : '',
      }),
      this.id,
    )
  }
}

/**
 * 把「思考多深」翻译成这个端点认得的字段。
 *
 * 导出是为了可测：这里发错一个字段名，表现是**什么都没发生**——请求照常成功，
 * 只是慢照旧。没有报错，没有线索，唯一的症状是读者觉得"好像没变快"。
 */
export function applyReasoning(
  body: Record<string, unknown>,
  dialect: ReasoningDialect,
  level: ThinkingLevel | undefined,
): void {
  if (dialect === 'none' || !level) return

  if (dialect === 'openai') {
    // OpenAI 没有独立的开关，最低档就是 `low`。
    body['reasoning_effort'] = level === 'high' ? 'high' : 'low'
    return
  }

  // DeepSeek：关得掉就真关掉，关不掉的档位用 reasoning_effort 压到最低。
  if (level === 'off') {
    body['thinking'] = { type: 'disabled' }
    return
  }
  body['thinking'] = { type: 'enabled' }
  body['reasoning_effort'] = level === 'high' ? 'high' : 'low'
}
