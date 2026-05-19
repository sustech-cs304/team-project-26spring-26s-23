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
const _animCache = new Map<string, number>()

function readAnimDurationMsCached(varName: string, fallback: number): number {
  const cached = _animCache.get(varName)
  if (cached !== undefined) {
    return cached
  }
  const value = readAnimDurationMs(varName, fallback)
  _animCache.set(varName, value)
  return value
}

export const ANIM = {
  get DURATION_FEEDBACK() { return readAnimDurationMsCached('--anim-duration-feedback', 110) },
  get DURATION_FAST() { return readAnimDurationMsCached('--anim-duration-fast', 130) },
  get DURATION_STANDARD() { return readAnimDurationMsCached('--anim-duration-standard', 165) },
  get DURATION_SLOW() { return readAnimDurationMsCached('--anim-duration-slow', 180) },
  get DURATION_EMPHASIS() { return readAnimDurationMsCached('--anim-duration-emphasis', 220) },
  get DURATION_SPIN() { return readAnimDurationMsCached('--anim-duration-spin', 900) },
  get DURATION_SHIMMER() { return readAnimDurationMsCached('--anim-duration-shimmer', 2500) },
  get STAGGER_EACH() { return readAnimDurationMsCached('--stagger-step-each', 28) },
  get STAGGER_MAX() { return readAnimDurationMsCached('--stagger-step-max', 224) },
} as const

/* ── GSAP helpers ── */
export { gsap, useGSAP }

export interface UseStaggerListEnterOptions {
  enabled?: boolean
  scope: RefObject<HTMLElement | null>
  selector: string
  itemCount?: number
}

/**
 * Reusable hook for staggered list item entrance animations.
 * Only newly inserted items are animated; existing items are left untouched.
 */
export function useStaggerListEnter({
  enabled = true,
  scope,
  selector,
  itemCount,
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
        previousCountRef.current = elements.length
        return
      }

      const countDelta = elements.length - previousCountRef.current
      previousCountRef.current = elements.length

      if (countDelta <= 0) return

      const newElements = Array.from(elements).slice(-countDelta)

      gsap.fromTo(
        newElements,
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
    { scope, dependencies: [enabled, itemCount ?? scope.current?.querySelectorAll(selector).length ?? 0] },
  )

  useEffect(() => {
    return () => {
      previousCountRef.current = 0
    }
  }, [])
}


