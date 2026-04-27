import type {
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
} from '../thread-run-contract'

export type CopilotErrorDetailSourceKind = 'preflight' | 'run-start' | 'streaming'

export interface CopilotErrorDetailMeta {
  stage?: string | null
  requestedMethod?: string | null
  status?: number | null
  rawMessage?: string | null
  summaryMessage?: string | null
  resolvedToolIds?: string[]
}

export interface CopilotErrorDetailSource {
  source: CopilotErrorDetailSourceKind
  title: string
  summaryMessage: string
  rawMessage: string | null
  code: string | null
  stage: string | null
  requestedMethod: string | null
  status: number | null
  details: Record<string, unknown>
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}

export type ErrorDetailOverlayGroupKey =
  | 'summary'
  | 'request-context'
  | 'tool-model-context'
  | 'raw-details'

export type ErrorDetailOverlayStructuredJsonValue = Record<string, unknown> | unknown[]

export type ErrorDetailOverlayContentItem =
  | {
      kind: 'key-value'
      label: string
      value: string
    }
  | {
      kind: 'list'
      label: string
      values: string[]
    }
  | {
      kind: 'text'
      label: string | null
      text: string
      presentation?: 'plain-text' | 'json'
      structuredValue?: ErrorDetailOverlayStructuredJsonValue
    }

export interface ErrorDetailOverlayGroup {
  key: ErrorDetailOverlayGroupKey
  title: string
  description: string
  items: ErrorDetailOverlayContentItem[]
}

export interface ErrorDetailOverlayViewModel {
  title: string
  summaryMessage: string
  source: CopilotErrorDetailSourceKind
  code: string | null
  stage: string | null
  groups: ErrorDetailOverlayGroup[]
  hasAdditionalDetails: boolean
  emptyStateMessage: string | null
}
