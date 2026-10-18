import { describe, expect, it } from 'vitest'
import { Tensor } from '@huggingface/transformers'
import { AutoLanguagePrefix, automaticLanguageOptions } from './whisperLanguage'
const config = { decoder_start_token_id: 0, lang_to_id: { '<|en|>': 1, '<|zh|>': 2 }, task_to_id: { transcribe: 3 }, no_timestamps_token_id: 4, begin_suppress_tokens: [5, 6] }
const logits = () => new Tensor('float32', new Float32Array([99, 2, 7, 90, 80, 3, 4, 5]), [1, 8])
describe('Whisper automatic language transcription prefix', () => {
  it('lets model scores choose language while excluding text and task tokens', () => {
    const values = new AutoLanguagePrefix(config)._call([[0n]], logits()).data
    expect(Array.from(values)).toEqual([-Infinity, 2, 7, -Infinity, -Infinity, -Infinity, -Infinity, -Infinity])
  })
  it('forces transcription and no timestamps after either language', () => {
    const p = new AutoLanguagePrefix(config)
    expect(Array.from(p._call([[0n, 2n]], logits()).data)).toEqual([-Infinity, -Infinity, -Infinity, 0, -Infinity, -Infinity, -Infinity, -Infinity])
    expect(Array.from(p._call([[0n, 1n, 3n]], logits()).data)).toEqual([-Infinity, -Infinity, -Infinity, -Infinity, 0, -Infinity, -Infinity, -Infinity])
  })
  it('preserves first-text suppression then leaves normal decoding untouched', () => {
    const p = new AutoLanguagePrefix(config)
    expect(Array.from(p._call([[0n, 2n, 3n, 4n]], logits()).data)).toEqual([99, 2, 7, 90, 80, -Infinity, -Infinity, 5])
    expect(Array.from(p._call([[0n, 2n, 3n, 4n, 7n]], logits()).data)).toEqual(Array.from(logits().data))
  })
  it('starts at the start token instead of the library default English prefix', () => {
    expect(automaticLanguageOptions(config).decoder_input_ids).toEqual([0])
  })
})
