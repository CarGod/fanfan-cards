import { missingFields } from '@/shared/enrichment.ts'
import { getSettings } from '@/storage/repositories/settingsRepo.ts'
import { getEntry, updateEntry } from '@/storage/repositories/vocabularyRepo.ts'
import type { MessageRequest, MessageResponse } from '@/types/messages.ts'
import type { VocabularyEntry } from '@/types/vocabulary.ts'
import { handleExplain } from './explain.ts'

/**
 * 把词卡上缺的那几项补回来。
 *
 * 缺是怎么来的：查询分两段发出去，例句、整句翻译、近义词属于第二段。读者手快，
 * 在第二段回来之前就按了收藏——存下的就是一张只有释义的卡。这不是 bug，
 * 是他动作比模型快；但那张卡从此就一直缺着，除非重新查一遍。
 *
 * 放在后台而不是内容脚本里：服务商解析、缓存、存储写入这三件事都归后台管，
 * 在内容脚本里再实现一遍，迟早会和这边走散。
 */

/**
 * 同一张卡在途只跑一次。
 *
 * 内容脚本那份去重活不过一次页面跳转，而 service worker 是全局的：
 * 两个标签页几乎同时点开同一个词，就是两次全价请求，而且后写的会盲覆盖先写的。
 * 这里让第二个调用直接搭上第一个的车。
 */
const inFlight = new Map<string, Promise<MessageResponse<'vocab/enrich'>>>()

export async function handleEnrichEntry(
  payload: MessageRequest<'vocab/enrich'>,
): Promise<MessageResponse<'vocab/enrich'>> {
  const running = inFlight.get(payload.id)
  if (running) return running

  const task = enrichOnce(payload.id).finally(() => inFlight.delete(payload.id))
  inFlight.set(payload.id, task)
  return task
}

async function enrichOnce(id: string): Promise<MessageResponse<'vocab/enrich'>> {
  const entry = await getEntry(id)
  if (!entry) return { entry: null, filled: [] }

  /*
   * 「缺不缺」要看设置。
   *
   * 读者把例句关了，那没有例句就是对的；整句卡本来就不该有例句和近义词。
   * 不看设置的话，这两类卡会被永远判成缺——每换一个页面点开都发一次
   * 注定填不上任何东西的付费请求。
   */
  const settings = await getSettings()
  const missing = missingFields(entry, settings)
  if (missing.length === 0) return { entry, filled: [] }

  /*
   * 没有当初那句原文就不补。
   *
   * 第二段要的正是「这个词在那一句里」的整句翻译和贴合语境的例句；
   * 脱离那句话去要，拿回来的是通用例句，和这张卡的来历没有关系——
   * 而这张卡存在的全部意义就是那句话。
   */
  const context = entry.source?.context ?? ''
  if (!context) return { entry, filled: [] }

  const result = await handleExplain({
    text: entry.word,
    context,
    wideContext: entry.source?.wideContext ?? '',
    pageTitle: entry.source?.title ?? '',
    pageUrl: entry.source?.url ?? '',
    detail: 'extras',
  })

  /*
   * 离线词典给不出第二段的内容。
   *
   * 走到这里说明用户当前配的是离线词典（或者真实服务商不可用被降级了）。
   * 硬把它的空结果写回去没有意义，返回原样，界面会显示「补不了」而不是转圈。
   */
  if (result.offline) return { entry, filled: [] }

  /*
   * 只填空着的，绝不覆盖已有的。
   *
   * 这张卡上已经有的东西，是当初那次查询、或者读者自己编辑过的结果。
   * 一次「补全」把它们换成新生成的，是在读者没要求的情况下改他的资料。
   */
  const extras = result.explanation
  const patch: Partial<VocabularyEntry> = {}
  const filled: string[] = []

  if (missing.includes('sentenceTranslation') && extras.sentenceTranslation?.trim()) {
    patch.sentenceTranslation = extras.sentenceTranslation
    filled.push('sentenceTranslation')
  }
  if (missing.includes('examples') && extras.examples?.length) {
    patch.examples = extras.examples
    filled.push('examples')
  }
  if (missing.includes('synonyms') && extras.synonyms?.length) {
    patch.synonyms = extras.synonyms
    filled.push('synonyms')
  }

  if (filled.length === 0) return { entry, filled: [] }

  /*
   * 写之前重新读一遍，只填**此刻仍然空着**的。
   *
   * 这次请求可能跑了几十秒。期间同步可能拉下来了另一台设备补好的内容，读者也可能
   * 自己编辑过。拿几十秒前算好的 patch 原样盖上去，就是用模型的输出覆盖掉
   * 这期间真实发生过的事。
   */
  const fresh = await getEntry(entry.id)
  if (!fresh) return { entry, filled: [] }

  const safe: Partial<VocabularyEntry> = {}
  const actually: string[] = []
  if (patch.sentenceTranslation && !fresh.sentenceTranslation?.trim()) {
    safe.sentenceTranslation = patch.sentenceTranslation
    actually.push('sentenceTranslation')
  }
  if (patch.examples && !fresh.examples?.length) {
    safe.examples = patch.examples
    actually.push('examples')
  }
  if (patch.synonyms && !fresh.synonyms?.length) {
    safe.synonyms = patch.synonyms
    actually.push('synonyms')
  }
  if (actually.length === 0) return { entry: fresh, filled: [] }

  const updated = await updateEntry(fresh.id, safe)
  return { entry: updated ?? fresh, filled: actually }
}
