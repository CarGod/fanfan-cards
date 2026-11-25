import { conformLineShape, isRedundantTranslation, repairOmissions, shouldTranslateText } from '@/shared/language.ts'
import { textFromNodes, visitPageText, type TranslationUnit, type WalkOptions } from './walker.ts'
import type { FillResult } from './slot.ts'

export interface TextUnit extends TranslationUnit {
  node: Text
  original: string
  applied?: string
}

/** A run owns only the character data it last wrote. Framework updates take precedence. */
export class InPlaceText {
  private units = new Map<Text, TextUnit>()

  collect(options: WalkOptions): TextUnit[] {
    const fresh: TextUnit[] = []
    const visible = new Set<Text>()
    visitPageText(document.body, options, (node) => {
      const previous = this.units.get(node)
      if (previous && node.parentElement === previous.element &&
        node.data === (previous.applied ?? previous.original)) {
        visible.add(node)
        return
      }
      if (previous) this.release(previous)
      const original = node.data
      if (!original.trim()) return
      const text = textFromNodes([node])
      if (text.length < 2 || !shouldTranslateText(text, options.targetLanguage ?? 'zh-CN')) return
      const unit = { element: node.parentElement!, node, original, text }
      this.units.set(node, unit)
      fresh.push(unit)
      visible.add(node)
    })
    for (const unit of this.units.values()) {
      if (!visible.has(unit.node)) this.release(unit)
    }
    return fresh
  }

  isOwnWrite(node: Text): boolean {
    return this.units.get(node)?.applied === node.data
  }

  current(unit: TextUnit): boolean {
    return this.units.get(unit.node) === unit && unit.node.isConnected &&
      unit.node.parentElement === unit.element && unit.node.data === (unit.applied ?? unit.original) &&
      !unit.element.closest('[contenteditable]:not([contenteditable="false"]), [translate="no"], .notranslate')
  }

  fill(unit: TextUnit, translation: string): FillResult {
    if (!this.current(unit) || !translation.trim() || isRedundantTranslation(unit.text, translation)) return 'rejected'
    const shaped = conformLineShape(unit.text, translation)
    const result = repairOmissions(unit.text, shaped ?? translation)
    const leading = unit.original.length - unit.original.trimStart().length
    unit.applied = unit.original.slice(0, leading) + result + unit.original.slice(unit.original.trimEnd().length)
    unit.node.data = unit.applied
    return shaped === null ? 'line-shape-lost' : 'filled'
  }

  restore(): void {
    for (const unit of this.units.values()) this.release(unit)
  }

  private release(unit: TextUnit): void {
    if (unit.applied !== undefined && unit.node.data === unit.applied) unit.node.data = unit.original
    this.units.delete(unit.node)
  }
}
