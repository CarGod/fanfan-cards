// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WordExplanation } from '@/types/ai.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { WordCard } from './WordCard.tsx'

vi.mock('@/services/speech.ts', () => ({ speak: vi.fn(), warmUpVoices: vi.fn() }))

/**
 * 收藏从卡片底部的一整行按钮，变成右上角的一个书签图标。
 *
 * 这一改动把「收」和「取消收」压进了同一个控件，而它们的后果完全相反——
 * 接反了不会报错，只会在读者以为自己在收藏时把词删掉。图标上又没有文字兜底，
 * 所以要钉住：什么状态下点它，调的是哪一个。
 */

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const explanation: WordExplanation = {
  word: 'migration',
  lemma: 'migration',
  kind: 'word',
  phonetic: '/maɪˈɡreɪʃn/',
  partOfSpeech: 'noun',
  cefr: 'B2',
  meaning: '迁移',
  senses: [],
  contextMeaning: '',
  englishDefinition: '',
  sentenceTranslation: '',
  examples: [],
  synonyms: [],
}

const onSave = vi.fn()
const onRemove = vi.fn()

let container: HTMLDivElement
let root: Root

function render(saved: VocabularyEntry | null, saving = false): void {
  act(() => {
    root.render(
      <WordCard
        selection="migration"
        sentence=""
        explanation={explanation}
        meta={{ providerId: 'deepseek', model: 'x', offline: false, cached: false }}
        savedEntry={saved}
        saving={saving}
        enriching={false}
        showEnglishDefinition
        autoSpeak={false}
        onSave={onSave}
        onRemove={onRemove}
        onClose={() => {}}
      />,
    )
  })
}

/** 右上角那一排里的第一个，就是书签。 */
const bookmark = () => container.querySelectorAll<HTMLButtonElement>('.card-head .icon-btn')[0]!

beforeEach(() => {
  onSave.mockReset()
  onRemove.mockReset()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('卡片右上角的收藏', () => {
  it('还没收藏时，点它是收进词卡', () => {
    render(null)
    act(() => bookmark().click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('已经收藏时，点它是移出词卡', () => {
    render({ id: 'w1' } as VocabularyEntry)
    act(() => bookmark().click())
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  /** 图标没有文字兜底，状态只能靠形状和无障碍属性说清楚。 */
  it('两种状态在读屏软件那里也分得开', () => {
    render(null)
    expect(bookmark().getAttribute('aria-pressed')).toBe('false')
    const unsavedLabel = bookmark().getAttribute('aria-label')

    render({ id: 'w1' } as VocabularyEntry)
    expect(bookmark().getAttribute('aria-pressed')).toBe('true')
    expect(bookmark().getAttribute('aria-label')).not.toBe(unsavedLabel)
  })

  it('实心/空心是形状上的差别，不只是换个颜色', () => {
    render(null)
    expect(bookmark().querySelector('svg')!.getAttribute('fill')).toBe('none')

    render({ id: 'w1' } as VocabularyEntry)
    expect(bookmark().querySelector('svg')!.getAttribute('fill')).toBe('currentColor')
  })

  it('正在保存时点不动，避免重复提交', () => {
    render(null, true)
    expect(bookmark().disabled).toBe(true)
    act(() => bookmark().click())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('底部那一整行按钮已经没有了', () => {
    render(null)
    expect(container.querySelector('.card-foot')).toBeNull()
  })
})
