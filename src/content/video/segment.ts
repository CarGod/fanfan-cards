import type { Cue } from './timedtext.ts'

/**
 * 把字幕条并成句子再送去翻译。
 *
 * 自动字幕是按呼吸切的，不是按句子切的：「Quinn 3.827B.」「This is the」——
 * 逐条翻译等于把半截话交给模型，译文必然是碎的。所以先按句子边界并成组，
 * 一组翻一次，再把这一组的译文摊回它覆盖的每一条上。
 *
 * 代价是译文在一组之内不随原文逐条变化。这是有意的：中文那行稳住、英文那行走，
 * 比两行一起跳更好读，也正是成熟的双语字幕的做法。
 */

export interface CueGroup {
  /** 覆盖 cues[startIndex..endIndex]，闭区间。 */
  startIndex: number
  endIndex: number
  /** 合并后的整句，送去翻译的就是它。 */
  text: string
}

export interface GroupOptions {
  /** 一组最多多少字符。太长会拖慢首屏，太短又切碎句子。 */
  maxChars: number
  /** 两条之间静音超过这么久就断开——中间多半换了话题或换了人说。 */
  maxGapMs: number
  /**
   * 说话人换气的长度。
   *
   * 自动字幕**没有标点**——一整支视频下来一个句号都没有。所以按标点断句的那条规则
   * 在自动轨上一次都不会触发，只剩字数上限在硬切，切在哪儿全看运气，读者看到的就是
   * 「性能……现在换个角度来看，呃，智能」这种半截话。停顿是这种轨上唯一还剩下的
   * 句子边界信号，而它其实相当准。
   */
  softGapMs: number
  /** 攒够这么多字符之后，换气才算数——否则每个犹豫都会切一刀。 */
  minCharsForSoftBreak: number
}

export const DEFAULT_GROUP_OPTIONS: GroupOptions = {
  maxChars: 140,
  maxGapMs: 2000,
  softGapMs: 650,
  minCharsForSoftBreak: 55,
}

/** 句末标点。中英文都要认，视频里两种都有。 */
const SENTENCE_END = /([.!?…。！？；;])["'\u201d\u2019)\]]*\s*$/

/**
 * 缩写不是句末：「Mr.」「Dr.」「e.g.」，以及人名里的单字母缩写。
 */
const ABBREVIATION = /(?:^|\s)(?:[A-Za-z]|Mr|Mrs|Ms|Dr|Prof|St|vs|etc|eg|ie|approx|No|Fig)\.\s*$/i

/**
 * 句号只在「后面确实另起一句」时才算句末。
 *
 * 光看标点在技术频道上必翻车：「Qwen 3.8.」后面跟着「27B runs locally.」，
 * 那个点是版本号的一部分，断在这里等于把每个型号名都劈成两半。所以还要看下一条
 * 怎么起头——小写或数字开头的，是同一句话的后半截。感叹号问号没有这个歧义，
 * 它们自己就说明了问题。
 */
function endsSentence(text: string, next: string | undefined): boolean {
  const match = SENTENCE_END.exec(text)
  if (!match) return false
  if (ABBREVIATION.test(text)) return false
  if (match[1] !== '.') return true
  const head = next?.trim()?.[0]
  if (!head) return true
  return !/[a-z0-9]/.test(head)
}

/**
 * 被字数逼着切的时候，切在这一组里最大的那个停顿上。
 *
 * 硬切在第 140 个字符，那个位置和说话内容毫无关系；退回到最近的一次换气，
 * 至少落在词与词之间，多半还落在句与句之间。只在后半段找切点，
 * 否则第一组会短得没有意义。
 */
function bestCut(cues: Cue[], buffer: number[]): number {
  if (buffer.length < 2) return buffer.length - 1
  const earliest = Math.max(0, Math.floor(buffer.length / 2) - 1)

  let best = buffer.length - 2
  let widest = -1
  for (let position = earliest; position <= buffer.length - 2; position += 1) {
    const gap = cues[buffer[position + 1]!]!.startMs - cues[buffer[position]!]!.endMs
    // 并列时取靠后的：同样自然的切点，留满的那一组更好。
    if (gap >= widest) {
      widest = gap
      best = position
    }
  }
  return best
}

export function groupCues(cues: Cue[], options: GroupOptions = DEFAULT_GROUP_OPTIONS): CueGroup[] {
  const groups: CueGroup[] = []
  let buffer: number[] = []

  const textOf = (indices: number[]): string =>
    indices
      .map((index) => cues[index]!.text.trim())
      .filter(Boolean)
      .join(' ')

  const emit = (indices: number[]): void => {
    const text = textOf(indices).trim()
    if (!text) return
    groups.push({ startIndex: indices[0]!, endIndex: indices[indices.length - 1]!, text })
  }

  const flush = (): void => {
    if (buffer.length > 0) emit(buffer)
    buffer = []
  }

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]!
    const piece = cue.text.trim()
    if (!piece) continue

    if (buffer.length > 0) {
      const previous = cues[buffer[buffer.length - 1]!]!
      const gap = cue.startMs - previous.endMs
      const current = textOf(buffer)

      if (gap > options.maxGapMs) {
        flush()
      } else if (gap >= options.softGapMs && current.length >= options.minCharsForSoftBreak) {
        flush()
      } else if (current.length + 1 + piece.length > options.maxChars) {
        const cut = bestCut(cues, buffer)
        emit(buffer.slice(0, cut + 1))
        buffer = buffer.slice(cut + 1)
      }
    }

    buffer.push(index)
    if (endsSentence(piece, cues[index + 1]?.text)) flush()
  }
  flush()

  return groups
}

/**
 * 把每组的译文摊回逐条。
 *
 * 返回的数组与 `cues` 等长、按下标对齐——叠加层就是按下标取译文的，
 * 缺的位置留空串，显示成占位符而不是让整行消失。
 */
export function spreadTranslations(
  cues: Cue[],
  groups: CueGroup[],
  translations: string[],
): string[] {
  const result = new Array<string>(cues.length).fill('')
  groups.forEach((group, index) => {
    const translated = (translations[index] ?? '').trim()
    if (!translated) return
    for (let i = group.startIndex; i <= group.endIndex && i < cues.length; i += 1) {
      result[i] = translated
    }
  })
  return result
}

/**
 * 从当前播放位置开始的翻译顺序。
 *
 * 从头翻是最容易写的，也是最难用的：读者是在第 8 分钟按下按钮的，
 * 却要等前 8 分钟先翻完才看得到第一行字。所以先翻他正在看的那一段，
 * 再往后推，最后回头补前面。
 */
export function orderFromPlayhead(groups: CueGroup[], cues: Cue[], timeMs: number): number[] {
  const order = groups.map((_, index) => index)
  if (groups.length === 0) return order

  let pivot = groups.findIndex((group) => {
    const end = cues[group.endIndex]
    return end !== undefined && end.endMs >= timeMs
  })
  if (pivot < 0) pivot = 0

  return [...order.slice(pivot), ...order.slice(0, pivot)]
}

/**
 * 把翻译顺序切成一批批请求，头几批**故意小**。
 *
 * 读者按下开关之后盯着的是第一行字什么时候出现，不是整支视频什么时候翻完。
 * 一上来就按满编批量发，第一行要等一整批回来；先发两组，第一行两三秒就到，
 * 之后再放大到满编把剩下的吞掉。总请求数只多了一两个，观感差别很大。
 */
export function planBatches(order: number[], ramp: number[], steady: number): number[][] {
  const batches: number[][] = []
  let cursor = 0
  let step = 0

  while (cursor < order.length) {
    const size = Math.max(1, ramp[step] ?? steady)
    batches.push(order.slice(cursor, cursor + size))
    cursor += size
    step += 1
  }
  return batches
}
