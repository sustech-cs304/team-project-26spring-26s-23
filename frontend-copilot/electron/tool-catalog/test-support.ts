import { DEFAULT_RUNTIME_TOOL_CATALOG } from './default-tool-catalog'
import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'

export function createToolCatalogFixture(): RuntimeToolDirectoryEntry[] {
  // Return a fresh copy of the default catalog for test isolation
  return DEFAULT_RUNTIME_TOOL_CATALOG.map((entry) => ({ ...entry }))
}
