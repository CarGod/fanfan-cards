import { LogitsProcessor, LogitsProcessorList, type Tensor } from '@huggingface/transformers'

type WhisperPrefixConfig = {
  decoder_start_token_id: number
  lang_to_id: Record<string, number>
  task_to_id: Record<string, number>
  no_timestamps_token_id: number
  begin_suppress_tokens?: number[]
}

// Transformers.js 3.8.1 defaults an omitted language to English. Let Whisper
// predict its language token, then require transcription (never translation).
export class AutoLanguagePrefix extends LogitsProcessor {
  constructor(private readonly config: WhisperPrefixConfig) { super() }

  override _call(inputIds: bigint[][], logits: Tensor): Tensor {
    for (let batch = 0; batch < inputIds.length; batch++) {
      const length = inputIds[batch]!.length
      if (length > 4) continue
      const width = logits.dims[logits.dims.length - 1]!
      const values = (logits.data as Float32Array).subarray(batch * width, (batch + 1) * width)
      if (length === 4) {
        for (const id of this.config.begin_suppress_tokens ?? []) values[id] = -Infinity
      } else if (length === 1) {
        const allowed = Object.values(this.config.lang_to_id).map(id => [id, values[id]!] as const)
        values.fill(-Infinity)
        for (const [id, value] of allowed) values[id] = value
      } else if (length === 2 || length === 3) {
        values.fill(-Infinity)
        values[length === 2 ? this.config.task_to_id.transcribe! : this.config.no_timestamps_token_id] = 0
      }
    }
    return logits
  }
}

export function automaticLanguageOptions(config: WhisperPrefixConfig) {
  const processors = new LogitsProcessorList()
  processors.push(new AutoLanguagePrefix(config))
  return { decoder_input_ids: [config.decoder_start_token_id], logits_processor: processors }
}
