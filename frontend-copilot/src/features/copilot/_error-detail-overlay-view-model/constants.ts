import type { ErrorDetailOverlayGroupKey } from './types'

export const ERROR_DETAIL_META_KEYS = {
  stage: '__copilotMeta_stage',
  requestedMethod: '__copilotMeta_requestedMethod',
  status: '__copilotMeta_status',
  rawMessage: '__copilotMeta_rawMessage',
  summaryMessage: '__copilotMeta_summaryMessage',
  resolvedToolIds: '__copilotMeta_resolvedToolIds',
} as const

export const groupOrder: Record<ErrorDetailOverlayGroupKey, number> = {
  summary: 0,
  'request-context': 1,
  'tool-model-context': 2,
  'raw-details': 3,
}
