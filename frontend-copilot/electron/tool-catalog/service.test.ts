import { describe, expect, it, vi } from 'vitest'

import type { ConfigCenterPublicSnapshot } from '../config-center/public-snapshot'
import { createElectronToolCatalogService } from './service'

describe('createElectronToolCatalogService', () => {
  it('loads the global tool catalog through the hosted backend runtime endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        directoryVersion: 'tools-v1',
        defaultToolset: 'default',
        language: 'en-US',
        tools: [
          {
            toolId: 'tool.fs.read',
            kind: 'builtin',
            availability: 'available',
            displayName: 'Read File',
            description: 'Read file content from the current workspace.',
            displayNameZh: '读取文件',
            displayNameEn: 'Read File',
            descriptionZh: '读取当前工作区内文件内容。',
            descriptionEn: 'Read file content from the current workspace.',
            group: {
              id: 'workspace',
              label: 'Workspace Tools',
              labelZh: '项目内工具',
              labelEn: 'Workspace Tools',
              order: 0,
              sourceKind: 'workspace',
            },
          },
          {
            toolId: 'blackboard.course_catalog.search',
            kind: 'contract',
            availability: 'available',
            displayName: 'Course Catalog Search',
            description: 'Search Blackboard course catalog.',
            displayNameZh: '课程目录搜索',
            displayNameEn: 'Course Catalog Search',
            descriptionZh: '搜索 Blackboard 课程目录。',
            descriptionEn: 'Search Blackboard course catalog.',
            group: {
              id: 'workspace',
              label: 'Workspace Tools',
              labelZh: '项目内工具',
              labelEn: 'Workspace Tools',
              order: 0,
              sourceKind: 'workspace',
            },
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => 'runtime-token'),
    }
    const publicSnapshot: ConfigCenterPublicSnapshot = {
      version: 1,
      domains: {
        frontendPreferences: {
          theme: 'dark',
          animationsEnabled: true,
        },
        assistantBehavior: {
          agentName: 'planner',
          debugModeEnabled: false,
        },
        hostConfig: {
          runtimeUrl: 'http://127.0.0.1:8765',
        },
        backendExposed: {
          model: 'qwen-plus',
        },
        general: {
          language: 'en-US',
        },
      },
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => publicSnapshot),
    })

    await expect(service.load()).resolves.toEqual({
      ok: true,
      directoryVersion: 'tools-v1',
      language: 'en-US',
      tools: [
        {
          toolId: 'tool.fs.read',
          kind: 'builtin',
          availability: 'available',
          displayName: 'Read File',
          description: 'Read file content from the current workspace.',
          displayNameZh: '读取文件',
          displayNameEn: 'Read File',
          descriptionZh: '读取当前工作区内文件内容。',
          descriptionEn: 'Read file content from the current workspace.',
          group: {
            id: 'workspace',
            label: 'Workspace Tools',
            labelZh: '项目内工具',
            labelEn: 'Workspace Tools',
            order: 0,
            sourceKind: 'workspace',
          },
        },
        {
          toolId: 'blackboard.course_catalog.search',
          kind: 'contract',
          availability: 'available',
          displayName: 'Course Catalog Search',
          description: 'Search Blackboard course catalog.',
          displayNameZh: '课程目录搜索',
          displayNameEn: 'Course Catalog Search',
          descriptionZh: '搜索 Blackboard 课程目录。',
          descriptionEn: 'Search Blackboard course catalog.',
          group: {
            id: 'workspace',
            label: 'Workspace Tools',
            labelZh: '项目内工具',
            labelEn: 'Workspace Tools',
            order: 0,
            sourceKind: 'workspace',
          },
        },
      ],
    })

    expect(hostedBackendService.start).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({
        method: 'tools/catalog/get',
        body: {
          language: 'en-US',
        },
      }),
    })
    const firstCall = (fetchMock.mock.calls as unknown as Array<[string, RequestInit | undefined]>)[0]
    const headers = firstCall?.[1]?.headers as Headers | undefined
    expect(headers).toBeDefined()
    expect(headers!.get('Content-Type')).toBe('application/json')
    expect(headers!.get('X-Local-Token')).toBe('runtime-token')
  })

  it('returns a structured failure when the hosted backend responds with an invalid payload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ ok: true, tools: [42] }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => null),
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => null),
    })

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: 'Hosted backend returned an invalid global tool catalog payload.',
    })
  })

  it('keeps valid mcp tool entries when the hosted backend catalog mixes in an invalid record', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        directoryVersion: 'tools-v-mixed',
        defaultToolset: 'default',
        language: 'zh-CN',
        tools: [
          {
            toolId: 'mcp--fetch--fetch',
            kind: 'external',
            availability: 'available',
            displayName: '联网抓取',
            description: '抓取网页内容。',
            group: {
              id: 'mcp',
              label: 'MCP 工具',
              labelZh: 'MCP 工具',
              labelEn: 'MCP Tools',
              order: 100,
              sourceKind: 'mcp-server',
            },
          },
          {
            toolId: 42,
            kind: 'external',
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => null),
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => null),
    })

    await expect(service.load()).resolves.toEqual({
      ok: true,
      directoryVersion: 'tools-v-mixed',
      language: 'zh-CN',
      warnings: ['Hosted backend returned incomplete tool catalog entries. Invalid entries were dropped. Dropped 1 entry.'],
      tools: [
        {
          toolId: 'mcp--fetch--fetch',
          kind: 'external',
          availability: 'available',
          displayName: '联网抓取',
          description: '抓取网页内容。',
          group: {
            id: 'mcp',
            label: 'MCP 工具',
            labelZh: 'MCP 工具',
            labelEn: 'MCP Tools',
            order: 100,
            sourceKind: 'mcp-server',
          },
        },
      ],
    })
  })

  it.each([
    {
      name: 'directoryVersion is missing',
      payload: {
        ok: true,
        defaultToolset: 'default',
        language: 'en-US',
        tools: [],
      },
    },
    {
      name: 'directoryVersion is blank',
      payload: {
        ok: true,
        directoryVersion: '   ',
        defaultToolset: 'default',
        language: 'en-US',
        tools: [],
      },
    },
    {
      name: 'directoryVersion is not a string',
      payload: {
        ok: true,
        directoryVersion: 42,
        defaultToolset: 'default',
        language: 'en-US',
        tools: [],
      },
    },
    {
      name: 'tools is not an array',
      payload: {
        ok: true,
        directoryVersion: 'tools-v1',
        defaultToolset: 'default',
        language: 'en-US',
        tools: null,
      },
    },
  ])('returns a structured failure when $name', async ({ payload }) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => payload,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => null),
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => null),
    })

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: 'Hosted backend returned an invalid global tool catalog payload.',
    })
  })

  it('falls back to an empty-state failure when the hosted backend runtime URL is unavailable', async () => {
    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => null),
      getLocalToken: vi.fn(() => 'runtime-token'),
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => null),
    })

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: 'Hosted backend runtime URL is unavailable.',
    })
  })

  it('treats an empty hosted backend catalog as a structured failure', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        directoryVersion: 'tools-v1',
        defaultToolset: 'default',
        language: 'zh-CN',
        tools: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      start: vi.fn(async () => undefined),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => null),
    }
    const service = createElectronToolCatalogService({
      ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
      getLocalToken: vi.fn(async () => null),
      loadConfigCenterPublicSnapshot: vi.fn(async () => null),
    })

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: 'Hosted backend returned an empty global tool catalog.',
    })
  })
})
