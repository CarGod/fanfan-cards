import { describe, expect, it } from 'vitest'
import { optionalApiOrigin } from './hostPermission.ts'

describe('optionalApiOrigin', () => {
  it('requests only the origin of an HTTPS endpoint', () => {
    expect(optionalApiOrigin('https://gateway.example.com/v1/chat')).toBe(
      'https://gateway.example.com/*',
    )
  })

  it('allows the declared localhost development origin', () => {
    expect(optionalApiOrigin('http://localhost:11434/v1')).toBe('http://localhost/*')
  })

  it('rejects insecure remote endpoints', () => {
    expect(() => optionalApiOrigin('http://api.example.com/v1')).toThrow('HTTPS')
  })

  it('rejects malformed URLs', () => {
    expect(() => optionalApiOrigin('api.example.com/v1')).toThrow('有效的网址')
  })
})
