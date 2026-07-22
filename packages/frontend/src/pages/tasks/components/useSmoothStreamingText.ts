import { useEffect, useMemo, useRef, useState } from 'react'

const FRAME_INTERVAL_MS = 32
const FINAL_CATCH_UP_MS = 550

export function splitGraphemes(value: string): string[] {
  const Segmenter = typeof Intl !== 'undefined'
    ? (Intl as typeof Intl & {
        Segmenter?: new (
          locales?: string | string[],
          options?: { granularity: 'grapheme' },
        ) => { segment: (input: string) => Iterable<{ segment: string }> }
      }).Segmenter
    : undefined

  if (Segmenter) {
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(value), ({ segment }) => segment)
  }

  return Array.from(value)
}

/**
 * Keep normal output calm, then progressively catch up if network chunks arrive
 * faster than the UI can display them. Once the response closes, finish the
 * remaining reveal promptly instead of flashing the entire backlog at once.
 */
export function getStreamingRevealRate(backlog: number, streaming: boolean): number {
  if (backlog <= 0) return 0

  if (!streaming) {
    return Math.min(900, Math.max(120, Math.ceil(backlog / (FINAL_CATCH_UP_MS / 1000))))
  }

  if (backlog > 360) return 220
  if (backlog > 160) return 136
  if (backlog > 64) return 88
  return 56
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handleChange = () => setReduced(media.matches)
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return reduced
}

export function useSmoothStreamingText(content: string, streaming: boolean) {
  const reducedMotion = usePrefersReducedMotion()
  const graphemes = useMemo(() => splitGraphemes(content), [content])
  const targetRef = useRef(graphemes)
  const visibleCountRef = useRef(streaming && !reducedMotion ? 0 : graphemes.length)
  const [visibleCount, setVisibleCount] = useState(visibleCountRef.current)
  const participatedInStreamRef = useRef(streaming)

  useEffect(() => {
    const previous = targetRef.current
    targetRef.current = graphemes

    if (streaming) participatedInStreamRef.current = true

    if (reducedMotion || (!participatedInStreamRef.current && !streaming)) {
      visibleCountRef.current = graphemes.length
      setVisibleCount(graphemes.length)
      return
    }

    // A provider may revise the tail of a partial message. Never display text
    // beyond the common prefix while that correction is being revealed.
    let commonPrefix = 0
    const comparableLength = Math.min(previous.length, graphemes.length)
    while (commonPrefix < comparableLength && previous[commonPrefix] === graphemes[commonPrefix]) {
      commonPrefix += 1
    }
    if (commonPrefix < visibleCountRef.current) {
      visibleCountRef.current = commonPrefix
      setVisibleCount(commonPrefix)
    }
  }, [graphemes, reducedMotion, streaming])

  useEffect(() => {
    if (reducedMotion) return

    let animationFrame = 0
    let previousFrame = performance.now()
    let lastPaint = previousFrame
    let revealBudget = 0

    const tick = (now: number) => {
      const elapsed = Math.min(now - previousFrame, 100)
      previousFrame = now
      const backlog = targetRef.current.length - visibleCountRef.current

      if (backlog > 0) {
        revealBudget += (elapsed * getStreamingRevealRate(backlog, streaming)) / 1000

        if (now - lastPaint >= FRAME_INTERVAL_MS) {
          const revealCount = Math.min(backlog, Math.floor(revealBudget))
          if (revealCount > 0) {
            revealBudget -= revealCount
            visibleCountRef.current += revealCount
            setVisibleCount(visibleCountRef.current)
            lastPaint = now
          }
        }
      }

      if (streaming || visibleCountRef.current < targetRef.current.length) {
        animationFrame = requestAnimationFrame(tick)
      }
    }

    animationFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationFrame)
  }, [reducedMotion, streaming])

  const safeVisibleCount = Math.min(visibleCount, graphemes.length)
  return {
    text: graphemes.slice(0, safeVisibleCount).join(''),
    revealing: !reducedMotion && (streaming || safeVisibleCount < graphemes.length),
  }
}
