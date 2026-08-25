import { AIError, type AIProvider, type ProviderId } from '@/types/ai.ts'
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
const EXPLAIN_MAX_TOKENS = 4000

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
  private readonly extraHeaders: Record<string, string>

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id
    this.label = options.label
    this.model = options.model
    this.apiKey = options.apiKey
    this.baseUrl = normalizeBaseUrl(options.baseUrl)
    this.structuredOutput = options.structuredOutput
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
        `模型在写出答案前就用尽了 ${args.maxTokens} 个输出 token（finish_reason=length，`
          + `已生成 ${response.usage?.completion_tokens ?? '?'} 个）。`
          + '这通常意味着该模型是推理型模型，请在设置页换一个更快的模型，或改用其它服务商。',
        this.id,
      )
    }
    throw new AIError(
      'bad_response',
      `模型没有返回任何内容（finish_reason=${choice?.finish_reason ?? 'unknown'}`
        + `${reasoning ? '，但返回了推理内容且其中没有 JSON' : ''}）`,
      this.id,
    )
  }
}
