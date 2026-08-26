import { useState } from 'react'
import { LevelChip } from '@/components/index.tsx'
import { SpeakerIcon, TrashIcon } from '@/components/icons.tsx'
import { speak } from '@/services/speech.ts'
import { setFamiliarity, updateEntry } from '@/storage/repositories/vocabularyRepo.ts'
import { useI18n } from '@/i18n/react.ts'
import {
  cefrHint,
  familiarityLabel,
  type FamiliarityLevel,
  type VocabularyEntry,
} from '@/types/vocabulary.ts'
import { formatDue, formatRelative, safeHostname } from '@/shared/utils.ts'

/**
 * Detail drawer. Everything captured at save time is shown here — including the
 * original sentence and page — because "where did I meet this word" is the hook
 * that makes a word memorable, and it is exactly what a plain dictionary lacks.
 */
export function WordDetail({
  entry,
  onClose,
  onDelete,
}: {
  entry: VocabularyEntry
  onClose: () => void
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const [notes, setNotes] = useState(entry.notes)
  const [savingNotes, setSavingNotes] = useState(false)

  const saveNotes = async () => {
    setSavingNotes(true)
    await updateEntry(entry.id, { notes })
    setSavingNotes(false)
  }

  return (
    <div className="detail-panel" onClick={onClose} role="presentation">
      <div
        className="detail-body"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={t('vocabulary.detail.aria', { word: entry.word })}
      >
        <div className="row-between">
          <div>
            <div className="row" style={{ gap: 10 }}>
              <h2 style={{ fontSize: 24 }}>{entry.word}</h2>
              <button
                className="btn btn-ghost btn-sm"
                aria-label={t('vocabulary.detail.speak_word')}
                onClick={() => speak(entry.lemma || entry.word)}
              >
                <SpeakerIcon size={15} />
              </button>
            </div>
            <div className="row" style={{ gap: 8, marginTop: 4 }}>
              {entry.phonetic ? <span className="mono muted">{entry.phonetic}</span> : null}
              {entry.partOfSpeech ? <span className="chip">{entry.partOfSpeech}</span> : null}
              {entry.cefr ? (
                <span className="cefr" data-band={entry.cefr[0]} title={cefrHint(entry.cefr)}>
                  {entry.cefr} {cefrHint(entry.cefr)}
                </span>
              ) : null}
              <LevelChip level={entry.review.level} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            {t('vocabulary.detail.close')}
          </button>
        </div>

        {entry.meaning ? (
          <section className="detail-section">
            <div className="detail-label">{t('vocabulary.detail.meaning')}</div>
            <div>{entry.meaning}</div>
          </section>
        ) : null}

        {entry.aiExplanation ? (
          <section className="detail-section">
            <div className="detail-label">{t('vocabulary.detail.in_context')}</div>
            <div className="context-block">{entry.aiExplanation}</div>
          </section>
        ) : null}

        {entry.englishDefinition ? (
          <section className="detail-section">
            <div className="detail-label">{t('vocabulary.detail.english')}</div>
            <div className="muted">{entry.englishDefinition}</div>
          </section>
        ) : null}

        {entry.examples.length ? (
          <section className="detail-section">
            <div className="detail-label">{t('vocabulary.detail.examples')}</div>
            <ol className="example-list">
              {entry.examples.map((item) => (
                <li key={item.sentence}>
                  <div className="example-row">
                    <span style={{ fontStyle: 'italic' }}>{item.sentence}</span>
                    <button
                      className="label-speak"
                      aria-label={t('vocabulary.detail.speak_example')}
                      onClick={() => speak(item.sentence)}
                    >
                      <SpeakerIcon size={13} />
                    </button>
                  </div>
                  {item.translation ? <div className="faint">{item.translation}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {entry.synonyms.length ? (
          <section className="detail-section">
            <div className="detail-label">{t('vocabulary.detail.synonyms')}</div>
            <ul className="syn-list">
              {entry.synonyms.map((synonym) => (
                <li key={synonym.word}>
                  <span className="syn-word">{synonym.word}</span>
                  {synonym.meaning ? <span className="syn-meaning">{synonym.meaning}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="detail-section">
          <div className="detail-label">{t('vocabulary.detail.source')}</div>
          <div className="quote">{entry.source.context || t('vocabulary.detail.no_context')}</div>
          {entry.sentenceTranslation ? (
            <div className="faint" style={{ marginTop: 6 }}>{entry.sentenceTranslation}</div>
          ) : null}
          {entry.source.url ? (
            <div className="faint" style={{ marginTop: 6 }}>
              <a href={entry.source.url} target="_blank" rel="noreferrer">
                {entry.source.title || safeHostname(entry.source.url)}
              </a>
              {' · '}
              {formatRelative(entry.createdAt)}
            </div>
          ) : null}
        </section>

        <section className="detail-section">
          <div className="detail-label">{t('vocabulary.detail.familiarity')}</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {([0, 1, 2, 3] as FamiliarityLevel[]).map((level) => (
              <button
                key={level}
                className={level === entry.review.level ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                onClick={() => void setFamiliarity(entry.id, level)}
              >
                {familiarityLabel(level)}
              </button>
            ))}
          </div>
          <div className="faint" style={{ marginTop: 8 }}>
            {t('vocabulary.detail.review_stats', {
              count: entry.review.reviewCount,
              lapses: entry.review.lapses,
              due: formatDue(entry.review.dueAt),
            })}
          </div>
        </section>

        <section className="detail-section">
          <div className="detail-label">{t('vocabulary.detail.notes')}</div>
          <textarea
            rows={3}
            value={notes}
            placeholder={t('vocabulary.detail.notes_placeholder')}
            onChange={(event) => setNotes(event.target.value)}
          />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm" onClick={() => void saveNotes()} disabled={savingNotes || notes === entry.notes}>
              {savingNotes ? t('vocabulary.detail.notes_saving') : t('vocabulary.detail.notes_save')}
            </button>
          </div>
        </section>

        <section className="detail-section">
          <div className="row-between">
            <span className="faint">
              {t('vocabulary.detail.origin', {
                model: entry.origin.offline ? t('vocabulary.detail.origin_offline') : entry.origin.model,
              })}
            </span>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(entry.id)}>
              <TrashIcon size={14} />
              {t('vocabulary.detail.delete')}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
