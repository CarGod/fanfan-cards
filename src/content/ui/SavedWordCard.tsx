import { useMemo } from 'react'
import { cefrHint, partOfSpeechLabel, type VocabularyEntry } from '@/types/vocabulary.ts'
import { speak } from '@/services/speech.ts'
import { BookmarkIcon, CloseIcon, SpeakerIcon } from '@/components/icons.tsx'
import { useI18n } from '@/i18n/react.ts'
import { SenseList } from '@/components/index.tsx'
import { SpeakButton, highlightInSentence } from './WordCard.tsx'

/**
 * 翻翻模式点开的那张卡。
 *
 * 和划词卡的区别不在样式，在**它不问任何人**：这里的每一个字都已经存在
 * 这张词卡上了，渲染是同步的，一次网络请求都没有，也就没有「翻译中…」这种状态。
 * 读者点一下就看见，这正是这个模式存在的理由——他已经查过这个词了，
 * 现在只是想再看一眼。
 *
 * 放四项：基础释义、当初那句例句与它的翻译、近义词、AI 生成的例句。
 *
 * 语境解释**不放**——那一条说的是「这个词在那一句里是什么意思」，
 * 拿到另一篇文章里会误导人：读者看到的是它在**别处**的意思，
 * 却以为说的是眼前这一句。
 *
 * 但那句原文本身要放，而且叫「例句」不叫「原文」：它确实是一个例句，
 * 还是最好的那一种——读者自己读到过的真句子，不是模型编的。
 *
 * 复用划词卡的 class，所以两张卡长得一模一样——包括右上角那一排：
 * 书签（在库里是实心、点一下移出；移出之后变空心、点一下收回来）、朗读、关闭。
 * 它们本来就是同一个东西的两种来路，长得不一样才需要解释。
 */
export function SavedWordCard({
  entry,
  enriching,
  enrichFailed,
  inLibrary,
  onSave,
  onRemove,
  onClose,
}: {
  entry: VocabularyEntry
  /** 正在把缺的那几项补回来。 */
  enriching: boolean
  /** 试过了但一项都没补到。 */
  enrichFailed: boolean
  /**
   * 此刻还在词库里吗。
   *
   * 移出之后卡片**不关**：内容还在手里，读者也常常是想确认一下再决定。
   * 书签跟着变成空心，再点一下就收回去——取消收藏是破坏性的，
   * 撤销就该在原地，而不是让他去词库里翻。
   */
  inLibrary: boolean
  onSave: () => void
  onRemove: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  /*
   * 兜住缺字段。
   *
   * 词卡可能来自更早的版本、别人导出的 JSON、或者一次半路失败的同步——
   * `source` 或它里面的 `context` 不一定在。而这里抛一次异常，塌掉的不是这张卡，
   * 是整个内容脚本的界面：读者会发现划词突然彻底没反应了，控制台里一条
   * 和词卡毫无关系的报错。
   */
  const sentence = entry.source?.context ?? ''
  const highlighted = useMemo(
    () => highlightInSentence(sentence, entry.word),
    [sentence, entry.word],
  )

  return (
    <div className="card" role="dialog" aria-label={t('card.aria.dialog', { word: entry.word })}>
      <header className="card-head">
        <div className="headline">
          <div className="word-row">
            <span className="word">{entry.word}</span>
            {entry.cefr ? (
              <span
                className="cefr"
                data-band={entry.cefr[0]}
                title={`CEFR ${entry.cefr} · ${cefrHint(entry.cefr)}`}
              >
                {entry.cefr}
              </span>
            ) : null}
          </div>
          <div className="meta-row">
            {entry.phonetic ? <span className="phonetic">{entry.phonetic}</span> : null}
            {/* 词性也走界面语言：头上写 verb、正文写「动词」，是同一个字段的两种说法。 */}
            {entry.partOfSpeech ? (
              <span className="pos">{partOfSpeechLabel(entry.partOfSpeech)}</span>
            ) : null}
          </div>
        </div>
        {/*
          实心 = 它在词库里；点一下移出去。
          和划词卡上那颗**必须是同一件事**——同一个图标、同一个位置、同一个填充状态，
          在两张卡上做两件不同的事，读者只能靠试出来。
        */}
        <button
          className="icon-btn"
          data-saved={inLibrary}
          title={inLibrary ? t('card.action.unsave_title') : t('card.action.save_title')}
          aria-label={inLibrary ? t('card.action.unsave_title') : t('card.action.save_title')}
          aria-pressed={inLibrary}
          onClick={inLibrary ? onRemove : onSave}
        >
          <BookmarkIcon size={16} filled={inLibrary} />
        </button>
        <button
          className="icon-btn"
          title={t('card.action.speak')}
          aria-label={t('card.action.speak_word')}
          onClick={() => speak(entry.lemma || entry.word)}
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
        {/*
          有 senses 就显示，哪怕 meaning 是空的。
          原来这里只看 meaning——生产里它是从 senses 推导出来的所以碰巧非空，
          但那是个脆耦合：任何一条「有结构化释义、没有那行汇总文本」的数据
          都会让整节凭空消失，而消失的东西没人会去找。
        */}
        {entry.meaning || entry.senses?.length ? (
          <section className="section">
            <div className="label">{t('card.section.meaning')}</div>
            <SenseList senses={entry.senses ?? []} meaning={entry.meaning} />
          </section>
        ) : null}

        {/*
          当初遇见它的那一句。
          这是这个产品的整个论点：脱离语境的单词表背不下来，而这一句是读者
          **自己读到过**的，比模型编的例句更容易把记忆勾回来。所以排在生成例句前面。
        */}
        {sentence ? (
          <section className="section">
            <div className="label">
              {t('fanfan.card.section.source')}
              <SpeakButton text={sentence} title={t('card.action.speak_sentence')} />
            </div>
            <div className="source-quote">{highlighted}</div>
            {entry.sentenceTranslation ? (
              <div className="sentence-translation">{entry.sentenceTranslation}</div>
            ) : null}
            {entry.source.title ? (
              <div className="muted source-from">
                {t('fanfan.card.source_from', { title: entry.source.title })}
              </div>
            ) : null}
          </section>
        ) : null}

        {entry.synonyms.length > 0 ? (
          <section className="section">
            <div className="label">{t('card.section.synonyms')}</div>
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

        {entry.examples.length > 0 ? (
          <section className="section">
            <div className="label">{t('card.section.examples')}</div>
            <ol className="example-list">
              {entry.examples.map((item) => (
                <li key={item.sentence}>
                  <div className="example-row">
                    <span className="example">{item.sentence}</span>
                  </div>
                  {item.translation ? <div className="example-zh">{item.translation}</div> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/*
          正在补缺的那几项。
          读者手快、在第二段回来之前就收藏了，这张卡就只有释义。骨架条在这里的意思是
          「还有东西在路上」——比一张看起来就这么点内容的卡诚实。
        */}
        {!enriching && enrichFailed ? (
          <section className="section">
            <div className="muted">{t('fanfan.card.enrich_failed')}</div>
          </section>
        ) : null}

        {enriching ? (
          <section className="section">
            <div className="label">{t('card.section.extras')}</div>
            <div className="thinking">
              <span className="dot" />
              {t('fanfan.card.enriching')}
            </div>
            <div className="skeleton-line" style={{ width: '88%' }} />
            <div className="skeleton-line" style={{ width: '64%' }} />
          </section>
        ) : null}

        {/*
          三项全空的时候要说一句。
          这张卡是从旧数据渲染出来的，而旧数据可能是在「例句数量 = 0」的设置下存的——
          什么都不显示会让读者以为功能坏了。
        */}
        {!enriching &&
        !entry.meaning &&
        !sentence &&
        entry.synonyms.length === 0 &&
        entry.examples.length === 0 ? (
          <div className="muted">{t('fanfan.card.empty')}</div>
        ) : null}
      </div>

    </div>
  )
}
