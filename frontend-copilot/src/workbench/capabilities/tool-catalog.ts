import type { ToolCatalogApi, ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'

const TOOL_CATALOG_API_UNAVAILABLE_ERROR = 'window.toolCatalog is unavailable in the renderer process.'

function getToolCatalogApi(): ToolCatalogApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.toolCatalog
}

export async function loadToolCatalog(language?: string | null): Promise<ToolCatalogLoadResult> {
  const api = getToolCatalogApi()
  return api ? api.load({ language }) : createFailureResult(TOOL_CATALOG_API_UNAVAILABLE_ERROR)
}

function createFailureResult(error: string): ToolCatalogLoadResult {
  return {
    ok: false,
    error,
  }
}
