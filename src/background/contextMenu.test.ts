import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CONTEXT_MENU_ID, refreshContextMenu } from './contextMenu.ts'

let menuExists: boolean
let duplicateCount: number
let failRemoval: boolean
let consumedErrors: number
let callbackError: { message: string } | undefined
beforeEach(() => {
  menuExists = true
  duplicateCount = 0
  failRemoval = false
  consumedErrors = 0
  callbackError = undefined
  vi.stubGlobal('chrome', {
    runtime: { get lastError() { if (callbackError) consumedErrors++; return callbackError } },
    contextMenus: {
      removeAll: vi.fn((callback: () => void) => {
        setTimeout(() => {
          if (failRemoval) callbackError = { message: 'temporarily unavailable' }
          else menuExists = false
          callback()
          callbackError = undefined
        }, 0)
      }),
      create: vi.fn((properties: { id: string }, callback: () => void) => {
        expect(properties.id).toBe(CONTEXT_MENU_ID)
        setTimeout(() => {
          if (menuExists) { duplicateCount++; callbackError = { message: 'duplicate id' } }
          menuExists = true
          callback()
          callbackError = undefined
        }, 0)
      }),
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

it('serializes overlapping install, startup and language changes without duplicate IDs', async () => {
  expect(await Promise.all([refreshContextMenu(), refreshContextMenu(), refreshContextMenu()])).toEqual([true, true, true])
  expect(duplicateCount).toBe(0)
  expect(menuExists).toBe(true)
})
it('consumes callback errors, skips unsafe creation and recovers on the next refresh', async () => {
  failRemoval = true
  expect(await refreshContextMenu()).toBe(false)
  expect(consumedErrors).toBe(1)
  expect(chrome.contextMenus.create).not.toHaveBeenCalled()
  failRemoval = false
  expect(await refreshContextMenu()).toBe(true)
  expect(duplicateCount).toBe(0)
})
it('consumes create errors too and allows subsequent refreshes', async () => {
  vi.mocked(chrome.contextMenus.create).mockImplementationOnce((_properties, callback) => {
    callbackError = { message: 'create failed' }
    callback?.()
    callbackError = undefined
    return CONTEXT_MENU_ID
  })
  expect(await refreshContextMenu()).toBe(false)
  expect(consumedErrors).toBe(1)
  expect(await refreshContextMenu()).toBe(true)
})
