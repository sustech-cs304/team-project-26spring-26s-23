import type { RuntimeModelRoute } from '../thread-run-contract'
import type { ModelRouteRef } from '../../../workbench/types'

export interface CopilotModelIconSpec {
  label: string
  accent: string
}

export interface CopilotModelOption {
  id: string
  selectionValue: string
  modelId: string
  name: string
  provider: string
  group: string
  tags: string[]
  icon: CopilotModelIconSpec
  routeRef: ModelRouteRef | null
  route: RuntimeModelRoute
  available: boolean
  unavailableReason: string | null
  thinkingCapabilityOverride: Record<string, unknown> | null
}

export interface CopilotModelGroup {
  key: string
  title: string
  models: CopilotModelOption[]
}

export interface CopilotModelCatalog {
  groups: CopilotModelGroup[]
  models: CopilotModelOption[]
}
