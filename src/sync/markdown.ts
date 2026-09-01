import { type FamiliarityLevel, type VocabularyEntry } from '@/types/vocabulary.ts'
import type { KnowledgeSnapshot } from '@/services/exportService.ts'
import { safeHostname } from '@/shared/utils.ts'

/**
 * Renders the repository's human-readable files.
 *
 * The whole point of putting the knowledge base in Git rather than in a blob
 * store is that a commit diff should read like "what I learned this week". That
 * only works if the output is deterministic: entries sorted, and volatile
 * fields (next-due timestamps, updatedAt) deliberately left out, or every sync
 * would rewrite every line and the history would be worthless.
 */

const LEVEL_ICON: Record<FamiliarityLevel, string> = {
  0: '🔴',
  1: '🟡',
  2: '🔵',
  3: '🟢',
}

/*
 * 熟悉度标签在这里写死中文，**不走界面语言**。
 *
 * 这些字进的是用户自己的 GitHub 仓库，是文件内容而不是界面外壳。跟着界面语言变，
 * 意味着他在设置页点一下「English」，下一次同步就会把仓库里每一行都改写一遍——
 * 一个纯粹由界面偏好触发的巨型 diff，而且历史从此对不上。
 */
const LEVEL_LABEL: Record<FamiliarityLevel, string> = {
  0: '陌生',
  1: '学习中',
  2: '熟悉',
  3: '掌握',
}

/** One readable page per shard, so a letter's diff shows only that letter. */
export function renderShardMarkdown(shardKey: string, all: VocabularyEntry[]): string {
  // Tombstones live in the JSON so deletions propagate; the readable page is
  // for a person, and a deleted word is not something they want to read.
  const entries = all.filter((entry) => !entry.deletedAt)
  const title = shardKey === 'other' ? '其他' : shardKey.toUpperCase()
  const lines: string[] = [
    `# ${title}`,
    '',
    `> ${entries.length} 个词条 · 由 翻翻词卡 自动同步`,
    '',
  ]
  for (const entry of entries) lines.push(...renderEntry(entry))
  return `${lines.join('\n').trimEnd()}\n`
}

function renderEntry(entry: VocabularyEntry): string[] {
  const meta = [
    entry.phonetic ? `\`${entry.phonetic}\`` : '',
    entry.partOfSpeech,
    entry.cefr ? `CEFR ${entry.cefr}` : '',
    `${LEVEL_ICON[entry.review.level]} ${LEVEL_LABEL[entry.review.level]}`,
  ]
    .filter(Boolean)
    .join(' · ')

  const lines = [`### ${entry.word}`, '', meta, '']

  if (entry.meaning) lines.push(`**释义**：${entry.meaning}`, '')
  if (entry.aiExplanation) lines.push(`**语境含义**：${oneLine(entry.aiExplanation)}`, '')
  if (entry.englishDefinition) lines.push(`**English**：${entry.englishDefinition}`, '')
  if (entry.examples.length) {
    lines.push('**例句**：', '')
    for (const item of entry.examples) {
      lines.push(`- ${item.sentence}`)
      if (item.translation) lines.push(`  > ${item.translation}`)
    }
    lines.push('')
  }
  if (entry.source.context) {
    lines.push(`**遇见于**：${sourceLink(entry)}`, '', `> ${oneLine(entry.source.context)}`, '')
  }
  if (entry.notes) lines.push(`**笔记**：${oneLine(entry.notes)}`, '')

  return lines
}

function sourceLink(entry: VocabularyEntry): string {
  const label = entry.source.title || safeHostname(entry.source.url) || '未知来源'
  return entry.source.url ? `[${label}](${entry.source.url})` : label
}

/** Markdown blockquotes and bold runs break across newlines. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim()
}

export function renderReadme(
  snapshot: KnowledgeSnapshot,
  repoFullName: string,
  shardKeys: string[] = [],
): string {
  const live = snapshot.entries.filter((entry) => !entry.deletedAt)
  const histogram: Record<FamiliarityLevel, number> = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (const entry of live) histogram[entry.review.level]++

  const bySource = new Map<string, number>()
  for (const entry of live) {
    const host = safeHostname(entry.source.url)
    if (host) bySource.set(host, (bySource.get(host) ?? 0) + 1)
  }
  const topSources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return `# 我的 AI 英语知识库

这个仓库由 [翻翻词卡](https://github.com/) Chrome 扩展自动维护。
每个词条都记录了**我在哪句话里遇到它**，以及 AI 结合那个语境给出的解释。

## 现状

| 指标 | 数值 |
|---|---|
| 词条总数 | ${live.length} |
| 复习次数 | ${snapshot.reviewLog.length} |
| 学习天数 | ${snapshot.counts.activeDays} |

熟悉度分布：

| 等级 | 数量 |
|---|---|
| 🔴 ${LEVEL_LABEL[0]} | ${histogram[0]} |
| 🟡 ${LEVEL_LABEL[1]} | ${histogram[1]} |
| 🔵 ${LEVEL_LABEL[2]} | ${histogram[2]} |
| 🟢 ${LEVEL_LABEL[3]} | ${histogram[3]} |

${topSources.length ? `## 主要来源\n\n${topSources.map(([host, count]) => `- ${host} — ${count} 个词`).join('\n')}\n` : ''}
## 按字母浏览

${shardKeys.length ? shardKeys.map((key) => `[${key === 'other' ? '#' : key.toUpperCase()}](vocabulary/${key}.md)`).join(' · ') : '（还没有词条）'}

## 文件布局

| 路径 | 内容 |
|---|---|
| \`index.json\` | 清单：schema 版本、各分片词条数 |
| \`vocabulary/<字母>.json\` | 词条数据，按首字母分片 |
| \`vocabulary/<字母>.md\` | 同一批词条的可读版本 |
| \`meta/activity.json\` | 每日学习活跃度 |
| \`meta/reviews.json\` | 复习流水 |

按首字母分片不是为了整洁：一条词条约 2.5 KB，单个文件在 500 词左右就会越过
GitHub Contents API 读取单文件的 1 MB 上限。分片同时让 diff 变得有意义——新增一个
以 z 开头的词只会改动 \`vocabulary/z.json\`。

## 恢复数据

在扩展的设置页填入同一个 Token 与仓库名，首次同步就会把这里的词条全部合并到本地。
合并是**加法**，不会覆盖本地已有的学习记录。

---

<sub>${repoFullName} · 由扩展自动提交</sub>
`
}

/** Commit subject doubles as the learning log; keep it factual and short. */
export function buildCommitMessage(snapshot: KnowledgeSnapshot, added: number): string {
  const live = snapshot.entries.filter((entry) => !entry.deletedAt).length
  const parts = [`sync: ${live} 词`]
  if (added > 0) parts.push(`新增 ${added}`)
  parts.push(`复习 ${snapshot.reviewLog.length} 次`)
  return parts.join(' · ')
}
