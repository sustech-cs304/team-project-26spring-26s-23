import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'

export const TOOL_CATALOG_LOAD_CHANNEL = 'tool-catalog:load'

export interface ToolCatalogLoadRequest {
  language?: string | null
}

export interface ToolCatalogLoadSuccess {
  ok: true
  directoryVersion: string
  language?: string | null
  tools: RuntimeToolDirectoryEntry[]
  warnings?: string[]
}

export interface ToolCatalogApiFailure {
  ok: false
  error: string
}

export type ToolCatalogLoadResult = ToolCatalogLoadSuccess | ToolCatalogApiFailure

export interface ToolCatalogApi {
  load: (request?: ToolCatalogLoadRequest) => Promise<ToolCatalogLoadResult>
}
