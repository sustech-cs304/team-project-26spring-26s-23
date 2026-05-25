/* eslint-disable max-lines-per-function, sonarjs/no-duplicate-string */
import { describe, expect, it, vi } from 'vitest'

import type { ConfigCenterPublicSnapshot } from '../config-center/public-snapshot'
import { createElectronToolCatalogService } from './service'

const RUNTIME_URL = 'http://127.0.0.1:8765'
const INVALID_PAYLOAD_MSG = 'Hosted backend returned an invalid global tool catalog payload.'
const LANG_EN = 'en-US'
const DEFAULT_TOOLSET = 'default'
const WORKSPACE_GROUP = {
  id: 'workspace',
  label: 'Workspace Tools',
  labelZh: '项目内工具',
  labelEn: 'Workspace Tools',
  order: 0,
  sourceKind: 'workspace',
} as const

function createHostedBackendStub(overrides?: {
  getRuntimeBaseUrl?: () => string | null
  getLocalToken?: () => string | null
}) {
  return {
    start: vi.fn(async () => undefined),
    getRuntimeBaseUrl: vi.fn(overrides?.getRuntimeBaseUrl ?? (() => RUNTIME_URL)),
    getLocalToken: vi.fn(overrides?.getLocalToken ?? (() => null)),
  }
}

function createService(
  hostedBackendService: ReturnType<typeof createHostedBackendStub>,
  overrides?: {
    loadConfigCenterPublicSnapshot?: () => Promise<ConfigCenterPublicSnapshot | null>
  },
) {
  return createElectronToolCatalogService({
    ensureHostedBackendService: vi.fn(async () => hostedBackendService as never),
    getLocalToken: vi.fn(async () => null),
    loadConfigCenterPublicSnapshot: vi.fn(overrides?.loadConfigCenterPublicSnapshot ?? (async () => null)),
  })
}

describe('createElectronToolCatalogService', () => {
  it('loads the global tool catalog through the hosted backend runtime endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        ok: true,
        directoryVersion: 'tools-v1',
        defaultToolset: DEFAULT_TOOLSET,
        language: LANG_EN,
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
            group: WORKSPACE_GROUP,
          },
          {
            toolId: 'blackboard.snapshot.sync',
            kind: 'contract',
            availability: 'available',
            displayName: 'Snapshot Sync',
            description: 'Sync all Blackboard course data.',
            displayNameZh: '数据全量同步',
            displayNameEn: 'Snapshot Sync',
            descriptionZh: '从 Blackboard 拉取所有已选课程数据并同步到本地数据库。',
            descriptionEn: 'Sync all selected Blackboard course data to local database.',
            group: WORKSPACE_GROUP,
          },
        ],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendStub({ getLocalToken: () => 'runtime-token' })
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
          runtimeUrl: RUNTIME_URL,
        },
        backendExposed: {
          model: 'qwen-plus',
        },
        general: {
          language: LANG_EN,
        },
      },
    }
    const service = createService(hostedBackendService, {
      loadConfigCenterPublicSnapshot: async () => publicSnapshot,
    })

    await expect(service.load()).resolves.toEqual({
      ok: true,
      directoryVersion: 'tools-v1',
      language: LANG_EN,
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
          group: WORKSPACE_GROUP,
        },
        {
          toolId: 'blackboard.snapshot.sync',
          kind: 'contract',
          availability: 'available',
          displayName: 'Snapshot Sync',
          description: 'Sync all Blackboard course data.',
          displayNameZh: '数据全量同步',
          displayNameEn: 'Snapshot Sync',
          descriptionZh: '从 Blackboard 拉取所有已选课程数据并同步到本地数据库。',
          descriptionEn: 'Sync all selected Blackboard course data to local database.',
          group: WORKSPACE_GROUP,
        },
      ],
    })

    expect(hostedBackendService.start).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(`${RUNTIME_URL}/`, {
      method: 'POST',
      headers: expect.any(Headers),
      body: JSON.stringify({
        method: 'tools/catalog/get',
        body: {
          language: LANG_EN,
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

    const hostedBackendService = createHostedBackendStub()
    const service = createService(hostedBackendService)

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: INVALID_PAYLOAD_MSG,
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
        defaultToolset: DEFAULT_TOOLSET,
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

    const hostedBackendService = createHostedBackendStub()
    const service = createService(hostedBackendService)

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
        defaultToolset: DEFAULT_TOOLSET,
        language: LANG_EN,
        tools: [],
      },
    },
    {
      name: 'directoryVersion is blank',
      payload: {
        ok: true,
        directoryVersion: '   ',
        defaultToolset: DEFAULT_TOOLSET,
        language: LANG_EN,
        tools: [],
      },
    },
    {
      name: 'directoryVersion is not a string',
      payload: {
        ok: true,
        directoryVersion: 42,
        defaultToolset: DEFAULT_TOOLSET,
        language: LANG_EN,
        tools: [],
      },
    },
    {
      name: 'tools is not an array',
      payload: {
        ok: true,
        directoryVersion: 'tools-v1',
        defaultToolset: DEFAULT_TOOLSET,
        language: LANG_EN,
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

    const hostedBackendService = createHostedBackendStub()
    const service = createService(hostedBackendService)

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: INVALID_PAYLOAD_MSG,
    })
  })

  it('falls back to an empty-state failure when the hosted backend runtime URL is unavailable', async () => {
    const hostedBackendService = createHostedBackendStub({ getRuntimeBaseUrl: () => null, getLocalToken: () => 'runtime-token' })
    const service = createService(hostedBackendService)

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
        defaultToolset: DEFAULT_TOOLSET,
        language: 'zh-CN',
        tools: [],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = createHostedBackendStub()
    const service = createService(hostedBackendService)

    await expect(service.load()).resolves.toEqual({
      ok: false,
      error: 'Hosted backend returned an empty global tool catalog.',
    })
  })
})
