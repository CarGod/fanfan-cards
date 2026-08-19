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
  EXAMPLE_JSON_SCHEMA,
  exampleSchema,
  summarySchema,
  SUMMARY_JSON_SCHEMA,
  translationSchema,
  TRANSLATION_JSON_SCHEMA,
  explanationJsonSchema,
} from '../schema.ts'

export interface GeminiOptions {
  apiKey: string
  model: string
  baseUrl: string
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

/**
 * Gemini's `responseSchema` is an OpenAPI-3 subset, not JSON Schema: enum type
 * names are upper-case and `additionalProperties` is rejected. Rather than keep
 * a second copy of every schema, we translate the canonical one at call time.
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema)
  if (!schema || typeof schema !== 'object') return schema

  const source = schema as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(source)) {
    if (key === 'additionalProperties') continue
    if (key === 'type' && typeof value === 'string') {
      out['type'] = value.toUpperCase()
      continue
    }
    if (key === 'properties' && value && typeof value === 'object') {
      out['properties'] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([name, child]) => [
          name,
          toGeminiSchema(child),
        ]),
      )
      // Keeps field order stable, which measurably improves Gemini's adherence.
      out['propertyOrdering'] = Object.keys(value as Record<string, unknown>)
      continue
    }
    out[key] = key === 'items' ? toGeminiSchema(value) : value
  }
  return out
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const
  readonly label = 'Google Gemini'
  readonly model: string
  readonly offline = false

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options: GeminiOptions) {
    this.model = options.model
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    if (!this.apiKey) throw new AIError('no_api_key', 'Gemini API key is missing', this.id)
  }

  async explainWord(input: ExplainWordInput, signal?: AbortSignal): Promise<WordExplanation> {
    const detail = input.detail ?? 'full'
    const raw = await this.generate({
      system: explainSystemPrompt(input.languages),
      user: buildExplainPrompt(input),
      schema: explanationJsonSchema(detail),
      maxTokens: 2000,
      signal,
    })
    return coerceExplanation(raw, input.text, this.id, detail)
  }

  async translate(input: TranslateInput, signal?: AbortSignal): Promise<TranslateResult> {
    const raw = await this.generate({
      system: translateSystemPrompt(input.targetLanguage),
      user: buildTranslatePrompt(input),
      schema: TRANSLATION_JSON_SCHEMA,
      maxTokens: 1200,
      signal,
    })
    const parsed = translationSchema.parse(raw)
    return parsed.note
      ? { translation: parsed.translation, note: parsed.note }
      : { translation: parsed.translation }
  }

  async translateBatch(input: TranslateBatchInput, signal?: AbortSignal): Promise<string[]> {
    const raw = await this.generate({
      system: batchTranslateSystemPrompt(input.targetLanguage),
      user: buildBatchTranslatePrompt(input.texts, input.hint),
      schema: BATCH_TRANSLATION_JSON_SCHEMA,
      maxTokens: 8000,
      signal,
    })
    return coerceBatchTranslations(raw, input.texts.length)
  }

  async generateExample(
    input: GenerateExampleInput,
    signal?: AbortSignal,
  ): Promise<GeneratedExample> {
    const raw = await this.generate({
      system: exampleSystemPrompt(input.targetLanguage),
      user: buildExamplePrompt(input),
      schema: EXAMPLE_JSON_SCHEMA,
      maxTokens: 300,
      signal,
    })
    return exampleSchema.parse(raw)
  }

  async summarize(input: SummarizeInput, signal?: AbortSignal): Promise<SummaryResult> {
    const raw = await this.generate({
      system: summarizeSystemPrompt(input.targetLanguage),
      user: buildSummarizePrompt(input),
      schema: SUMMARY_JSON_SCHEMA,
      maxTokens: 800,
      signal,
    })
    return summarySchema.parse(raw)
  }

  private async generate(args: {
    system: string
    user: string
    schema: object
    maxTokens: number
    signal?: AbortSignal | undefined
  }): Promise<unknown> {
    const response = await postJson<GenerateContentResponse>({
      url: `${this.baseUrl}/models/${encodeURIComponent(this.model)}:generateContent`,
      headers: { 'x-goog-api-key': this.apiKey },
      body: {
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.user }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: args.maxTokens,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(args.schema),
        },
      },
      providerId: this.id,
      signal: args.signal,
    })

    if (response.promptFeedback?.blockReason) {
      throw new AIError('refused', `Blocked: ${response.promptFeedback.blockReason}`, this.id)
    }
    const candidate = response.candidates?.[0]
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'PROHIBITED_CONTENT') {
      throw new AIError('refused', 'Gemini declined to answer', this.id)
    }
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? ''
    if (!text) throw new AIError('bad_response', 'Gemini returned no content', this.id)
    return extractJson(text, this.id)
  }
}
