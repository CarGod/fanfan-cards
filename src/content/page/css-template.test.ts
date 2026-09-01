import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * CSS 写在模板字符串里，所以里面**一个反引号都不能有**。
 *
 * 这条规则听起来是废话，但它在这个仓库里已经犯了四次——每一次都是在 CSS 的中文
 * 注释里用反引号引一个属性名或选择器（`display: none`、`*`），而那一下会把模板
 * 字符串提前截断，后面整段 CSS 变成 JS 表达式，报出来的错是
 * 「算术运算的左侧必须是 number」这种和 CSS 毫无关系的东西。
 *
 * 靠人记是记不住的：写注释的时候脑子在解释设计，不在数引号。所以写成检查。
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) return []
    return [full]
  })
}

/** 找出 `const X = \`` 一直到收尾反引号之间，有没有多余的反引号。 */
function strayBackticks(code: string): number[] {
  const lines: number[] = []
  const opener = /\bconst\s+\w*(?:CSS|Css|css|STYLE|Style)\w*\s*(?::[^=]+)?=\s*`/g
  for (const match of code.matchAll(opener)) {
    const start = match.index + match[0].length
    // 模板字符串在第一个未转义的反引号处结束。
    const rest = code.slice(start)
    const end = rest.search(/(?<!\\)`/)
    if (end === -1) continue
    const body = rest.slice(0, end)
    // 收尾之后紧跟的应该是 JS，而不是更多 CSS——若正文里出现 `{` 且收尾很早，
    // 说明被提前截断了。这里直接看正文里有没有反引号即可：有就是问题。
    const stray = body.indexOf('`')
    if (stray !== -1) lines.push(code.slice(0, start + stray).split('\n').length)
  }
  return lines
}

describe('CSS 模板字符串里不许出现反引号', () => {
  it('每一段内联 CSS 都没有被注释里的反引号截断', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const code = readFileSync(file, 'utf8')
      const hits = strayBackticks(code)
      if (hits.length > 0) offenders.push(`${relative(SRC, file)}: 第 ${hits.join('、')} 行`)
    }
    expect(offenders).toEqual([])
  })
})
