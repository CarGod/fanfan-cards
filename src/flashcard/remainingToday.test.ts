import { describe, expect, it } from 'vitest'
import { remainingToday } from './scheduler.ts'

describe('remainingToday', () => {
  it('shows what is left toward the daily goal, not everything due', () => {
    expect(remainingToday(57, 20, 0)).toBe(20)
    expect(remainingToday(57, 20, 12)).toBe(8)
  })
  it('never exceeds what is actually due', () => {
    expect(remainingToday(3, 20, 0)).toBe(3)
  })
  it('goes quiet once the goal is met, and never goes negative', () => {
    expect(remainingToday(57, 20, 20)).toBe(0)
    expect(remainingToday(57, 20, 25)).toBe(0)
    expect(remainingToday(0, 20, 0)).toBe(0)
  })
})
