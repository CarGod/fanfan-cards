import { useMemo, useState } from 'react'
import { Empty, LevelChip, SegmentedControl } from '@/components/index.tsx'
import { useEntries, useToast } from '@/components/hooks.ts'
import { removeEntry } from '@/storage/repositories/vocabularyRepo.ts'
import { buildSnapshot, downloadText, snapshotFilename, toCsv } from '@/services/exportService.ts'
import { isDue } from '@/flashcard/scheduler.ts'
import { FAMILIARITY_LABELS, type FamiliarityLevel, type VocabularyEntry } from '@/types/vocabulary.ts'
import { formatDue, formatRelative, safeHostname, truncate } from '@/shared/utils.ts'
import { WordDetail } from './WordDetail.tsx'

type Filter = 'all' | 'due' | '0' | '1' | '2' | '3'
type SortKey = 'recent' | 'alpha' | 'due'

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'due', label: '待复习' },
  { value: '0', label: FAMILIARITY_LABELS[0] },
  { value: '1', label: FAMILIARITY_LABELS[1] },
  { value: '2', label: FAMILIARITY_LABELS[2] },
  { value: '3', label: FAMILIARITY_LABELS[3] },
]

/**
 * The vocabulary book — the asset the whole product exists to build.
 *
 * Search matches the word, both meanings and the captured sentence, because
 * people remember "the one from that Postgres post" more often than the word.
 */
export function VocabularyPage() {
  const { entries, loading } = useEntries()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [selected, setSelected] = useState<string | null>(null)
  const [toast, showToast] = useToast()

  const visible = useMemo(() => {
    const now = Date.now()
    const needle = query.trim().toLowerCase()

    const filtered = entries.filter((entry) => {
      if (filter === 'due' && !isDue(entry, now)) return false
      if (filter !== 'all' && filter !== 'due' && String(entry.review.level) !== filter) return false
      if (!needle) return true
      return (
        entry.normalized.includes(needle) ||
        entry.meaning.toLowerCase().includes(needle) ||
        entry.aiExplanation.toLowerCase().includes(needle) ||
        entry.source.context.toLowerCase().includes(needle)
      )
    })

    const sorted = [...filtered]
    if (sort === 'alpha') sorted.sort((a, b) => a.normalized.localeCompare(b.normalized))
    if (sort === 'due') sorted.sort((a, b) => a.review.dueAt - b.review.dueAt)
    return sorted
  }, [entries, query, filter, sort])

  const active = entries.find((entry) => entry.id === selected) ?? null

  const remove = async (id: string) => {
    await removeEntry(id)
    setSelected(null)
    showToast('已删除')
  }

  const exportJson = async () => {
    const snapshot = await buildSnapshot()
    downloadText(snapshotFilename(), JSON.stringify(snapshot, null, 2))
    showToast(`已导出 ${snapshot.counts.entries} 个词条`)
  }

  const exportCsv = () => {
    downloadText(snapshotFilename().replace('.json', '.csv'), toCsv(visible), 'text/csv')
    showToast(`已导出 ${visible.length} 行 CSV`)
  }

  return (
    <div>
      <h1 className="page-title">我的词卡</h1>
      <p className="page-sub">
        {loading ? '加载中…' : `共 ${entries.length} 个词条，当前显示 ${visible.length} 个`}
      </p>

      <div className="toolbar">
        <input
          type="search"
          value={query}
          placeholder="搜索单词、释义或原句…"
          onChange={(event) => setQuery(event.target.value)}
        />
        <SegmentedControl value={filter} options={FILTERS} onChange={setFilter} />
        <div className="spacer" />
        <SegmentedControl
          value={sort}
          options={[
            { value: 'recent', label: '最新' },
            { value: 'alpha', label: 'A-Z' },
            { value: 'due', label: '复习顺序' },
          ]}
          onChange={setSort}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => void exportJson()}>
          导出 JSON
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
          导出 CSV
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <Empty
            emoji={entries.length === 0 ? '📚' : '🔍'}
            title={entries.length === 0 ? '词卡还是空的' : '没有匹配的词条'}
            hint={
              entries.length === 0
                ? '在任意英文网页上划词 → 点击「解释」→ 收藏，词条就会出现在这里。'
                : '换一个关键词或筛选条件试试。'
            }
          />
        </div>
      ) : (
        <div className="word-list">
          {visible.map((entry) => (
            <WordRow key={entry.id} entry={entry} onOpen={() => setSelected(entry.id)} />
          ))}
        </div>
      )}

      {active ? (
        <WordDetail entry={active} onClose={() => setSelected(null)} onDelete={(id) => void remove(id)} />
      ) : null}
      {toast ? <div className="toast-fixed">{toast}</div> : null}
    </div>
  )
}

function WordRow({ entry, onOpen }: { entry: VocabularyEntry; onOpen: () => void }) {
  return (
    <div className="card word-row" onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="word-main">
        <div className="word-title">
          <span className="word-term">{entry.word}</span>
          {entry.cefr ? (
            <span className="cefr" data-band={entry.cefr[0]}>
              {entry.cefr}
            </span>
          ) : null}
          {entry.phonetic ? <span className="mono faint">{entry.phonetic}</span> : null}
          {entry.partOfSpeech ? <span className="chip">{entry.partOfSpeech}</span> : null}
        </div>
        <div className="word-meaning">
          {entry.meaning}
          {entry.aiExplanation ? ` — ${truncate(entry.aiExplanation.split('\n')[0] ?? '', 80)}` : ''}
        </div>
        <div className="faint" style={{ marginTop: 4 }}>
          {safeHostname(entry.source.url) || '未知来源'} · {formatRelative(entry.createdAt)}
        </div>
      </div>
      <div className="word-side">
        <LevelChip level={entry.review.level as FamiliarityLevel} />
        <span className="faint">{formatDue(entry.review.dueAt)}</span>
      </div>
    </div>
  )
}
