import { useEffect, useState } from 'react'
import { Field, Toggle } from '@/components/index.tsx'
import { useSettings } from '@/components/hooks.ts'
import { readSyncState, watchSyncState } from '@/storage/repositories/syncStateRepo.ts'
import { connectGitHub, sanitizeRepoName, type SyncMode } from '@/sync/syncService.ts'
import { sendMessage } from '@/services/messaging.ts'
import { EMPTY_SYNC_STATE, SYNC_ERROR_MESSAGES, SyncError, type SyncState } from '@/types/sync.ts'
import { formatRelative, truncate } from '@/shared/utils.ts'

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
      return `${SYNC_ERROR_MESSAGES[thrown.code]}（${truncate(thrown.message, 140)}）`
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
          ? `已创建私有仓库 ${result.repo}`
          : result.adopted
            ? `发现已有的知识库 ${result.owner}/${result.repo}，已自动关联`
            : `已连接 ${result.owner}/${result.repo}`,
      )
      // A freshly created repo is empty; push straight away so the user sees
      // their words on GitHub instead of an empty repo.
      await sendMessage('sync/run', {})
      onToast('首次同步完成')
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
        ? '用远端覆盖本地：本机上远端没有的词卡会被删除，且不会再同步回去。确定吗？'
        : '用本地覆盖远端：仓库里这台设备没有的词卡会被覆盖。确定吗？'
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
          ? `已用远端内容覆盖本地，本地现有 ${result.pulled} 条变动`
          : mode === 'forcePush'
            ? `已用本地内容覆盖远端，提交了 ${result.filesChanged} 个文件`
            : result.changed
              ? `已同步 ${result.pushed} 个词条${result.pulled ? `，并合并了远端 ${result.pulled} 条` : ''}`
              : '远端已是最新，无需提交',
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
      <div className="section-title">同步到 GitHub 私有仓库</div>
      <div className="section-desc">
        把词卡变成你自己的 Git 仓库：每次同步都是一次提交，commit 历史就是你的学习记录。
        数据只在你的浏览器和 GitHub 之间流动，没有任何中间服务器。
      </div>

      <Field
        label="GitHub Personal Access Token"
        hint="Token 只保存在本机，只在扩展后台使用，不会发给除 GitHub 之外的任何一方。"
      >
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
          点这里生成（已预选 repo 权限与「永不过期」）→
        </a>
        <br />
        选「永不过期」是有意的：会过期的 Token 会让几个月后的后台自动同步<strong>静默失败</strong>。
        <br />
        想要最小权限？先在 GitHub 手动建好私有仓库，再用 fine-grained token
        只授予该仓库的 Contents 读写——本扩展检测到仓库已存在就不会请求创建权限。
      </div>

      <Field
        label="仓库名"
        hint="不存在就自动创建为私有仓库。换设备时会先在你的账号里找已有的知识库（认仓库描述里的标记，改过名也能认出来），找到就直接关联，不会重复创建。"
      >
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
          {busy === 'connecting' ? '连接中…' : connected ? '重新连接' : '连接并创建仓库'}
        </button>
        <button
          className="btn"
          onClick={() => void syncNow()}
          disabled={busy !== 'idle' || !connected}
        >
          {busy === 'syncing' ? '同步中…' : '立即同步'}
        </button>
        {state.repoUrl ? (
          <a className="btn btn-ghost" href={state.repoUrl} target="_blank" rel="noreferrer">
            打开仓库 ↗
          </a>
        ) : null}
      </div>

      {connected ? (
        <>
          <div className="row-between" style={{ marginTop: 18 }}>
            <div>
              <div style={{ fontWeight: 600 }}>自动同步</div>
              <div className="faint">
                收藏或删除单词后约 30 秒自动提交一次；此外按下面的间隔兜底轮询
              </div>
            </div>
            <Toggle
              checked={config.autoSync}
              onChange={(next) => patch({ autoSync: next })}
              label="自动同步"
            />
          </div>

          {config.autoSync ? (
            <Field label="同步间隔（分钟）">
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
              上次同步失败（{formatRelative(state.lastAttemptAt)}）：
              {truncate(state.error, 160)}
              {/*
                A conflict is the one failure the user can actually resolve, and
                the only one where the product must not choose for them: both
                ways out delete something. So the buttons appear only for this
                error code, and each says what it costs.
              */}
              {state.errorCode === 'stale_head' || state.errorCode === 'conflict' ? (
                <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                  <div>
                    两台设备各自改过词卡，自动合并没能对上。先试一次重新合并——它不会删任何东西。
                    仍然失败，再选一边覆盖，<strong>被覆盖的那一边会丢掉对方没有的词卡</strong>。
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy !== 'idle'}
                      onClick={() => void syncNow()}
                    >
                      重新合并（安全）
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== 'idle'}
                      title="丢弃本机上远端没有的词卡，改用仓库里的内容"
                      onClick={() => void confirmForce('forcePull')}
                    >
                      用远端覆盖本地
                    </button>
                    <button
                      className="btn btn-sm"
                      disabled={busy !== 'idle'}
                      title="用本机内容整体提交，覆盖仓库里这台设备没有的改动"
                      onClick={() => void confirmForce('forcePush')}
                    >
                      用本地覆盖远端
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              上次同步 {formatRelative(state.lastSuccessAt)} · {state.repoFullName} ·{' '}
              {state.entriesPushed} 个词条
            </>
          )}
        </div>
      ) : null}
    </section>
  )
}
