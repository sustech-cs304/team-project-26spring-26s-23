/** MCP section types for CapabilitiesWorkspace. */

import type { McpServerValidationError } from '../../../electron/mcp-registry/types'
import type { McpServerEditorMode } from './mcp-registry-view-model'

export interface McpServerEditorState {
  mode: McpServerEditorMode
  value: string
  validationErrors: McpServerValidationError[]
  errorMessage: string | null
  submitting: boolean
}
