import { z } from 'zod'
import { DEFAULT_SETTINGS, readSettings, settingsSchema, type Settings } from '@/types/settings.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { storage } from '@/storage/area.ts'

export const DOCUMENT_KEY = 'ara:configuration-document'
export const CONFIG_FORMAT = 'fanfan-cards/configuration'
export const CONFIG_FILENAME = 'config.json'
export const CONFIG_FOLDER = 'FanFan Cards'
export const MAX_FILE_BYTES = 512 * 1024

const cellSchema = z.object({
  value: z.unknown(),
  updatedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  revision: z.string().max(100),
}).strict()
const documentSchema = z.object({
  format: z.literal(CONFIG_FORMAT),
  version: z.literal(1),
  fields: z.record(z.string(), cellSchema),
}).strict()
export type ConfigDocument = z.infer<typeof documentSchema>
export type ConfigCell = z.infer<typeof cellSchema>

/** Only these known paths may ever reach settings; arrays are indivisible values. */
export function flatten(value: object, prefix = ''): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return child !== null && typeof child === 'object' && !Array.isArray(child)
      ? Object.entries(flatten(child as object, path))
      : [[path, child]]
  }))
}
const defaults = flatten(DEFAULT_SETTINGS)
export const FIELD_PATHS = Object.keys(defaults)
const allowed = new Set(FIELD_PATHS)
export const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
export const emptyDocument = (): ConfigDocument => ({ format: CONFIG_FORMAT, version: 1, fields: {} })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** Callers pass known paths only, which is what keeps `__proto__` out. */
function assign(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let parent = target
  for (const key of parts.slice(0, -1)) {
    const child = parent[key]
    parent = parent[key] = isRecord(child) ? child : {}
  }
  parent[parts.at(-1)!] = value
}

export function settingsFromDocument(doc: ConfigDocument): Settings {
  const result = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
  for (const [path, cell] of Object.entries(doc.fields)) {
    if (!allowed.has(path)) throw new Error('Invalid configuration field')
    assign(result, path, cell.value)
  }
  return settingsSchema.parse(result)
}

/**
 * Apply what a merge changed, and nothing else, onto the current settings.
 *
 * Rebuilding from defaults plus the document instead resets every value the document
 * does not carry — a migration's output, for one — the moment any other field arrives.
 */
export function settingsWithChanges(current: Settings, before: ConfigDocument, after: ConfigDocument): Settings {
  const result = structuredClone(current) as unknown as Record<string, unknown>
  for (const [path, cell] of Object.entries(after.fields)) {
    if (!same(cell, before.fields[path])) assign(result, path, cell.value)
  }
  return settingsSchema.parse(result)
}

function valueAt(target: Record<string, unknown>, path: string): unknown {
  let value: unknown = target
  for (const key of path.split('.')) value = isRecord(value) ? value[key] : undefined
  return value
}

/**
 * What to store for an edit: the stored object, with the edited paths and any not
 * stored yet filled in from `next`.
 *
 * Storing the parsed object would also store this build's reading of everything else:
 * a default where it could not read a value, nothing at all for a field a newer build
 * added. Moving between builds must not cost those.
 */
export function storedSettings(raw: unknown, current: Settings, next: Settings): Record<string, unknown> {
  const stored = isRecord(raw) ? structuredClone(raw) : {}
  const before = flatten(current)
  for (const [path, value] of Object.entries(flatten(next))) {
    if (!same(value, before[path]) || valueAt(stored, path) === undefined) assign(stored, path, structuredClone(value))
  }
  return stored
}

export function parseDocument(raw: unknown): ConfigDocument {
  const doc = documentSchema.parse(raw)
  // Validate values with the same schema as live settings, before changing storage.
  settingsFromDocument(doc)
  if (Object.values(doc.fields).some((cell) => cell.value === undefined)) {
    throw new Error('Missing configuration value')
  }
  return doc
}

export function parseConfigText(text: string): ConfigDocument {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new Error('Configuration file too large')
  return parseDocument(JSON.parse(text))
}

/** Legacy settings have no edit dates. Give only non-default values a baseline stamp.
 * New-install defaults never compete with a real remote edit, including delayed sync. */
export async function getDocument(): Promise<ConfigDocument> {
  const stored = await storage().get<unknown>(DOCUMENT_KEY)
  if (stored !== undefined) {
    try { return parseDocument(stored) } catch {
      // A cell this build cannot read costs that cell. Rebuilding below would stamp every
      // local value 1, and any older remote copy would then win field by field.
      const readable = readableCells(stored)
      if (readable) return readable
    }
  }
  const settings = readSettings(await storage().get<unknown>(STORAGE_KEYS.settings))
  const doc = emptyDocument()
  for (const [path, value] of Object.entries(flatten(settings))) {
    if (!same(value, defaults[path])) doc.fields[path] = { value, updatedAt: 1, revision: 'legacy' }
  }
  return doc
}

function readableCells(raw: unknown): ConfigDocument | null {
  const parsed = documentSchema.safeParse(raw)
  if (!parsed.success) return null
  const fields = Object.fromEntries(Object.entries(parsed.data.fields).filter(([path, cell]) => {
    try {
      parseDocument({ ...emptyDocument(), fields: { [path]: cell } })
      return true
    } catch { return false }
  }))
  return { ...parsed.data, fields }
}

/** Called under the settings lock, before writing the new local settings. */
export async function documentForEdit(current: Settings, next: Settings): Promise<ConfigDocument> {
  const doc = await getDocument()
  const before = flatten(current)
  const nextStamp = Math.max(Date.now(), ...Object.values(doc.fields).map((cell) => cell.updatedAt + 1))
  const revision = crypto.randomUUID()
  for (const [path, value] of Object.entries(flatten(next))) {
    if (!same(value, before[path])) doc.fields[path] = { value, updatedAt: nextStamp, revision }
  }
  return doc
}

export function mergeDocuments(local: ConfigDocument, remote: ConfigDocument): ConfigDocument {
  const doc = structuredClone(local)
  for (const [path, incoming] of Object.entries(remote.fields)) {
    const old = doc.fields[path]
    if (!old || incoming.updatedAt > old.updatedAt ||
      (incoming.updatedAt === old.updatedAt &&
        `${incoming.revision}:${JSON.stringify(incoming.value)}` > `${old.revision}:${JSON.stringify(old.value)}`)) {
      doc.fields[path] = incoming
    }
  }
  return parseDocument(doc)
}
