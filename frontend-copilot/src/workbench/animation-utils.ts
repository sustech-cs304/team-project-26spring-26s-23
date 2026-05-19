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
