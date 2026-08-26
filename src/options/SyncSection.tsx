import { useEffect, useState } from 'react'
import { Field, Toggle } from '@/components/index.tsx'
import { useSettings } from '@/components/hooks.ts'
import { readSyncState, watchSyncState } from '@/storage/repositories/syncStateRepo.ts'
import { connectGitHub, sanitizeRepoName, type SyncMode } from '@/sync/syncService.ts'
import { sendMessage } from '@/services/messaging.ts'
import { EMPTY_SYNC_STATE, syncErrorMessage, SyncError, type SyncState } from '@/types/sync.ts'
import { formatRelative, truncate } from '@/shared/utils.ts'
import { useI18n } from '@/i18n/react.ts'

type Busy = 'idle' | 'connecting' | 'syncing'

/**
 * Pre-fills scope, note and expiry on GitHub's token page.
 *
 * `default_expires_at=none` is deliberate. GitHub warns against non-expiring
 * tokens, and that warning is right for tokens that travel; this one never
 * leaves the machine it was pasted into. The alternative is worse for this
 * product: an expiring token makes background sync fail silently months later,
 * and the user finds out when they need the data.
 */
const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=AI%20Reader%20Assistant&default_expires_at=none'

/**
 * GitHub sync settings.
 *
 * Deliberately a Personal Access Token rather than OAuth: the device flow needs
 * a registered OAuth App whose client id would ship inside the extension, and
 * GitHub's token endpoints are not reliably CORS-enabled from a browser. A PAT
 * keeps the whole thing between the user's browser and api.github.com.
 */
export function SyncSection({ onToast }: { onToast: (message: string) => void }) {
  const { t } = useI18n()
  const { settings, update } = useSettings()
  const [state, setState] = useState<SyncState>(EMPTY_SYNC_STATE)
  const [busy, setBusy] = useState<Busy>('idle')
  const [error, setError] = useState('')

  const config = settings.sync

  useEffect(() => {
    void readSyncState().then(setState)
    return watchSyncState(setState)
  }, [])

  const patch = (next: Partial<typeof config>) => void update({ sync: { ...config, ...next } })

  const describe = (thrown: unknown): string => {
    if (thrown instanceof SyncError) {
      return t('options.sync.error.detail', {
        message: syncErrorMessage(thrown.code),
        detail: truncate(thrown.message, 140),
      })
    }
    return thrown instanceof Error ? thrown.message : String(thrown)
  }

  const connect = async () => {
    setBusy('connecting')
    setError('')
    try {
      const result = await connectGitHub()
      onToast(
        result.created
          ? t('options.sync.toast.created', { repo: result.repo })
          : result.adopted
            ? t('options.sync.toast.adopted', { repo: `${result.owner}/${result.repo}` })
            : t('options.sync.toast.connected', { repo: `${result.owner}/${result.repo}` }),
      )
      // A freshly created repo is empty; push straight away so the user sees
      // their words on GitHub instead of an empty repo.
      await sendMessage('sync/run', {})
      onToast(t('options.sync.toast.first_sync'))
    } catch (thrown) {
      setError(describe(thrown))
    } finally {
      setBusy('idle')
    }
  }

  /*
   * Ask the worker; never sync from this page.
   *
   * Running it here put a second pull-merge-push in a different JavaScript
   * context from the worker's, where the mutex guarding it does not exist — so
   * clicking this while the background alarm was running made the two race, and
   * the loser reported 「远端已前进」 about a commit this very device had just
   * made. The worker is also the context that survives this page being closed.
   */
  /*
   * A second click, deliberately.
   *
   * Both overrides delete words. `window.confirm` is not elegant, but it is the
   * one dialog a user cannot dismiss by accident, and this is the only place in
   * the product where a mis-click costs data that is not recoverable from the
   * other side.
   */
  const confirmForce = async (mode: SyncMode) => {
    const message =
      mode === 'forcePull'
        ? t('options.sync.confirm.force_pull')
        : t('options.sync.confirm.force_push')
    if (!window.confirm(message)) return
    await syncNow(mode)
  }

  const syncNow = async (mode: SyncMode = 'merge') => {
    setBusy('syncing')
    setError('')
    try {
      const result = await sendMessage('sync/run', mode === 'merge' ? {} : { mode })
      onToast(
        mode === 'forcePull'
          ? t('options.sync.toast.force_pulled', { count: result.pulled })
          : mode === 'forcePush'
            ? t('options.sync.toast.force_pushed', { count: result.filesChanged })
            : result.changed
              ? result.pulled
                ? t('options.sync.toast.pushed_and_merged', {
                    count: result.pushed,
                    pulled: result.pulled,
                  })
                : t('options.sync.toast.pushed', { count: result.pushed })
              : t('options.sync.toast.up_to_date'),
      )
    } catch (thrown) {
      setError(describe(thrown))
    } finally {
      setBusy('idle')
    }
  }

  const connected = config.enabled && config.owner !== '' && config.token !== ''

  return (
    <section className="card section-card">
      <div className="section-title">{t('options.sync.title')}</div>
      <div className="section-desc">{t('options.sync.desc')}</div>

      <Field label={t('options.sync.token.label')} hint={t('options.sync.token.hint')}>
        <input
          type="password"
          value={config.token}
          placeholder="ghp_..."
          autoComplete="off"
          onChange={(event) => patch({ token: event.target.value })}
        />
      </Field>
      <div className="faint" style={{ marginTop: -8, marginBottom: 16, lineHeight: 1.7 }}>
        <a href={TOKEN_URL} target="_blank" rel="noreferrer">
          {t('options.sync.token.generate')}
        </a>
        <br />
        {t('options.sync.expiry.note_lead')}
        <strong>{t('options.sync.expiry.note_em')}</strong>
        <br />
        {t('options.sync.token.fine_grained')}
      </div>

      <Field label={t('options.sync.repo.label')} hint={t('options.sync.repo.hint')}>
        <input
          type="text"
          value={config.repo}
          placeholder="ai-reader-vocabulary"
          onChange={(event) => patch({ repo: event.target.value })}
          onBlur={(event) => patch({ repo: sanitizeRepoName(event.target.value) })}
        />
      </Field>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => void connect()}
          disabled={busy !== 'idle' || !config.token.trim()}
        >
          {busy === 'connecting'
            ? t('options.sync.action.connecting')
            : connected
              ? t('options.sync.action.reconnect')
              : t('options.sync.action.connect')}
        </button>
        <button
          className="btn"
          onClick={() => void syncNow()}
          disabled={busy !== 'idle' || !connected}
        >
          {busy === 'syncing' ? t('options.sync.action.syncing') : t('options.sync.action.sync_now')}
        </button>
        {state.repoUrl ? (
          <a className="btn btn-ghost" href={state.repoUrl} target="_blank" rel="noreferrer">
            {t('options.sync.action.open_repo')}
          </a>
        ) : null}
      </div>

      {connected ? (
        <>
          <div className="row-between" style={{ marginTop: 18 }}>
            <div>
              <div style={{ fontWeight: 600 }}>{t('options.sync.auto.title')}</div>
              <div className="faint">{t('options.sync.auto.desc')}</div>
            </div>
            <Toggle
              checked={config.autoSync}
              onChange={(next) => patch({ autoSync: next })}
              label={t('options.sync.auto.title')}
            />
          </div>

          {config.autoSync ? (
            <Field label={t('options.sync.interval.label')}>
              <input
                type="number"
                min={5}
                max={1440}
                value={config.intervalMinutes}
                onChange={(event) =>
                  patch({ intervalMinutes: Number(event.target.value) || 30 })
                }
              />
            </Field>
          ) : null}
        </>
      ) : null}

      {error ? (
        <div className="banner banner-danger" style={{ marginTop: 16, marginBottom: 0 }}>
          {error}
        </div>
      ) : null}

      {!error && state.outcome !== 'never' ? (
        <div
          className={state.outcome === 'failed' ? 'banner banner-danger' : 'banner banner-success'}
          style={{ marginTop: 16, marginBottom: 0 }}
        >
          {state.outcome === 'failed' ? (
            <>
              {t('options.sync.status.failed', {
                when: formatRelative(state.lastAttemptAt),
                reason: truncate(state.error, 160),
              })}
              {/*
                A conflict is the one failure the user can actually resolve, and
                the only one where the product must not choose for them: both
                ways out delete something. So the buttons appear only for this
                error code, and each says what it costs.
              */}
              {state.errorCode === 'stale_head' || state.errorCode === 'conflict' ? (
                <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                  <div>
                    {t('options.sync.conflict.explain_lead')}
                    <strong>{t('options.sync.conflict.explain_em')}</strong>
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy !== 'idle'}
                      onClick={() => void syncNow()}
                    >
                      {t('options.sync.conflict.retry')}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== 'idle'}
                      title={t('options.sync.conflict.force_pull_title')}
                      onClick={() => void confirmForce('forcePull')}
                    >
                      {t('options.sync.conflict.force_pull')}
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== 'idle'}
                      title={t('options.sync.conflict.force_push_title')}
                      onClick={() => void confirmForce('forcePush')}
                    >
                      {t('options.sync.conflict.force_push')}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            t('options.sync.status.ok', {
              when: formatRelative(state.lastSuccessAt),
              repo: state.repoFullName,
              count: state.entriesPushed,
            })
          )}
        </div>
      ) : null}
    </section>
  )
}
