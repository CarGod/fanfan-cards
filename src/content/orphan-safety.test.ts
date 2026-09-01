import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 内容脚本里的每一条「发射后不管」的 promise，都必须接住失败。
 *
 * 扩展一重载，读者当时开着的**每一个标签页**上的脚本就都和它失联了，之后每一次
 * `chrome.*` 调用都会抛。不接住的话，它变成一条未捕获的 Promise 拒绝，在页面控制台
 * 和 chrome://extensions 的错误列表里留下 `Extension context invalidated`——
 * 看起来像插件崩了，而它只是需要刷新一下。
 *
 * 这个仓库已经有一整套处理（`noteOrphanError`：认出来、停下来、说人话）。
 * 问题从来不是没有机制，而是**新写的异步路径忘了接进去**——而它只在扩展更新的
 * 那一刻暴露，开发机上几乎撞不到。所以写成检查。
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) return []
    return [full]
  })
}

/**
 * 找出 `void something().then(...)` 却没有 `.catch` 的地方。
 *
 * 只看 `void` 开头的：那是明确表示「我不等这个结果」的写法，也正是没人接住失败的
 * 那一类。`await` 有 try/catch 兜着，不在这里管。
 */
function unguarded(code: string): number[] {
  const lines: number[] = []
  const pattern = /\bvoid\s+[^\n;]*?\.then\s*\(/g
  for (const match of code.matchAll(pattern)) {
    // 从这一句开始往后看，直到分号或空行为止，中间有没有 catch。
    const rest = code.slice(match.index)
    const statement = rest.slice(0, rest.search(/\n\s*\n|\n\s*(?:const|let|return|\}|\/\*)/))
    if (!/\.catch\s*\(/.test(statement)) {
      lines.push(code.slice(0, match.index).split('\n').length)
    }
  }
  return lines
}

describe('内容脚本失联时不能抛未捕获拒绝', () => {
  it('每一条 void ….then() 都接住了失败', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(join(SRC, 'content'))) {
      const code = readFileSync(file, 'utf8')
      const hits = unguarded(code)
      if (hits.length > 0) {
        offenders.push(`${relative(SRC, file)}: 第 ${hits.join('、')} 行`)
      }
    }
    expect(offenders).toEqual([])
  })
})
