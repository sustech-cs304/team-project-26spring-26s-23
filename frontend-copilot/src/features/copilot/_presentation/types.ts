import type { RuntimeToolDirectoryEntry } from '../thread-run-contract'

export interface CopilotToolPresentationSource extends Pick<RuntimeToolDirectoryEntry,
  'toolId'
  | 'displayName'
  | 'description'
  | 'kind'
  | 'displayNameZh'
  | 'displayNameEn'
  | 'descriptionZh'
  | 'descriptionEn'
  | 'group'
> {}

export interface CopilotToolPresentation {
  name: string
  description: string
  searchKeywords: string[]
}

export interface CopilotToolPlatformGroup {
  key: string
  title: string
  order: number
  sourceKind: 'builtin' | 'sustech-blackboard' | 'sustech-tis' | 'mcp-server' | 'fallback'
  searchKeywords: string[]
}
