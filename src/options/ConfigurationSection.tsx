import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@/i18n/react.ts'
import { storage } from '@/storage/area.ts'
import { downloadConfiguration, importConfigurationFile } from '@/configuration/file.ts'
import { DirectoryIssue, loadDirectory, pickDirectory, requestDirectoryPermission, supportsDirectory, type ConfigDirectory } from '@/configuration/directory.ts'
import {
  connectDirectory, selectConfigMode, synchronizeConfiguration,
} from '@/configuration/service.ts'
import { CONFIG_STATE_KEY, getConfigState, initialConfigState, updateConfigState, type ConfigState } from '@/configuration/state.ts'
import { dateTimeKey } from '@/shared/utils.ts'

function browserName(fallback: string): string {
  const nav = navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }
  if (/Edg\//.test(nav.userAgent)) return 'Edge'
  if (nav.userAgentData?.brands.some((item) => item.brand === 'Google Chrome')) return 'Chrome'
  return fallback
}

export function ConfigurationSection({ onConfigure, onConnected, onboarding = false }: {
  onConfigure: () => void
  onConnected?: (result: 'restored' | 'created') => void
  onboarding?: boolean
}) {
  const { t } = useI18n()
  const [state, setState] = useState<ConfigState>(initialConfigState)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [directory, setDirectory] = useState<ConfigDirectory>()
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    const read = () => { void getConfigState().then((value) => { if (alive) setState(value) }) }
    const unwatch = storage().watch(CONFIG_STATE_KEY, read)
    read()
    return () => { alive = false; unwatch() }
  }, [])

  useEffect(() => {
    let alive = true
    if (state.mode === 'directory') {
      void loadDirectory().then((handle) => { if (alive) setDirectory(handle) }).catch(() => {
        if (alive) setDirectory(undefined)
      })
    } else setDirectory(undefined)
    return () => { alive = false }
  }, [state.mode, state.directoryName, state.status])

  const action = async (job: () => Promise<unknown>) => {
    setBusy(true)
    setNotice('')
    try { await job() }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setNotice(error instanceof DirectoryIssue && error.status === 'permission'
        ? t('config.permission') : t('config.action_failed'))
    } finally { setBusy(false) }
  }
  const importFile = (file: File) => action(async () => {
    await importConfigurationFile(file)
    setNotice(t('config.imported'))
    if (onboarding) onConnected?.('restored')
  })
  const download = () => action(async () => {
    await downloadConfiguration()
    setNotice(t('config.downloaded'))
  })
  const chooseDirectory = () => {
    // Start the native picker synchronously while the click still grants user activation.
    const selection = pickDirectory()
    void action(async () => {
      const result = await connectDirectory(await selection)
      setNotice(t(result === 'restored' ? 'config.restored_ready' : 'config.created_ready'))
      if (onConnected) onConnected(result)
      else if (result === 'created') onConfigure()
    })
  }

  const restoreDirectory = () => {
    if (!directory) return
    // No IndexedDB read or async permission query before requesting user activation.
    void action(async () => {
      const permission = await requestDirectoryPermission(directory)
      if (permission !== 'granted') throw new DirectoryIssue('permission')
      await synchronizeConfiguration()
    })
  }

  const name = browserName(t('config.browser'))
  const syncEnabled = state.mode !== 'manual' && ['saved', 'restored', 'empty'].includes(state.status)
  const statusText = () => {
    if (state.status === 'restored') return t('config.restored')
    if (state.status === 'saved') return state.mode === 'directory'
      ? t('config.directory_saved') : t('config.browser_saved', { name })
    return t(`config.${state.status}`)
  }

  return (
    <section className="card section-card configuration-section">
      <div className="section-title">{t(onboarding ? 'config.start_title' : 'config.directory_title')}</div>
      <div className="section-desc">{t('config.description')}</div>
      {!onboarding ? <div className="config-status" role="status" aria-live="polite">
        <strong>{syncEnabled ? t('config.enabled') : statusText()}</strong>
        {syncEnabled ? <div className="muted">{statusText()}</div> : null}
        {state.lastSavedAt ? <div className="muted">{t('config.last_saved', { time: dateTimeKey(state.lastSavedAt) })}</div> : null}
        {state.lastRestoredAt ? <div className="muted">{t('config.last_restored', { time: dateTimeKey(state.lastRestoredAt) })}</div> : null}
        <div className="faint">{state.mode === 'auto' ? t('config.cloud_limit') : state.mode === 'directory' ? t('config.icloud_limit') : t('config.manual_hint')}</div>
      </div> : null}

      <div className="config-directory config-choice" data-active={state.mode === 'directory'}>
        <h3>{t('config.directory_location')}</h3>
        <p className="muted">{t('config.directory_hint')}</p>
        {state.mode === 'directory' && state.directoryName ? <p className="muted">{t('config.linked', { name: state.directoryName })}</p> : null}
        {state.mode === 'directory' && state.status === 'permission' && directory?.requestPermission ?
          <button className="btn btn-primary" disabled={busy} onClick={restoreDirectory}>{t('config.restore_directory')}</button> : null}
        {state.mode === 'directory' && state.status !== 'permission' ?
          <button className="btn btn-ghost" disabled={busy} onClick={() => void action(synchronizeConfiguration)}>{t('config.check_again')}</button> : null}
        {supportsDirectory() ? <button className="btn btn-primary" disabled={busy} onClick={chooseDirectory}>{t(state.mode === 'directory' ? 'config.change_directory' : 'config.choose_directory')}</button>
          : <p className="faint">{t('config.directory_unsupported')}</p>}
      </div>
      <details className="advanced" open={!supportsDirectory() ? true : undefined}>
        <summary>{t('config.other_methods')}</summary>
        <div className="advanced-body">
      <div className="config-choices">
        <div className="config-choice" data-active={state.mode === 'auto'}>
          <h3>{t('config.automatic')}</h3>
          <p className="muted">{t('config.automatic_hint')}</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void action(async () => {
            await selectConfigMode('auto')
            const current = await getConfigState()
            if (['saved', 'restored', 'empty'].includes(current.status)) {
              await updateConfigState({ setupComplete: true })
              if (onboarding) {
                if (current.status === 'empty') onConfigure()
                else onConnected?.('restored')
              }
            }
          })}>
            {state.mode === 'auto' ? t(syncEnabled ? 'config.enabled' : 'config.check_again') : t('config.use_automatic')}
          </button>
        </div>
        <div className="config-choice" data-active={state.mode === 'manual'}>
          <h3>{t('config.manual')}</h3>
          <p className="muted">{t('config.file_hint')}</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>{t('config.choose_file')}</button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void download()}>{t('config.download')}</button>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label={t('config.choose_file')}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
        </div>
        {!state.setupComplete && state.mode !== 'directory' ? <div className="config-choice">
          <h3>{t('config.fresh_title')}</h3>
          <p className="muted">{t('config.fresh_hint')}</p>
          <button className="btn btn-ghost" disabled={busy} onClick={() => void action(async () => {
            await selectConfigMode('manual')
            await updateConfigState({ setupComplete: true })
            onConfigure()
          })}>{t('config.fresh')}</button>
        </div> : null}
      </div>



      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {state.mode !== 'manual' ? <button className="btn btn-ghost" disabled={busy} onClick={() => void action(() => selectConfigMode('manual'))}>{t('config.local_only')}</button> : null}
      </div>
        </div>
      </details>
      {!onboarding ? <button className="btn btn-ghost" disabled={busy} onClick={onConfigure}>{t('config.edit_model')}</button> : null}
      <p className="faint">{t('config.credentials_hint')}</p>
      <p className="faint">{t('config.host_hint')}</p>
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  )
}
