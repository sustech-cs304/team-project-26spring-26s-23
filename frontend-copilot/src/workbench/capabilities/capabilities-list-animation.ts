const CAPABILITIES_LIST_ITEM_STAGGER_MS = 28
const CAPABILITIES_LIST_ITEM_MAX_DELAY_MS = 224

export function resolveCapabilitiesListItemEnterDelayMs(index: number): number {
  return Math.min(Math.max(index, 0) * CAPABILITIES_LIST_ITEM_STAGGER_MS, CAPABILITIES_LIST_ITEM_MAX_DELAY_MS)
}
