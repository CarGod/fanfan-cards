import { useEffect, useRef, useState } from 'react'
import { PageTranslator } from '@/content/page/pageTranslator.ts'
import { injectPageStyles } from '@/content/page/styles.ts'

/**
 * A live rehearsal of the one bug that keeps coming back: a post translated
 * while truncated, then expanded.
 *
 * Reproduces x.com's actual shape — one `[data-testid="tweetText"]` holding a
 * single span whose text carries its own newlines, with 「显示更多」 as a
 * sibling button — and keeps a counter mutating the DOM ten times a second, the
 * way a real feed never stops moving. That constant motion is what starved the
 * old debounce, so a rehearsal without it would prove nothing.
 */
const TRUNCATED_1 = `Easy there. .gram hasn’t been approved yet.

Telegram really has applied for it, and the idea is that your username could become something like durov.gram.

But ICANN only closed applications last week. We don’t even know yet whether someone else applied for the same name.

So`

const FULL_1 = `${TRUNCATED_1} this could be very cool. It just isn’t a done deal.

Follow me — I check the announcement before the hype takes over.`

const TRUNCATED_2 = `A lot of people underestimate how much work goes into getting motion design right.

The final video might only be 60 seconds long.

But getting those 60 seconds right can take days of thinking,`

const FULL_2 = `${TRUNCATED_2} searching references, thinking about transitions, high fidelity designs, refining and reworking every single frame.`

function Tweet({ truncated, full }: { truncated: string; full: string }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <article data-testid="tweet" style={{ borderBottom: '1px solid #2f3336', padding: '16px 0' }}>
      <div>
        <div dir="auto" lang="en" data-testid="tweetText" style={{ whiteSpace: 'pre-wrap' }}>
          <span>{expanded ? full : truncated}</span>
        </div>
        {expanded ? null : (
          <button
            data-testid="tweet-text-show-more-link"
            onClick={() => setExpanded(true)}
            style={{ background: 'none', border: 0, color: '#1d9bf0', padding: 0, cursor: 'pointer' }}
          >
            显示更多
          </button>
        )}
      </div>
    </article>
  )
}

export function FeedShowcase() {
  const [running, setRunning] = useState(false)
  const [noise, setNoise] = useState(0)
  const translator = useRef<PageTranslator | null>(null)

  useEffect(() => {
    injectPageStyles()
    translator.current = new PageTranslator({
      onError: (message) => console.warn('[preview] 翻译失败:', message),
    })
    // A feed never stops moving; without this the rehearsal is too easy.
    const ticker = setInterval(() => setNoise((value) => value + 1), 100)
    return () => {
      clearInterval(ticker)
      translator.current?.stop()
    }
  }, [])

  const toggle = () => {
    if (!translator.current) return
    translator.current.toggle({ range: 'all', targetLanguage: 'zh-CN' })
    setRunning(translator.current.isRunning())
  }

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', color: '#e7e9ea' }}>
      <div style={{ marginBottom: 16 }}>
        <button className={running ? 'btn btn-on' : 'btn btn-primary'} onClick={toggle}>
          {running ? '还原原文' : '翻译整页'}
        </button>
        <span className="faint" style={{ marginLeft: 12 }}>
          译文出现后点「显示更多」，两秒内应换成更长的那条 · DOM 噪声 {noise}
        </span>
      </div>
      <Tweet truncated={TRUNCATED_1} full={FULL_1} />
      <Tweet truncated={TRUNCATED_2} full={FULL_2} />
    </div>
  )
}
