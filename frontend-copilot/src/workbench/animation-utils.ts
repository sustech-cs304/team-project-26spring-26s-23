import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { useEffect, useRef, type RefObject } from 'react'

gsap.registerPlugin(useGSAP)

/* ── CSS variable reader ── */
function readAnimDurationMs(varName: string, fallback: number): number {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return fallback
  }
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    if (raw.length === 0) return fallback
    const parsed = parseFloat(raw)
    if (Number.isNaN(parsed)) return fallback
    if (raw.endsWith('ms')) return parsed
    if (raw.endsWith('s')) return parsed * 1000
    return parsed
  } catch {
    return fallback
  }
}

/* ── Animation timing constants (mirrors tokens.css) ── */
export const ANIM = {
  DURATION_FEEDBACK: readAnimDurationMs('--anim-duration-feedback', 110),
  DURATION_FAST: readAnimDurationMs('--anim-duration-fast', 130),
  DURATION_STANDARD: readAnimDurationMs('--anim-duration-standard', 165),
  DURATION_SLOW: readAnimDurationMs('--anim-duration-slow', 180),
  DURATION_EMPHASIS: readAnimDurationMs('--anim-duration-emphasis', 220),
  DURATION_SPIN: readAnimDurationMs('--anim-duration-spin', 900),
  DURATION_SHIMMER: readAnimDurationMs('--anim-duration-shimmer', 2500),
  STAGGER_EACH: readAnimDurationMs('--stagger-step-each', 28),
  STAGGER_MAX: readAnimDurationMs('--stagger-step-max', 224),
} as const

/* ── GSAP helpers ── */
export { gsap, useGSAP }

export interface UseStaggerListEnterOptions {
  enabled?: boolean
  scope: RefObject<HTMLElement | null>
  selector: string
}

/**
 * Reusable hook for staggered list item entrance animations.
 * Replaces the pattern of inline style={{ animationDelay: ... }} on every row
 * or the CSS nth-child animation-delay grid.
 */
export function useStaggerListEnter({
  enabled = true,
  scope,
  selector,
}: UseStaggerListEnterOptions) {
  const previousCountRef = useRef(0)

  useGSAP(
    () => {
      const container = scope.current
      if (!container) return

      const elements = container.querySelectorAll(selector)
      if (elements.length === 0) return

      if (!enabled) {
        gsap.set(elements, { opacity: 1, y: 0 })
        return
      }

      const isNewItems = elements.length > previousCountRef.current
      previousCountRef.current = elements.length

      if (!isNewItems) return

      gsap.fromTo(
        elements,
        { opacity: 0, y: 7 },
        {
          opacity: 1,
          y: 0,
          duration: ANIM.DURATION_STANDARD / 1000,
          ease: 'power2.out',
          stagger: { amount: ANIM.STAGGER_MAX / 1000 },
        },
      )
    },
    { scope, dependencies: [enabled] },
  )

  useEffect(() => {
    return () => {
      previousCountRef.current = 0
    }
  }, [])
}

/**
 * Conditionally execute GSAP animation or snap to final state.
 */
export function animateIfEnabled(
  enabled: boolean,
  animateFn: () => gsap.core.Tween | gsap.core.Timeline | void,
  snapFn: () => void,
) {
  if (enabled) {
    animateFn()
  } else {
    snapFn()
  }
}
