import { useEffect, useState } from 'react'
import { useI18n } from '@/i18n/react.ts'
import { restoreSettingsBackup } from '@/configuration/service.ts'
import { STORAGE_KEYS } from '@/shared/constants.ts'
import { dateTimeKey } from '@/shared/utils.ts'
import { storage } from '@/storage/area.ts'
import { dismissBackups, recoverableBackup, type SettingsBackup } from '@/storage/backups.ts'

/** Shown only when an upgrade backup holds an AI key or GitHub token the current settings lost. */
export function BackupNotice({ onRestored }: { onRestored: () => void }) {
  const { t } = useI18n()
  const [backup, setBackup] = useState<SettingsBackup | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    const read = () => { void recoverableBackup().then((value) => { if (alive) setBackup(value) }).catch(() => undefined) }
    const unwatch = [STORAGE_KEYS.settings, STORAGE_KEYS.settingsBackups].map((key) => storage().watch(key, read))
    read()
    return () => { alive = false; unwatch.forEach((stop) => stop()) }
  }, [])

  if (!backup) return null
  const act = async (job: () => Promise<void>, done?: () => void) => {
    setBusy(true)
    setFailed(false)
    try {
      await job()
      setBackup(null)
      done?.()
    } catch { setFailed(true) } finally { setBusy(false) }
  }

  return (
    <div className="banner" role="status">
      <p>{t('backup.found', {
        version: backup.version ? `v${backup.version}` : t('backup.previous_version'),
        time: dateTimeKey(backup.savedAt),
      })}</p>
      <p className="faint">{t('backup.restore_hint')}</p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={() => void act(() => restoreSettingsBackup(backup), onRestored)}>{t('backup.restore')}</button>
        <button className="btn btn-ghost" disabled={busy} onClick={() => void act(dismissBackups)}>{t('backup.dismiss')}</button>
      </div>
      {failed ? <p role="alert">{t('backup.failed')}</p> : null}
    </div>
  )
}
