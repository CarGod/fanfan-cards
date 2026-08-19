import { useEffect, useMemo, useState } from 'react'
import { AI_ERROR_MESSAGES, type AIErrorCode, type WordExplanation } from '@/types/ai.ts'
import { CEFR_HINTS, type VocabularyEntry } from '@/types/vocabulary.ts'
import { speak } from '@/services/speech.ts'
import { BookmarkIcon, CheckIcon, CloseIcon, SpeakerIcon } from '@/components/icons.tsx'
import { truncate } from '@/shared/utils.ts'

export interface ExplainMeta {
  providerId: string
  model: string
  offline: boolean
  cached: boolean
  downgradeReason?: string | undefined
}

interface Props {
  selection: string
  sentence: string
  explanation: WordExplanation
  meta: ExplainMeta
  savedEntry: VocabularyEntry | null
  saving: boolean
  /** Example / sentence translation / synonyms are still being fetched. */
  enriching: boolean
  showEnglishDefinition: boolean
  autoSpeak: boolean
  onSave: () => void
  onRemove: () => void
  onOpenBook: () => void
  onClose: () => void
}

export function WordCard({
  selection,
  sentence,
  explanation,
  meta,
  savedEntry,
  saving,
  enriching,
  showEnglishDefinition,
  autoSpeak,
  onSave,
  onRemove,
  onOpenBook,
  onClose,
}: Props) {
  const [spoken, setSpoken] = useState(false)
  // Hovering the "saved" button reveals the undo, the way a Follow button
  // becomes Unfollow — one control, no second button competing for attention.
  const [armedToRemove, setArmedToRemove] = useState(false)

  useEffect(() => {
    if (autoSpeak && !spoken && explanation.word) {
      speak(explanation.lemma || explanation.word)
      setSpoken(true)
    }
  }, [autoSpeak, spoken, explanation.word, explanation.lemma])

  const highlighted = useMemo(() => highlight(sentence, selection), [sentence, selection])

  /*
   * A sentence gets a shorter card.
   *
   * Examples, synonyms and a lemma answer "how else is this used", which is a
   * question about a word or a phrase. For a whole sentence they are filler —
   * and the header's 原形 line was printing the entire sentence back at you.
   */
  const isSentence = explanation.kind === 'sentence'

  return (
    <div className="card" role="dialog" aria-label={`${explanation.word} 的解释`}>
      <header className="card-head">
        <div className="headline">
          <div className="word-row">
            <span className="word">{explanation.word}</span>
            {explanation.cefr && !isSentence ? (
              <span
                className="cefr"
                data-band={explanation.cefr[0]}
                title={`CEFR ${explanation.cefr} · ${CEFR_HINTS[explanation.cefr]}`}
              >
                {explanation.cefr}
              </span>
            ) : null}
          </div>
          <div className="meta-row">
            {explanation.phonetic && !isSentence ? (
              <span className="phonetic">{explanation.phonetic}</span>
            ) : null}
            {explanation.partOfSpeech ? (
              <span className="pos">{explanation.partOfSpeech}</span>
            ) : null}
            {!isSentence &&
            explanation.lemma &&
            explanation.lemma !== explanation.word.toLowerCase() ? (
              <span className="pos">原形 {explanation.lemma}</span>
            ) : null}
          </div>
        </div>
        <button
          className="icon-btn"
          title="朗读"
          aria-label="朗读这个词"
          onClick={() => speak(explanation.lemma || explanation.word)}
        >
          <SpeakerIcon size={17} />
        </button>
        <button className="icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="card-body">
        {meta.downgradeReason ? <div className="notice">{meta.downgradeReason}</div> : null}

        {explanation.meaning ? (
          <section className="section">
            <div className="label">基础释义</div>
            <div className="body-text">{explanation.meaning}</div>
          </section>
        ) : null}

        {showEnglishDefinition && explanation.englishDefinition ? (
          <section className="section">
            <div className="label">English</div>
            <div className="muted">{explanation.englishDefinition}</div>
          </section>
        ) : null}

        {explanation.contextMeaning ? (
          <section className="section">
            <div className="label">语境含义 · 本页</div>
            <div className="context-block body-text">{explanation.contextMeaning}</div>
          </section>
        ) : null}

        {sentence ? (
          <section className="section">
            <div className="label">
              原文与翻译
              <SpeakButton text={sentence} title="朗读原句" />
            </div>
            <div className="source-quote">{highlighted}</div>
            {explanation.sentenceTranslation ? (
              <div className="sentence-translation">{explanation.sentenceTranslation}</div>
            ) : null}
          </section>
        ) : null}

        {enriching && !isSentence && explanation.examples.length === 0 ? (
          <section className="section">
            <div className="label">例句 · 近义词</div>
            <div className="thinking">
              <span className="dot" />
              正在补充
            </div>
            <div className="skeleton-line" style={{ width: '88%' }} />
            <div className="skeleton-line" style={{ width: '64%' }} />
          </section>
        ) : null}

        {!isSentence && explanation.examples.length > 0 ? (
          <section className="section">
            <div className="label">例句</div>
            <ol className="example-list">
              {explanation.examples.map((item) => (
                <li key={item.sentence}>
                  <div className="example-row">
                    <span className="example">{item.sentence}</span>
                    <SpeakButton text={item.sentence} title="朗读这句例句" />
                  </div>
                  {item.translation ? <div className="example-zh">{item.translation}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!isSentence && explanation.synonyms.length > 0 ? (
          <section className="section">
            <div className="label">近义词</div>
            <ul className="syn-list">
              {explanation.synonyms.map((synonym) => (
                <li key={synonym.word}>
                  <span className="syn-word">{synonym.word}</span>
                  {synonym.meaning ? <span className="syn-meaning">{synonym.meaning}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <footer className="card-foot">
        {savedEntry ? (
          <>
            <button
              className={armedToRemove ? 'btn btn-remove' : 'btn btn-saved'}
              onMouseEnter={() => setArmedToRemove(true)}
              onMouseLeave={() => setArmedToRemove(false)}
              onFocus={() => setArmedToRemove(true)}
              onBlur={() => setArmedToRemove(false)}
              onClick={onRemove}
              title={armedToRemove ? '从词卡中移除' : '已收藏'}
            >
              {armedToRemove ? <CloseIcon size={15} /> : <CheckIcon size={15} />}
              {armedToRemove ? '移出词卡' : '已在词卡'}
            </button>
            <button className="btn btn-ghost" onClick={onOpenBook}>
              去复习
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onSave} disabled={saving}>
            {saving ? (
              '收藏中…'
            ) : (
              <>
                <BookmarkIcon size={15} />
                收进词卡
              </>
            )}
          </button>
        )}
        {/* The model name is noise to a reader mid-sentence. "Offline" stays:
            it changes how much the explanation can be trusted. */}
        {meta.offline ? <span className="provider-tag">离线词典</span> : null}
      </footer>
    </div>
  )
}

/**
 * A sentence is worth hearing, not just reading — intonation and liaison are
 * most of what makes spoken English hard, and neither survives a word list.
 */
function SpeakButton({ text, title }: { text: string; title: string }) {
  return (
    <button className="label-speak" title={title} aria-label={title} onClick={() => speak(text)}>
      <SpeakerIcon size={13} />
    </button>
  )
}

/** Marks the selected text inside the source sentence so the eye lands on it. */
function highlight(sentence: string, selection: string) {
  const text = truncate(sentence, 400)
  const index = selection ? text.toLowerCase().indexOf(selection.toLowerCase()) : -1
  if (index === -1) return text
  return (
    <>
      {text.slice(0, index)}
      <mark>{text.slice(index, index + selection.length)}</mark>
      {text.slice(index + selection.length)}
    </>
  )
}

export function CardSkeleton({ word, onClose }: { word: string; onClose: () => void }) {
  return (
    <div className="card" role="status" aria-live="polite">
      <header className="card-head">
        <div className="headline">
          <div className="word">{word}</div>
          <div className="meta-row">
            <span className="muted">AI 正在结合上下文分析…</span>
          </div>
        </div>
        <button className="icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="card-body">
        <div className="thinking">
          <span className="dot" />
          正在阅读这句话的语境
        </div>
        <div className="skeleton-line" style={{ width: '55%' }} />
        <div className="skeleton-line" style={{ width: '92%' }} />
        <div className="skeleton-line" style={{ width: '78%' }} />
        <div className="skeleton-line" style={{ width: '86%' }} />
      </div>
    </div>
  )
}

export function CardError({
  word,
  code,
  message,
  onRetry,
  onOffline,
  onOpenSettings,
  onClose,
}: {
  word: string
  code: AIErrorCode
  message: string
  onRetry: () => void
  onOffline: () => void
  onOpenSettings: () => void
  onClose: () => void
}) {
  return (
    <div className="card" role="alert">
      <header className="card-head">
        <div className="headline">
          <div className="word">{word}</div>
          <div className="meta-row">
            <span className="muted">查询失败</span>
          </div>
        </div>
        <button className="icon-btn" title="关闭 (Esc)" aria-label="关闭" onClick={onClose}>
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="card-body">
        <div className="error-box">
          <div>{AI_ERROR_MESSAGES[code]}</div>
          {message ? <div className="muted">{truncate(message, 220)}</div> : null}
        </div>
      </div>
      <footer className="card-foot">
        {code === 'stale_context' ? (
          <button className="btn btn-primary" onClick={() => location.reload()}>
            刷新页面
          </button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={onRetry}>
              重试
            </button>
            <button className="btn btn-ghost" onClick={onOffline}>
              用离线词典
            </button>
          </>
        )}
        {code === 'auth' || code === 'no_api_key' ? (
          <button className="btn btn-ghost" onClick={onOpenSettings}>
            去设置
          </button>
        ) : null}
      </footer>
    </div>
  )
}
