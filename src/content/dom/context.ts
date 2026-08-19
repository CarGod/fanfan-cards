import { truncate } from '@/shared/utils.ts'

export interface ExtractedContext {
  /** The sentence the selection sits in. */
  sentence: string
  /** The surrounding block (usually a paragraph), for the flashcard back. */
  block: string
  pageTitle: string
  pageUrl: string
}

const BLOCK_SELECTOR =
  'p, li, td, th, dd, dt, blockquote, pre, h1, h2, h3, h4, h5, h6, figcaption, article, section, div'

const MAX_SENTENCE = 400
const MAX_BLOCK = 1200

/**
 * Context extraction is the difference between "migration = 移民" and
 * "migration = 数据库迁移". Getting the *sentence* is what the model needs;
 * getting the paragraph too is what the learner needs when reviewing weeks
 * later with no memory of the page.
 *
 * The offset is measured against the raw block text (before whitespace
 * normalisation) because normalising first would shift every index.
 */
export function extractContext(range: Range, selectedText: string): ExtractedContext {
  const block = findBlockAncestor(range.commonAncestorContainer)
  const pageTitle = document.title ?? ''
  const pageUrl = location.href

  if (!block) {
    return { sentence: selectedText, block: selectedText, pageTitle, pageUrl }
  }

  const raw = block.textContent ?? ''
  const offset = offsetWithin(block, range)
  const sentence = sentenceAt(raw, offset, selectedText)

  return {
    sentence: truncate(normalize(sentence), MAX_SENTENCE),
    block: truncate(normalize(raw), MAX_BLOCK),
    pageTitle,
    pageUrl,
  }
}

/**
 * Walks up to the nearest element that reads as a text block. `div` is in the
 * selector as a last resort, so we stop climbing once the candidate gets absurd
 * (a whole page wrapper) and prefer the smallest sensible container.
 */
function findBlockAncestor(node: Node): Element | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!start) return null

  let candidate = start.closest(BLOCK_SELECTOR)
  while (candidate) {
    const length = candidate.textContent?.length ?? 0
    if (length > 0 && length < 4000) return candidate
    candidate = candidate.parentElement?.closest(BLOCK_SELECTOR) ?? null
  }
  return start
}

/** Character offset of the selection start within the block's text. */
function offsetWithin(block: Element, range: Range): number {
  try {
    const probe = range.cloneRange()
    probe.selectNodeContents(block)
    probe.setEnd(range.startContainer, range.startOffset)
    return probe.toString().length
  } catch {
    return Math.max(0, (block.textContent ?? '').indexOf(range.toString()))
  }
}

const SENTENCE_END = /[.!?。！？;；]/

/**
 * Scans outwards from the offset to the nearest sentence boundaries. Regex
 * sentence splitting breaks on "e.g." and "Dr."; scanning with a short
 * abbreviation guard is both simpler and less wrong in practice.
 */
export function sentenceAt(text: string, offset: number, fallback: string): string {
  if (!text) return fallback
  const index = Math.min(Math.max(offset, 0), text.length - 1)

  let start = index
  while (start > 0) {
    const char = text[start - 1] ?? ''
    if (SENTENCE_END.test(char) && !isAbbreviationBoundary(text, start - 1)) break
    start--
  }

  let end = index
  while (end < text.length) {
    const char = text[end] ?? ''
    if (SENTENCE_END.test(char) && !isAbbreviationBoundary(text, end)) {
      end++
      break
    }
    end++
  }

  const sentence = text.slice(start, end).trim()
  return sentence.length >= 2 ? sentence : fallback
}

const ABBREVIATIONS = ['e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'ms', 'fig', 'no', 'al']

/** True when the `.` at `dotIndex` is part of an abbreviation, not a full stop. */
function isAbbreviationBoundary(text: string, dotIndex: number): boolean {
  if (text[dotIndex] !== '.') return false

  const next = text[dotIndex + 1]
  // A real full stop is followed by whitespace (or ends the text). Anything
  // glued to the dot is an initialism, a decimal, or a filename:
  // `e.g`, `v2.5`, `node.js`, `U.S.A`.
  if (next !== undefined && !/\s/.test(next)) return true

  // Followed by a space, so only a known abbreviation saves it: `e.g. SQS`.
  const before = text.slice(Math.max(0, dotIndex - 5), dotIndex).toLowerCase()
  return ABBREVIATIONS.some((abbr) => before.endsWith(abbr))
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
