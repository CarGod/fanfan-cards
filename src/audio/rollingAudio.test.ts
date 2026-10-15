import { describe, expect, it } from 'vitest'
import { RollingAudio } from './rollingAudio.ts'
describe('local audio lookback', () => {
  it('adds bounded preceding speech to a short final fragment', () => {
    const rolling = new RollingAudio(3)
    expect([...rolling.append(new Float32Array([1,2,3,4,5]), 'one:0')]).toEqual([1,2,3,4,5])
    expect([...rolling.append(new Float32Array([6]), 'one:0')]).toEqual([3,4,5,6])
    expect([...rolling.append(new Float32Array([7]), 'one:0')]).toEqual([4,5,6,7])
  })
  it('never leaks old audio across a seek, rate change or another video', () => {
    const rolling = new RollingAudio(3)
    rolling.append(new Float32Array([1,2,3]), 'one:0')
    expect([...rolling.append(new Float32Array([4]), 'one:1')]).toEqual([4])
    expect([...rolling.append(new Float32Array([5]), 'two:0')]).toEqual([5])
    rolling.clear()
    expect([...rolling.append(new Float32Array([6]), 'two:0')]).toEqual([6])
  })
})
