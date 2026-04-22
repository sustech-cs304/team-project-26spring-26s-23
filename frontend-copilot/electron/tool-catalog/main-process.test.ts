import { describe, expect, it, vi } from 'vitest'

import { createElectronToolCatalogMainProcess } from './main-process'

describe('createElectronToolCatalogMainProcess', () => {
  it('delegates catalog loading to the configured service', async () => {
    const service = {
      load: vi.fn(async () => ({
        ok: true as const,
        directoryVersion: 'tools-v1',
        tools: [
          {
            toolId: 'tool.fs.read',
            kind: 'builtin',
            availability: 'available',
            displayName: '读取文件',
            description: '读取项目内文件内容。',
          },
          {
            toolId: 'blackboard.course_catalog.search',
            kind: 'contract',
            availability: 'available',
            displayName: '课程目录搜索',
            description: '搜索 Blackboard 课程目录',
          },
        ],
      })),
    }

    const api = createElectronToolCatalogMainProcess({ service })

    await expect(api.loadToolCatalog()).resolves.toEqual({
      ok: true,
      directoryVersion: 'tools-v1',
      tools: [
        {
          toolId: 'tool.fs.read',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容。',
        },
        {
          toolId: 'blackboard.course_catalog.search',
          kind: 'contract',
          availability: 'available',
          displayName: '课程目录搜索',
          description: '搜索 Blackboard 课程目录',
        },
      ],
    })
    expect(service.load).toHaveBeenCalledOnce()
  })
})
