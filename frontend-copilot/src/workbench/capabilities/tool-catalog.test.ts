import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ToolCatalogApi, ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'
import { loadToolCatalog } from './tool-catalog'

const unavailableError = 'window.toolCatalog is unavailable in the renderer process.'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('capabilities tool catalog bridge', () => {
  it('returns a structured failure when the preload api is unavailable', async () => {
    vi.stubGlobal('window', undefined)

    await expect(loadToolCatalog()).resolves.toEqual({
      ok: false,
      error: unavailableError,
    })
  })

  it('delegates to the injected preload api when available', async () => {
    const loadResult: ToolCatalogLoadResult = {
      ok: true,
      tools: [
        {
          toolId: 'tool.fs.read',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容。',
        },
      ],
    }
    const api: ToolCatalogApi = {
      load: vi.fn().mockResolvedValue(loadResult),
    }

    vi.stubGlobal('window', {
      toolCatalog: api,
    } satisfies Pick<Window, 'toolCatalog'>)

    await expect(loadToolCatalog('en-US')).resolves.toEqual(loadResult)
    expect(api.load).toHaveBeenCalledWith({ language: 'en-US' })
  })
})
