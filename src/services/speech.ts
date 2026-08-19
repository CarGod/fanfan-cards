/**
 * Pronunciation via the platform's speech synthesis.
 *
 * No audio files, no dictionary API, no extra permission — and it works offline.
 * The trade-off is voice quality, which is acceptable for "what does this sound
 * like" and is a documented upgrade path (Youdao/Cambridge audio) in TODO.md.
 */
export function canSpeak(): boolean {
  return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'
}

let cachedVoice: SpeechSynthesisVoice | null | undefined

function pickEnglishVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice
  const voices = speechSynthesis.getVoices()
  cachedVoice =
    voices.find((voice) => voice.lang === 'en-US' && voice.localService) ??
    voices.find((voice) => voice.lang.startsWith('en')) ??
    null
  return cachedVoice
}

export function speak(text: string, rate = 0.95): void {
  if (!canSpeak() || !text.trim()) return
  speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = rate
  const voice = pickEnglishVoice()
  if (voice) utterance.voice = voice
  speechSynthesis.speak(utterance)
}

/** Voices load asynchronously in Chrome; re-resolve once they arrive. */
export function warmUpVoices(): void {
  if (!canSpeak()) return
  if (speechSynthesis.getVoices().length === 0) {
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        cachedVoice = undefined
        pickEnglishVoice()
      },
      { once: true },
    )
  }
}
