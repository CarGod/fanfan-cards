import { useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'
import { Spinner } from '@/components/index.tsx'

interface Position {
  top: number
  left: number
  size: number
  ringSize: number
}

const SIZE = 24
const MIN_SIZE = 12
const INSET = 4
const VIEWPORT_MARGIN = 4

/**
 * A target-bound loading indicator for three-spaces input translation.
 *
 * It lives in our shadow root, so the host page cannot restyle it and it never
 * participates in the page's layout. The indicator sits just inside the
 * input's right edge and continuously remeasures while visible so scrolling,
 * resizing and animated layout changes cannot leave it floating over the
 * wrong field. Short controls shrink the indicator; controls too small to hold
 * even the minimum mark hide it rather than overflowing across their text.
 */
export function InputTranslationIndicator({
  target,
  onTargetRemoved,
}: {
  target: HTMLElement
  onTargetRemoved?: () => void
}) {
  const [position, setPosition] = useState<Position | null>(null)

  useEffect(() => {
    const previous = target.getAttribute('aria-busy')
    target.setAttribute('aria-busy', 'true')
    return () => {
      if (previous === null) target.removeAttribute('aria-busy')
      else target.setAttribute('aria-busy', previous)
    }
  }, [target])

  useLayoutEffect(() => {
    let frame = 0

    const measure = (): void => {
      if (!target.isConnected) {
        setPosition((current) => (current === null ? current : null))
        onTargetRemoved?.()
        return
      }

      const rect = target.getBoundingClientRect()
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.right < 0 ||
        rect.left > window.innerWidth ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight
      ) {
        setPosition((current) => (current === null ? current : null))
        return
      }

      const size = Math.min(SIZE, rect.width - INSET, rect.height - INSET)
      if (size < MIN_SIZE) {
        setPosition((current) => (current === null ? current : null))
        return
      }

      // Keep the overlay inside both the target and its visible viewport slice.
      // For a partially clipped field this means hugging the visible right edge,
      // while still never escaping the actual input rectangle.
      const visibleRight = Math.min(rect.right, window.innerWidth - VIEWPORT_MARGIN)
      const visibleTop = Math.max(rect.top, VIEWPORT_MARGIN)
      const visibleBottom = Math.min(rect.bottom, window.innerHeight - VIEWPORT_MARGIN)
      const horizontalInset = Math.min(INSET, Math.max(1, (rect.width - size) / 2))
      const left = Math.max(rect.left + horizontalInset, visibleRight - horizontalInset - size)
      const centeredTop = visibleTop + (visibleBottom - visibleTop - size) / 2
      const top = Math.min(
        Math.max(rect.top + 1, centeredTop),
        Math.max(rect.top + 1, rect.bottom - size - 1),
      )
      const ringSize = Math.max(6, size - 8)

      setPosition((current) =>
        current?.top === top &&
        current.left === left &&
        current.size === size &&
        current.ringSize === ringSize
          ? current
          : { top, left, size, ringSize },
      )
    }

    const followTarget = (): void => {
      measure()
      frame = window.requestAnimationFrame(followTarget)
    }

    measure()
    frame = window.requestAnimationFrame(followTarget)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(target)

    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [target, onTargetRemoved])

  if (!position) return null
  return (
    <span
      className="input-translation-indicator"
      data-input-translation-loading="true"
      style={
        {
          top: position.top,
          left: position.left,
          width: position.size,
          height: position.size,
          '--ara-input-spinner-size': `${position.ringSize}px`,
        } as CSSProperties
      }
    >
      <Spinner />
    </span>
  )
}
