import { useEffect, useMemo, useState } from 'react'
import { aiErrorMessage, type AIErrorCode, type WordExplanation } from '@/types/ai.ts'
import { cefrHint, partOfSpeechLabel, type VocabularyEntry } from '@/types/vocabulary.ts'
import { speak } from '@/services/speech.ts'
import { BookmarkIcon, CloseIcon, SpeakerIcon } from '@/components/icons.tsx'
import { useI18n } from '@/i18n/react.ts'
import { SenseList } from '@/components/index.tsx'
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
  onClose,
}: Props) {
  const { t } = useI18n()
  const [spoken, setSpoken] = useState(false)
  // Hovering the "saved" button reveals the undo, the way a Follow button
  // becomes Unfollow — one control, no second button competing for attention.

  useEffect(() => {
    if (autoSpeak && !spoken && explanation.word) {
      speak(explanation.lemma || explanation.word)
      setSpoken(true)
    }
  }, [autoSpeak, spoken, explanation.word, explanation.lemma])

  const highlighted = useMemo(() => highlightInSentence(sentence, selection), [sentence, selection])

  /*
   * A sentence gets a shorter card.
   *
   * Examples, synonyms and a lemma answer "how else is this used", which is a
   * question about a word or a phrase. For a whole sentence they are filler —
   * and the header's 原形 line was printing the entire sentence back at you.
   */
  const isSentence = explanation.kind === 'sentence'

  return (
    <div className="card" role="dialog" aria-label={t('card.aria.dialog', { word: explanation.word })}>
      <header className="card-head">
        <div className="headline">
          <div className="word-row">
            <span className="word">{explanation.word}</span>
            {explanation.cefr && !isSentence ? (
              <span
                className="cefr"
                data-band={explanation.cefr[0]}
                title={`CEFR ${explanation.cefr} · ${cefrHint(explanation.cefr)}`}
              >
                {explanation.cefr}
              </span>
            ) : null}
          </div>
          <div className="meta-row">
            {explanation.phonetic && !isSentence ? (
              <span className="phonetic">{explanation.phonetic}</span>
            ) : null}
            {/* 词性走界面语言：头上写 verb、正文写「动词」，是同一个字段的两种说法。 */}
            {explanation.partOfSpeech ? (
              <span className="pos">{partOfSpeechLabel(explanation.partOfSpeech)}</span>
            ) : null}
            {!isSentence &&
            explanation.lemma &&
            explanation.lemma !== explanation.word.toLowerCase() ? (
              <span className="pos">{t('card.meta.lemma', { lemma: explanation.lemma })}</span>
            ) : null}
            {/*
              「离线」跟着词性走，不再待在卡片底部。
              模型名字对读在半句话中间的人是噪音，但「这条解释来自离线词典」不是——
              它决定了这句话能信到什么程度，所以要和词性、音标待在一起。
            */}
            {meta.offline ? <span className="provider-tag">{t('card.tag.offline')}</span> : null}
          </div>
        </div>
        {/*
          收藏做成图标，放在朗读左边。
          它原本是卡片底部一整行的主按钮——那一行的高度，加上「去复习」，
          正是这张卡在长一点的词上开始出现滚动条的原因。收藏是**一次性**的动作，
          不值得常驻一整行；而放在右上角，它和朗读、关闭一样，都是「对这张卡做点什么」。
        */}
        <button
          className="icon-btn"
          data-saved={!!savedEntry}
          disabled={saving}
          title={savedEntry ? t('card.action.unsave_title') : t('card.action.save_title')}
          aria-label={savedEntry ? t('card.action.unsave_title') : t('card.action.save_title')}
          aria-pressed={!!savedEntry}
          onClick={savedEntry ? onRemove : onSave}
        >
          <BookmarkIcon size={16} filled={!!savedEntry} />
        </button>
        <button
          className="icon-btn"
          title={t('card.action.speak')}
          aria-label={t('card.action.speak_word')}
          onClick={() => speak(explanation.lemma || explanation.word)}
        >
          <SpeakerIcon size={17} />
        </button>
        <button
          className="icon-btn"
          title={t('card.action.close_title')}
          aria-label={t('card.action.close')}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="card-body">
        {meta.downgradeReason ? <div className="notice">{meta.downgradeReason}</div> : null}

        {/*
          有 senses 就显示，哪怕 meaning 是空的。
          原来这里只看 meaning——生产里它是从 senses 推导出来的所以碰巧非空，
          但那是个脆耦合：任何一条「有结构化释义、没有那行汇总文本」的数据
          都会让整节凭空消失，而消失的东西没人会去找。
        */}
        {explanation.meaning || explanation.senses?.length ? (
          <section className="section">
            <div className="label">{t('card.section.meaning')}</div>
            <SenseList senses={explanation.senses ?? []} meaning={explanation.meaning} />
          </section>
        ) : null}

        {showEnglishDefinition && explanation.englishDefinition ? (
          <section className="section">
            <div className="label">{t('card.section.english')}</div>
            <div className="muted">{explanation.englishDefinition}</div>
          </section>
        ) : null}

        {explanation.contextMeaning ? (
          <section className="section">
            <div className="label">{t('card.section.context')}</div>
            <div className="context-block body-text">{explanation.contextMeaning}</div>
          </section>
        ) : null}

        {sentence ? (
          <section className="section">
            <div className="label">
              {t('card.section.source')}
              <SpeakButton text={sentence} title={t('card.action.speak_sentence')} />
            </div>
            <div className="source-quote">{highlighted}</div>
            {explanation.sentenceTranslation ? (
              <div className="sentence-translation">{explanation.sentenceTranslation}</div>
            ) : null}
          </section>
        ) : null}

        {enriching && !isSentence && explanation.examples.length === 0 ? (
          <section className="section">
            <div className="label">{t('card.section.extras')}</div>
            <div className="thinking">
              <span className="dot" />
              {t('card.state.enriching')}
            </div>
            <div className="skeleton-line" style={{ width: '88%' }} />
            <div className="skeleton-line" style={{ width: '64%' }} />
          </section>
        ) : null}

        {!isSentence && explanation.examples.length > 0 ? (
          <section className="section">
            <div className="label">{t('card.section.examples')}</div>
            <ol className="example-list">
              {explanation.examples.map((item) => (
                <li key={item.sentence}>
                  <div className="example-row">
                    <span className="example">{item.sentence}</span>
                    <SpeakButton text={item.sentence} title={t('card.action.speak_example')} />
                  </div>
                  {item.translation ? <div className="example-zh">{item.translation}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {!isSentence && explanation.synonyms.length > 0 ? (
          <section className="section">
            <div className="label">{t('card.section.synonyms')}</div>
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

    </div>
  )
}

/**
 * A sentence is worth hearing, not just reading — intonation and liaison are
 * most of what makes spoken English hard, and neither survives a word list.
 */
export function SpeakButton({ text, title }: { text: string; title: string }) {
  return (
    <button className="label-speak" title={title} aria-label={title} onClick={() => speak(text)}>
      <SpeakerIcon size={13} />
    </button>
  )
}

/**
 * Marks the selected text inside the source sentence so the eye lands on it.
 *
 * 翻翻模式的卡片也要画同一段（当初收藏时的那句原文），所以导出来共用——
 * 复制一份的结局是两处的截断长度、大小写匹配慢慢走散，而这种走散没人会发现。
 */
export function highlightInSentence(sentence: string, selection: string) {
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
  const { t } = useI18n()
  return (
    <div className="card" role="status" aria-live="polite">
      <header className="card-head">
        <div className="headline">
          <div className="word">{word}</div>
          <div className="meta-row">
            <span className="muted">{t('card.state.analyzing')}</span>
          </div>
        </div>
        <button
          className="icon-btn"
          title={t('card.action.close_title')}
          aria-label={t('card.action.close')}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="card-body">
        <div className="thinking">
          <span className="dot" />
          {t('card.state.reading_context')}
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
  const { t } = useI18n()
  return (
    <div className="card" role="alert">
      <header className="card-head">
        <div className="headline">
          <div className="word">{word}</div>
          <div className="meta-row">
            <span className="muted">{t('card.state.failed')}</span>
          </div>
        </div>
        <button
          className="icon-btn"
          title={t('card.action.close_title')}
          aria-label={t('card.action.close')}
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>
      <div className="card-body">
        <div className="error-box">
          <div>{aiErrorMessage(code)}</div>
          {message ? <div className="muted">{truncate(message, 220)}</div> : null}
        </div>
      </div>
      <footer className="card-foot">
        {code === 'stale_context' ? (
          <button className="btn btn-primary" onClick={() => location.reload()}>
            {t('card.action.reload')}
          </button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={onRetry}>
              {t('card.action.retry')}
            </button>
            <button className="btn btn-ghost" onClick={onOffline}>
              {t('card.action.use_offline')}
            </button>
          </>
        )}
        {code === 'auth' || code === 'no_api_key' ? (
          <button className="btn btn-ghost" onClick={onOpenSettings}>
            {t('card.action.settings')}
          </button>
        ) : null}
      </footer>
    </div>
  )
}
