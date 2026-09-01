import { useMemo, useState } from 'react'
import { Empty, LevelChip, SegmentedControl } from '@/components/index.tsx'
import { useEntries, useToast } from '@/components/hooks.ts'
import { removeEntry } from '@/storage/repositories/vocabularyRepo.ts'
import { buildSnapshot, downloadText, snapshotFilename, toCsv } from '@/services/exportService.ts'
import { isDue } from '@/flashcard/scheduler.ts'
import { useI18n } from '@/i18n/react.ts'
import { familiarityLabel, type FamiliarityLevel, type VocabularyEntry } from '@/types/vocabulary.ts'
import { formatDue, formatRelative, safeHostname, truncate } from '@/shared/utils.ts'
import { WordDetail } from './WordDetail.tsx'

type Filter = 'all' | 'due' | '0' | '1' | '2' | '3'
type SortKey = 'recent' | 'alpha' | 'due'

/**
 * The vocabulary book — the asset the whole product exists to build.
 *
 * Search matches the word, both meanings and the captured sentence, because
 * people remember "the one from that Postgres post" more often than the word.
 */
export function VocabularyPage() {
  const { t } = useI18n()
  const { entries, loading } = useEntries()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [selected, setSelected] = useState<string | null>(null)
  const [toast, showToast] = useToast()

  /*
   * 筛选项在渲染里构造，不再是模块级常量：模块顶层求值会把语言冻结在加载那一刻，
   * 用户之后换界面语言，这排按钮就还是旧的。
   */
  const filters: ReadonlyArray<{ value: Filter; label: string }> = [
    { value: 'all', label: t('vocabulary.filter.all') },
    { value: 'due', label: t('vocabulary.filter.due') },
    { value: '0', label: familiarityLabel(0) },
    { value: '1', label: familiarityLabel(1) },
    { value: '2', label: familiarityLabel(2) },
    { value: '3', label: familiarityLabel(3) },
  ]

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
    showToast(t('vocabulary.toast.deleted'))
  }

  const exportJson = async () => {
    const snapshot = await buildSnapshot()
    downloadText(snapshotFilename(), JSON.stringify(snapshot, null, 2))
    showToast(t('vocabulary.toast.exported_entries', { count: snapshot.counts.entries }))
  }

  const exportCsv = () => {
    downloadText(snapshotFilename().replace('.json', '.csv'), toCsv(visible), 'text/csv')
    showToast(t('vocabulary.toast.exported_csv', { count: visible.length }))
  }

  return (
    <div>
      <h1 className="page-title">{t('vocabulary.title')}</h1>
      <p className="page-sub">
        {loading
          ? t('vocabulary.loading')
          : t('vocabulary.count', { total: entries.length, shown: visible.length })}
      </p>

      <div className="toolbar">
        <input
          type="search"
          value={query}
          placeholder={t('vocabulary.search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SegmentedControl value={filter} options={filters} onChange={setFilter} />
        <div className="spacer" />
        <SegmentedControl
          value={sort}
          options={[
            { value: 'recent', label: t('vocabulary.sort.recent') },
            { value: 'alpha', label: 'A-Z' },
            { value: 'due', label: t('vocabulary.sort.due') },
          ]}
          onChange={setSort}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => void exportJson()}>
          {t('vocabulary.export.json')}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
          {t('vocabulary.export.csv')}
        </button>
      </div>

      {visible.length === 0 ? (
        <div className="card">
          <Empty
            emoji={entries.length === 0 ? '📚' : '🔍'}
            title={entries.length === 0 ? t('vocabulary.empty.title') : t('vocabulary.no_match.title')}
            hint={entries.length === 0 ? t('vocabulary.empty.hint') : t('vocabulary.no_match.hint')}
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
  const { t } = useI18n()
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
          {safeHostname(entry.source.url) || t('vocabulary.source.unknown')} · {formatRelative(entry.createdAt)}
        </div>
      </div>
      <div className="word-side">
        <LevelChip level={entry.review.level as FamiliarityLevel} />
        <span className="faint">{formatDue(entry.review.dueAt)}</span>
      </div>
    </div>
  )
}
