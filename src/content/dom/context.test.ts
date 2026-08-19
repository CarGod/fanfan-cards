import { describe, expect, it } from 'vitest'
import { sentenceAt } from './context.ts'

describe('sentenceAt', () => {
  const paragraph =
    'We ship on Fridays. Database migration can be dangerous. Roll back if it fails.'

  it('returns the sentence containing the offset', () => {
    const offset = paragraph.indexOf('migration')
    expect(sentenceAt(paragraph, offset, 'migration')).toBe(
      'Database migration can be dangerous.',
    )
  })

  it('handles the first and last sentence', () => {
    expect(sentenceAt(paragraph, 3, 'ship')).toBe('We ship on Fridays.')
    expect(sentenceAt(paragraph, paragraph.indexOf('Roll'), 'Roll')).toBe('Roll back if it fails.')
  })

  it('does not split on abbreviations', () => {
    const text = 'Use a queue, e.g. SQS, to decouple the services.'
    expect(sentenceAt(text, text.indexOf('decouple'), 'decouple')).toBe(text)
  })

  it('does not split inside version numbers', () => {
    const text = 'Upgrade to v2.5 before the migration window closes.'
    expect(sentenceAt(text, text.indexOf('migration'), 'migration')).toBe(text)
  })

  it('falls back when there is no usable text', () => {
    expect(sentenceAt('', 0, 'fallback')).toBe('fallback')
  })
})
