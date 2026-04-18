import { describe, expect, it, vi } from 'vitest'

import { createElectronToolCatalogMainProcess } from './main-process'

describe('createElectronToolCatalogMainProcess', () => {
  it('delegates catalog loading to the configured service', async () => {
    const service = {
      load: vi.fn(async () => ({
        ok: true as const,
        tools: [
          {
            toolId: 'tool.file-convert',
            kind: 'builtin',
            availability: 'available',
            displayName: '文件转换',
            description: 'DOCX/PDF/PPTX 转换工具',
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
      tools: [
        {
          toolId: 'tool.file-convert',
          kind: 'builtin',
          availability: 'available',
          displayName: '文件转换',
          description: 'DOCX/PDF/PPTX 转换工具',
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
