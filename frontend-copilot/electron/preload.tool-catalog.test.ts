import { describe, expect, it } from 'vitest'

import { TOOL_CATALOG_LOAD_CHANNEL, type ToolCatalogApi } from './tool-catalog/ipc'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload tool catalog bridge', () => {
  it('routes tool catalog load through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const toolCatalogApi = getExposedApi<ToolCatalogApi>('toolCatalog')

    await toolCatalogApi.load()

    expect(invokeMock.mock.calls).toEqual([
      [TOOL_CATALOG_LOAD_CHANNEL, undefined],
    ])
  })
})
