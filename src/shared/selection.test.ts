import { describe, expect, it } from 'vitest'
import { classifySelection } from './utils.ts'

/**
 * The card's shape follows this classification, so getting it wrong is visible:
 * a sentence classified as a phrase came back with a 原形 line containing the
 * whole sentence and three example sentences "using" it.
 */
describe('classifySelection', () => {
  it('treats a bare token as a word, punctuation and all', () => {
    expect(classifySelection('migration')).toBe('word')
    expect(classifySelection('  Hello.  ')).toBe('word')
  })

  it('treats short multi-word selections as phrases', () => {
    expect(classifySelection('roll back')).toBe('phrase')
    expect(classifySelection('machine learning')).toBe('phrase')
    expect(classifySelection('in the long run')).toBe('phrase')
    // Six words, no full stop — an idiom, not a sentence.
    expect(classifySelection('as far as I am concerned')).toBe('phrase')
  })

  it('detects a sentence by its terminal punctuation', () => {
    expect(classifySelection('Be water, my friend.')).toBe('sentence')
    expect(classifySelection('The roots of education are bitter, but the fruit is sweet.')).toBe(
      'sentence',
    )
    expect(classifySelection('Is it done?')).toBe('sentence')
    // A closing quote after the stop must not hide it.
    expect(classifySelection('“Little strokes fell great oaks.”')).toBe('sentence')
  })

  it('detects a sentence by length when the selection stopped short of the full stop', () => {
    expect(classifySelection('the quick brown fox jumps over the lazy dog')).toBe('sentence')
  })

  it('never returns sentence for fewer than three words', () => {
    expect(classifySelection('Done.')).toBe('word')
    expect(classifySelection('Fine!')).toBe('word')
  })
})
