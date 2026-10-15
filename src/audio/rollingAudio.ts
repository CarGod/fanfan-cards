/** Bounded local lookback. A seek/rate/video change must use a new continuity key. */
export class RollingAudio {
  private preceding = new Float32Array(0)
  private key = ''
  constructor(private readonly maxSamples = 6 * 16000) {}
  clear(): void { this.preceding = new Float32Array(0); this.key = '' }
  append(samples: Float32Array, key: string): Float32Array {
    if (this.key !== key) this.clear()
    this.key = key
    const window = new Float32Array(this.preceding.length + samples.length)
    window.set(this.preceding)
    window.set(samples, this.preceding.length)
    this.preceding = window.slice(-this.maxSamples)
    return window
  }
}
