import { sendMessage } from '@/services/messaging.ts'
import { noteOrphanError } from '@/shared/extensionContext.ts'
import { rejoinOnSkeleton } from '@/shared/language.ts'
import { fillSlot } from './slot.ts'
import type { TranslationUnit } from './walker.ts'

/**
 * 逐行重译：把结构从「求模型配合」变成「由拼接保证」。
 *
 * 走到这里，说明原文是多行、而模型把它压成了一段。这一次不再把整段丢过去，
 * 而是**一行一个条目**发出去，回来按原文的骨架拼回去——行数是我们拼的，
 * 模型没有插手的余地。代价是每行各自翻译，跨行的语境弱一些；
 * 但换行本身就是原文在说「这几件事是分开的」，分开译并不吃亏。
 */

/**
 * 一轮翻译里最多补救多少段。
 *
 * 这个上限不是性能考虑，是**花谁的钱**的考虑。补救是第二次请求；
 * 模型如果一贯不保留换行，一整页信息流就会安静地把请求数翻一倍，
 * 而账单在读者自己的 API 后台上。前几段补一补是明显划算的——读者正在看的就是它们；
 * 把整页都翻倍，是一个不该由我们替他做的决定。
 */
const MAX_PER_RUN = 8

export class LineRetryBudget {
  private spent = 0

  reset(): void {
    this.spent = 0
  }

  /** 还能补几段。到零之后就一直是零，直到下一轮翻译开始。 */
  private take(count: number): number {
    const allowed = Math.max(0, Math.min(count, MAX_PER_RUN - this.spent))
    this.spent += allowed
    return allowed
  }

  /**
   * 一个一个来，不并发。
   *
   * 第一版这里写的是 `Promise.all`，等于在整页翻译那道 MAX_CONCURRENT = 3 的
   * 并发闸**外面**另开一条道，一次能甩出八个请求。那道闸的存在理由写在
   * pageTranslator 里：每一家服务商都限流，一串突发换回一个 429，废掉的是整轮翻译。
   *
   * 补救本来就是排在主队列之后的锦上添花，没有任何理由为它抢额度——
   * 慢几秒钟没人看得出来，触发限流则是整页白翻。
   */
  async retranslate(units: TranslationUnit[]): Promise<void> {
    const allowed = this.take(units.length)
    for (const unit of units.slice(0, allowed)) {
      await retranslateOne(unit)
    }
  }
}

async function retranslateOne(unit: TranslationUnit): Promise<void> {
  const lines = unit.text.split('\n').filter((line) => line.trim())
  if (lines.length < 2) return

  try {
    const result = await sendMessage('page/translate', {
      texts: lines,
      hint: document.title,
    })
    if (result.translations.length !== lines.length) return
    fillSlot(unit.element, unit.text, rejoinOnSkeleton(unit.text, result.translations))
  } catch (error) {
    // 补救失败不该升级成一次报错：槽里已经有一份读得懂的译文了。
    noteOrphanError(error)
  }
}
