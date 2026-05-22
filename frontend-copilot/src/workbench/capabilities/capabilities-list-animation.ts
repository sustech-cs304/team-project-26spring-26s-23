import { ANIM } from '../animation-utils'

export function resolveCapabilitiesListItemEnterDelayMs(index: number): number {
  return Math.min(Math.max(index, 0) * ANIM.STAGGER_EACH, ANIM.STAGGER_MAX)
}
