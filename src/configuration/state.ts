import { storage } from '@/storage/area.ts'
import { withLock } from '@/storage/mutex.ts'

export const CONFIG_STATE_KEY = 'ara:configuration-state'
export type ConfigMode = 'auto' | 'directory' | 'manual'
export type ConfigStatus = 'idle' | 'checking' | 'saved' | 'restored' | 'unavailable' | 'failed' | 'quota' | 'permission' | 'invalid' | 'empty' | 'local'
export interface ConfigState {
  mode: ConfigMode
  status: ConfigStatus
  lastSavedAt: number | null
  lastRestoredAt: number | null
  directoryName: string | null
  setupComplete: boolean
}
export const initialConfigState: ConfigState = {
  mode: 'auto', status: 'idle', lastSavedAt: null, lastRestoredAt: null,
  directoryName: null, setupComplete: false,
}
export async function getConfigState(): Promise<ConfigState> {
  return { ...initialConfigState, ...await storage().get<Partial<ConfigState>>(CONFIG_STATE_KEY) }
}
export async function updateConfigState(patch: Partial<ConfigState>): Promise<ConfigState> {
  return withLock(CONFIG_STATE_KEY, async () => {
    const state = { ...await getConfigState(), ...patch }
    await storage().set(CONFIG_STATE_KEY, state)
    return state
  })
}
