import { createToolCatalogFixture } from './test-support'

export const DEFAULT_RUNTIME_TOOL_CATALOG = createToolCatalogFixture()

export function cloneRuntimeToolCatalog() {
  return createToolCatalogFixture()
}
