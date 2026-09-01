import { useCallback, useEffect, useState } from 'react'
import { listEntries, watchEntries } from '@/storage/repositories/vocabularyRepo.ts'
import { getSettings, saveSettings, watchSettings } from '@/storage/repositories/settingsRepo.ts'
import { readActivity, type ActivityMap } from '@/storage/repositories/activityRepo.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { storage } from '@/storage/area.ts'
import { DEFAULT_SETTINGS, type Settings } from '@/types/settings.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'

/**
 * Extension pages read `chrome.storage` directly rather than messaging the
 * background worker: same data, one less hop, and `storage.onChanged` gives us
 * live updates across every open surface for free — save a word on a web page
 * and an open vocabulary tab updates itself.
 */

export function useEntries(): { entries: VocabularyEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<VocabularyEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void listEntries().then((initial) => {
      if (!alive) return
      setEntries(initial)
      setLoading(false)
    })
    const unwatch = watchEntries(setEntries)
    return () => {
      alive = false
      unwatch()
    }
  }, [])

  return { entries, loading }
}

export function useSettings(): {
  settings: Settings
  update: (patch: Partial<Settings>) => Promise<void>
  loading: boolean
} {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void getSettings().then((initial) => {
      if (!alive) return
      setSettings(initial)
      setLoading(false)
    })
    const unwatch = watchSettings(setSettings)
    return () => {
      alive = false
      unwatch()
    }
  }, [])

  const update = useCallback(async (patch: Partial<Settings>) => {
    const next = await saveSettings(patch)
    setSettings(next)
  }, [])

  return { settings, update, loading }
}

export function useActivity(): ActivityMap {
  const [activity, setActivity] = useState<ActivityMap>({})

  useEffect(() => {
    void readActivity().then(setActivity)
    return storage().watch(STORAGE_KEYS.activity, (value) =>
      setActivity((value as ActivityMap | undefined) ?? {}),
    )
  }, [])

  return activity
}

/** Hash-based routing: extension pages cannot use the History API cleanly. */
export function useHashRoute(fallback: string): [string, (next: string) => void] {
  const [route, setRoute] = useState(() => location.hash || fallback)

  useEffect(() => {
    const onChange = () => setRoute(location.hash || fallback)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [fallback])

  const navigate = useCallback((next: string) => {
    location.hash = next
  }, [])

  return [route, navigate]
}

/** Ephemeral status line, auto-clearing. */
export function useToast(): [string | null, (message: string) => void] {
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 2400)
    return () => clearTimeout(timer)
  }, [toast])

  return [toast, setToast]
}
