import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 一条规则，一道闸：`t()` 不许在模块顶层求值。
 *
 * 这是整个 i18n 层唯一一种**能编译、能过测试、还能在开发机上看着完全正常**的坏法。
 * 模块顶层的 `const LABELS = { off: t('common.off') }` 在模块加载那一刻就把文案定死了，
 * 之后用户在设置里切成英文，这张表还是中文——而它只有在「切换语言」这一个动作下
 * 才暴露，恰恰是最少被走到的路径。
 *
 * 正确写法有两种：存键、在渲染处再 `t()`（见 `shared/language.ts` 的 `labelKey`），
 * 或者把常量改成函数（`const labels = () => ({ off: t('common.off') })`）。
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(name) || name.includes('.test.')) return []
    return [full]
  })
}

/**
 * 把字符串、模板串和注释抹成同长度的空白。
 *
 * 不抹的话，注释里提到 `t(` 或者文案里带个括号，都会让下面的括号配对算错。
 */
function blankOutLiterals(code: string): string {
  let out = ''
  let index = 0
  while (index < code.length) {
    const char = code[index]!
    const next = code[index + 1]
    if (char === '/' && next === '/') {
      const end = code.indexOf('\n', index)
      const stop = end === -1 ? code.length : end
      out += ' '.repeat(stop - index)
      index = stop
    } else if (char === '/' && next === '*') {
      const end = code.indexOf('*/', index + 2)
      const stop = end === -1 ? code.length : end + 2
      out += code.slice(index, stop).replace(/[^\n]/g, ' ')
      index = stop
    } else if (char === "'" || char === '"' || char === '`') {
      let cursor = index + 1
      while (cursor < code.length && code[cursor] !== char) {
        if (code[cursor] === '\\') cursor += 1
        cursor += 1
      }
      out += code.slice(index, cursor + 1).replace(/[^\n]/g, ' ')
      index = cursor + 1
    } else {
      out += char
      index += 1
    }
  }
  return out
}

/**
 * 找出在模块顶层语句里求值的 `t(` 调用。
 *
 * 判据：从当前顶层语句的开头到这次调用之间，有没有进入过一个函数体。
 * 三种进入方式都要认：箭头函数的 `=>`、`function` 关键字，以及**类方法**——
 * 类方法两者都不用，形状是 `)` 后面跟 `{`（中间可能有返回类型标注）。
 * 漏掉第三种会把 `openaiCompatible.ts` 里一堆完全正确的写法报成违规，
 * 而一个天天误报的检查，三天之内就会被所有人无视。
 */
const ENTERS_FUNCTION = /=>|\bfunction\b|\)\s*(?::[^{;]*)?\{/
function frozenCalls(code: string): string[] {
  const masked = blankOutLiterals(code)
  const hits: string[] = []
  let depth = 0
  let statementStart = 0

  for (let index = 0; index < masked.length; index += 1) {
    const char = masked[index]!
    if (char === '{' || char === '(' || char === '[') depth += 1
    else if (char === '}' || char === ')' || char === ']') depth -= 1
    else if ((char === ';' || char === '\n') && depth === 0) statementStart = index + 1

    if (!/\bt\($/.test(masked.slice(Math.max(0, index - 1), index + 1))) continue
    if (!/(^|[^.\w])t\($/.test(masked.slice(Math.max(0, index - 2), index + 1))) continue

    const preceding = masked.slice(statementStart, index)
    if (ENTERS_FUNCTION.test(preceding)) continue

    const line = code.slice(0, index).split('\n').length
    hits.push(`第 ${line} 行`)
  }
  return hits
}

describe('文案不许在模块顶层被冻住', () => {
  const files = sourceFiles(SRC).filter((file) => !file.includes(`${join('src', 'i18n')}`))

  it('每一处 t() 都在函数体里，切换语言时才会重新求值', () => {
    const offenders: string[] = []
    for (const file of files) {
      const code = readFileSync(file, 'utf8')
      if (!/\bt\(/.test(code)) continue
      const hits = frozenCalls(code)
      if (hits.length > 0) {
        offenders.push(`${relative(SRC, file)}: ${hits.join('、')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
