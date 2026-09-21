import { describe, expect, it, vi } from 'vitest'
import { emptyDocument } from './document.ts'
import { configFolder, readDirectory, writeDirectory, type ConfigDirectory } from './directory.ts'

function fakeDirectory(text = JSON.stringify(emptyDocument()), permission: PermissionState = 'granted') {
  const stream = { write: vi.fn(async () => undefined), close: vi.fn(async () => undefined), abort: vi.fn(async () => undefined) }
  const file = { getFile: vi.fn(async () => ({ size: text.length, text: async () => text })), createWritable: vi.fn(async () => stream) }
  const folder = { getFileHandle: vi.fn(async () => file) }
  const parent = { name: 'iCloud Drive', queryPermission: vi.fn(async () => permission), getDirectoryHandle: vi.fn(async () => folder) }
  return { parent: parent as unknown as ConfigDirectory, folder, file, stream }
}

describe('selected configuration folder', () => {
  it('uses the fixed relative path and closes the writer before reporting completion', async () => {
    const { parent, folder, stream } = fakeDirectory()
    await writeDirectory(parent, emptyDocument())
    expect(parent.getDirectoryHandle).toHaveBeenCalledWith('FanFan Cards', { create: true })
    expect(folder.getFileHandle).toHaveBeenCalledWith('config.json', { create: true })
    expect(stream.write).toHaveBeenCalledWith(JSON.stringify(emptyDocument(), null, 2))
    expect(stream.close).toHaveBeenCalledTimes(1)
  })
  it('accepts selecting the FanFan Cards folder itself without nesting it again', async () => {
    const { parent } = fakeDirectory()
    Object.defineProperty(parent, 'name', { value: 'FanFan Cards' })
    expect(await configFolder(parent, true)).toBe(parent)
    expect(parent.getDirectoryHandle).not.toHaveBeenCalled()
  })
  it('lost permission does not try writing or prompt without a user gesture', async () => {
    const { parent, file } = fakeDirectory(undefined, 'prompt')
    await expect(readDirectory(parent, false)).rejects.toMatchObject({ status: 'permission' })
    await expect(writeDirectory(parent, emptyDocument())).rejects.toMatchObject({ status: 'permission' })
    expect(file.createWritable).not.toHaveBeenCalled()
  })
  it('rejects corrupt or partially downloaded files', async () => {
    const { parent } = fakeDirectory('{')
    await expect(readDirectory(parent, true)).rejects.toMatchObject({ status: 'invalid' })
  })
  it('only permits a missing file during initial selection, never recreates a disappeared linked file', async () => {
    const { parent, file } = fakeDirectory()
    file.getFile.mockRejectedValue(new DOMException('missing', 'NotFoundError'))
    expect(await readDirectory(parent, true)).toBeNull()
    await expect(readDirectory(parent, false)).rejects.toMatchObject({ name: 'NotFoundError' })
    expect(file.createWritable).not.toHaveBeenCalled()
  })
  it('aborts a failed write without claiming completion', async () => {
    const { parent, stream } = fakeDirectory()
    stream.write.mockRejectedValueOnce(new Error('disk full'))
    await expect(writeDirectory(parent, emptyDocument())).rejects.toThrow('disk full')
    expect(stream.close).not.toHaveBeenCalled()
    expect(stream.abort).toHaveBeenCalledTimes(1)
  })
})
