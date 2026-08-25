import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GROUP_OPTIONS,
  groupCues,
  orderFromPlayhead,
  planBatches,
  spreadTranslations,
} from './segment.ts'
import type { Cue } from './timedtext.ts'

/**
 * 自动字幕是按呼吸切的。这里的每条规则都是为了让送去翻译的是句子，
 * 而不是半截话——译文碎掉的时候读者不会怪字幕轨，只会觉得我们翻得烂。
 */
function cue(startMs: number, endMs: number, text: string): Cue {
  return { startMs, endMs, text }
}

describe('groupCues', () => {
  it('把半截话并成整句再翻', () => {
    const cues = [
      cue(0, 1000, 'This is the'),
      cue(1000, 2000, 'best local AI stack'),
      cue(2000, 3000, 'right now.'),
    ]
    const groups = groupCues(cues)
    expect(groups).toEqual([
      { startIndex: 0, endIndex: 2, text: 'This is the best local AI stack right now.' },
    ])
  })

  it('句号收一组，下一句另起', () => {
    const cues = [cue(0, 900, 'Let us begin.'), cue(900, 1800, 'First we load the model.')]
    expect(groupCues(cues).map((group) => group.text)).toEqual([
      'Let us begin.',
      'First we load the model.',
    ])
  })

  /*
   * 这条是为技术频道存在的：版本号里的点号满屏都是，
   * 「Qwen 3.8」后面如果断句，每一句都会被切成两半。
   */
  it('版本号与缩写里的点不算句末', () => {
    const cues = [cue(0, 900, 'Qwen 3.8.'), cue(900, 1800, '27B runs locally.')]
    expect(groupCues(cues).map((group) => group.text)).toEqual(['Qwen 3.8. 27B runs locally.'])
  })

  it('长时间静音处断开——中间多半换了话题', () => {
    const cues = [cue(0, 900, 'and then'), cue(9000, 9900, 'we move on')]
    expect(groupCues(cues)).toHaveLength(2)
  })

  it('超过字数上限就断，别让单次请求无限长', () => {
    const long = 'a'.repeat(100)
    const cues = [cue(0, 900, long), cue(900, 1800, long)]
    expect(groupCues(cues, { ...DEFAULT_GROUP_OPTIONS, maxChars: 180 })).toHaveLength(2)
  })

  /*
   * 自动字幕一个标点都没有。这才是绝大多数视频的样子——按标点断句的规则在这里
   * 一次都不触发，如果没有别的判据，一整段话就只能撞上字数上限硬切。
   */
  it('没有标点的自动字幕，按换气断句', () => {
    // 全段只有 82 个字符，远不到字数上限——能断开就只可能是因为那次换气。
    const cues = [
      cue(0, 1200, 'the performance actually holds up in'),
      cue(1200, 2600, 'real world testing today'),
      // 这里停了 900ms：说话人说完了一句。
      cue(3500, 4700, 'now a different angle'),
    ]
    const groups = groupCues(cues)
    expect(groups.map((group) => group.text)).toEqual([
      'the performance actually holds up in real world testing today',
      'now a different angle',
    ])
  })

  it('攒得还不够多的时候，换气不算数——不然每个犹豫都切一刀', () => {
    const cues = [cue(0, 500, 'so'), cue(1400, 2400, 'here is the thing about local models')]
    expect(groupCues(cues)).toHaveLength(1)
  })

  /*
   * 一口气说满、中间没有明显停顿的段落总会撞上字数上限。硬切在第 140 个字符，
   * 那个位置和说话内容毫无关系；退到这一组里最大的那次换气上，至少落在词与词之间。
   */
  it('被字数逼着切时，退到最大的那次停顿上，而不是切在字数正好的地方', () => {
    const word = 'word'
    const cues = [
      cue(0, 1000, `${word} `.repeat(8).trim()),
      cue(1000, 2000, `${word} `.repeat(8).trim()),
      // 这里有 400ms 的换气——不够触发软断，但它是这一组里最像句子边界的地方。
      cue(2400, 3400, `${word} `.repeat(8).trim()),
      cue(3400, 4400, `${word} `.repeat(8).trim()),
    ]
    const groups = groupCues(cues, { ...DEFAULT_GROUP_OPTIONS, softGapMs: 650, maxChars: 130 })
    expect(groups[0]!.endIndex).toBe(1)
    expect(groups[1]!.startIndex).toBe(2)
  })

  it('跳过空条，也不会因此产生空组', () => {
    const cues = [cue(0, 900, '  '), cue(900, 1800, 'hello.')]
    expect(groupCues(cues)).toEqual([{ startIndex: 1, endIndex: 1, text: 'hello.' }])
  })

  it('没有字幕就没有分组', () => {
    expect(groupCues([])).toEqual([])
  })
})

describe('spreadTranslations', () => {
  it('一组的译文摊回它覆盖的每一条', () => {
    const cues = [cue(0, 1000, 'This is the'), cue(1000, 2000, 'best stack.'), cue(2000, 3000, 'Bye.')]
    const groups = groupCues(cues)
    const spread = spreadTranslations(cues, groups, ['这是最好的方案。', '再见。'])
    expect(spread).toEqual(['这是最好的方案。', '这是最好的方案。', '再见。'])
  })

  // 没翻好的位置留空串，叠加层会显示占位符；返回短数组会让下标错位。
  it('缺译文时留空串，长度仍与字幕条一致', () => {
    const cues = [cue(0, 1000, 'One.'), cue(1000, 2000, 'Two.')]
    const groups = groupCues(cues)
    expect(spreadTranslations(cues, groups, ['一。'])).toEqual(['一。', ''])
  })
})

describe('orderFromPlayhead', () => {
  const cues = [cue(0, 1000, 'One.'), cue(1000, 2000, 'Two.'), cue(2000, 3000, 'Three.')]
  const groups = groupCues(cues)

  /*
   * 读者是在第 8 分钟按下按钮的。从头翻最好写，但他要等前 8 分钟翻完
   * 才看得到第一行字——先翻他正在看的那一段，再回头补前面。
   */
  it('先翻正在播的那一段，再往后，最后回头补前面', () => {
    expect(orderFromPlayhead(groups, cues, 1500)).toEqual([1, 2, 0])
  })

  it('从头播就是自然顺序', () => {
    expect(orderFromPlayhead(groups, cues, 0)).toEqual([0, 1, 2])
  })

  it('播到片尾之后仍然给出完整顺序，不是空的', () => {
    expect(orderFromPlayhead(groups, cues, 999_999).sort()).toEqual([0, 1, 2])
  })
})

describe('planBatches', () => {
  /*
   * 读者盯着的是第一行字什么时候出现，不是整支视频什么时候翻完。
   * 一上来就发满编批量，第一行要等一整批回来。
   */
  it('头几批故意小，让第一行字尽快出现', () => {
    const order = Array.from({ length: 20 }, (_, index) => index)
    const batches = planBatches(order, [2, 4], 12)
    expect(batches[0]).toEqual([0, 1])
    expect(batches[1]).toEqual([2, 3, 4, 5])
    expect(batches[2]).toHaveLength(12)
  })

  it('一条不漏、一条不重', () => {
    const order = Array.from({ length: 37 }, (_, index) => index)
    const flat = planBatches(order, [2, 4], 12).flat()
    expect(flat).toEqual(order)
  })

  it('内容比首批还少时不会切出空批', () => {
    expect(planBatches([7], [2, 4], 12)).toEqual([[7]])
    expect(planBatches([], [2, 4], 12)).toEqual([])
  })

  // 批量大小写成 0 会让循环永远不前进——页面就此卡死，比翻得慢严重得多。
  it('批量大小为 0 也不会原地打转', () => {
    expect(planBatches([1, 2], [0], 0)).toEqual([[1], [2]])
  })
})
