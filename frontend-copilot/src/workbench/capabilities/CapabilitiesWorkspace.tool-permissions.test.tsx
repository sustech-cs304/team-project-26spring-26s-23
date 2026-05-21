/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'

import type {
  McpDeleteServerResult,
  McpRefreshCatalogResult,
  McpRegistryLoadResult,
  McpSaveServerResult,
  McpSetServerEnabledResult,
  McpTestConnectionResult,
} from '../../../electron/mcp-registry/ipc'
import type { ManagedRuntimeLoadResponse } from '../../../electron/managed-runtime/ipc'
import type {
  SkillDeleteResult,
  SkillImportResult,
  SkillRefreshResult,
  SkillSelectAndImportResult,
  SkillRegistryLoadResult,
  SkillSetEnabledResult,
} from '../../../electron/skill-registry/ipc'
import type {
  McpRegistrySubscriptionEvent,
  McpServerDraft,
  McpServerRecord,
  McpServerStateSummary,
} from '../../../electron/mcp-registry/types'
import type { SkillRecord, SkillRegistrySubscriptionEvent } from '../../../electron/skill-registry/types'
import type { ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'
import type { RuntimeToolDirectoryEntry } from '../../features/copilot/chat-contract'

import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import {
  createManagedRuntimeLoadResultFixture,
  createMcpDeleteServerSuccessFixture,
  createMcpRegistryLoadResultFixture,
  createMcpSaveServerSuccessFixture,
  createMcpSetServerEnabledSuccessFixture,
  createMcpStdioStubServerFixture,
  createMcpTestConnectionSuccessFixture,
  createSkillRecordFixture,
} from '../../../electron/renderer-ipc.test-support'
import {
  clickElement,
  renderWithRoot,
  setFormControlValue,
  waitForNextFrame,
} from '../settings/test-support/SettingsWorkspaceTestSupport'
import {
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { createPersistedWorkspaceState } from '../settings/test-support/SettingsWorkspaceTestSupport'
import { CapabilitiesWorkspace } from './CapabilitiesWorkspace'
import { loadToolCatalog } from './tool-catalog'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_003 = '新增 MCP 服务器'
const DESC_CN_009 = 'Blackboard 工具'
const DESC_CN_011 = '读取项目内文件内容，用于理解上下文与定位实现细节。'
const DESC_CN_013 = '从标准 MCP 配置导入'
const DESC_CN_016 = 'textarea[aria-label="标准 MCP JSON"]'
const DESC_CN_018 = 'input[aria-label="超时秒数"]'
const LABEL_2026_17T00 = '2026-04-17T00:00:00.000Z'
const LABEL_2026_21T12 = '2026-04-21T12:00:00.000Z'
const LABEL_BUILTIN_CORE = 'builtin-core'
const LABEL_BUILT_CORE = 'Built-in Core Tools'
const LABEL_FILESYSTEM_MCP = 'Filesystem MCP'
const LABEL_MCP_SERVER = 'mcp-server'
const LABEL_MCP_SERVERS = 'mcp-servers'
const LABEL_STDIO_STUB_SERVER = 'stdio stub server'
const LABEL_TOOL_READ = 'tool.fs.read'
const SELECTOR_ROLE_DIALOG = '[role="dialog"]'
const SELECTOR_TOOL_PERMISSION_GROUP = '.tool-permission-group'
const SELECTOR_TOOL_PERMISSION_ROW = '.tool-permission-row'


vi.mock('../settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(),
  saveSettingsWorkspaceState: vi.fn(),
}))

vi.mock('./tool-catalog', () => ({
  loadToolCatalog: vi.fn(),
}))

const mockedLoadSettingsWorkspaceState = vi.mocked(loadSettingsWorkspaceState)
const mockedSaveSettingsWorkspaceState = vi.mocked(saveSettingsWorkspaceState)
const mockedLoadToolCatalog = vi.mocked(loadToolCatalog)
const mockedLoadMcpRegistry = vi.fn<(request?: { language?: string | null, includeDisabled?: boolean }) => Promise<McpRegistryLoadResult>>()
const mockedLoadManagedRuntime = vi.fn<() => Promise<ManagedRuntimeLoadResponse>>()
const mockedInstallOrRepairManagedRuntime = vi.fn<(reason?: 'install' | 'repair') => Promise<ManagedRuntimeLoadResponse>>()
const mockedSaveMcpServer = vi.fn<(draft: McpServerDraft) => Promise<McpSaveServerResult>>()
const mockedDeleteMcpServer = vi.fn<(serverId: string) => Promise<McpDeleteServerResult>>()
const mockedSetMcpServerEnabled = vi.fn<
  (request: { serverId: string, enabled: boolean }) => Promise<McpSetServerEnabledResult>
>()
const mockedTestMcpConnection = vi.fn<
  (request: { serverId?: string, draft?: McpServerDraft }) => Promise<McpTestConnectionResult>
>()
const mockedRefreshMcpCatalog = vi.fn<
  (request?: { serverId?: string | null }) => Promise<McpRefreshCatalogResult>
>()
const mockedSubscribeMcpRegistry = vi.fn<(listener: (event: McpRegistrySubscriptionEvent) => void) => () => void>()
const mockedLoadSkillRegistry = vi.fn<(request?: { includeDisabled?: boolean }) => Promise<SkillRegistryLoadResult>>()
const mockedImportSkill = vi.fn<(request: { sourceDirectory: string, enabled?: boolean }) => Promise<SkillImportResult>>()
const mockedSelectAndImportSkill = vi.fn<() => Promise<SkillSelectAndImportResult>>()
const mockedDeleteSkill = vi.fn<(skillId: string) => Promise<SkillDeleteResult>>()
const mockedSetSkillEnabled = vi.fn<(request: { skillId: string, enabled: boolean }) => Promise<SkillSetEnabledResult>>()
const mockedRefreshSkills = vi.fn<(request?: { skillId?: string | null }) => Promise<SkillRefreshResult>>()
const mockedSubscribeSkillRegistry = vi.fn<(listener: (event: SkillRegistrySubscriptionEvent) => void) => () => void>()
const connectedStdioServer = createMcpStdioStubServerFixture()
const connectedStdioState = createSavedMcpServerState(connectedStdioServer, {
  connectionState: 'connected',
  toolCount: 1,
  lastHandshakeAt: LABEL_2026_21T12,
  lastCatalogSyncAt: LABEL_2026_21T12,
})

let activeMcpRegistryListener: ((event: McpRegistrySubscriptionEvent) => void) | null = null
let activeSkillRegistryListener: ((event: SkillRegistrySubscriptionEvent) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  activeMcpRegistryListener = null
  activeSkillRegistryListener = null

  mockedLoadMcpRegistry.mockResolvedValue(createMcpRegistryLoadResultFixture())
  mockedLoadManagedRuntime.mockResolvedValue(createManagedRuntimeLoadResultFixture())
  mockedInstallOrRepairManagedRuntime.mockResolvedValue(createManagedRuntimeLoadResultFixture())
  mockedSaveMcpServer.mockResolvedValue(createMcpSaveServerSuccessFixture())
  mockedDeleteMcpServer.mockResolvedValue(createMcpDeleteServerSuccessFixture())
  mockedSetMcpServerEnabled.mockResolvedValue(createMcpSetServerEnabledSuccessFixture(false))
  mockedTestMcpConnection.mockResolvedValue(createMcpTestConnectionSuccessFixture('stdio'))
  mockedRefreshMcpCatalog.mockResolvedValue({
    ok: true,
    registryRevision: 6,
    snapshotRevision: 10,
    refreshedServerIds: ['mcp-stdio-stub'],
    results: [{
      serverId: 'mcp-stdio-stub',
      toolCount: 1,
      connectionState: 'connected',
      error: null,
    }],
  })
  mockedSubscribeMcpRegistry.mockImplementation((listener) => {
    activeMcpRegistryListener = listener
    return () => {
      if (activeMcpRegistryListener === listener) {
        activeMcpRegistryListener = null
      }
    }
  })
  mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture())
  mockedImportSkill.mockResolvedValue(createSkillImportResultFixture())
  mockedSelectAndImportSkill.mockResolvedValue(createSkillImportResultFixture())
  mockedDeleteSkill.mockResolvedValue(createSkillDeleteResultFixture())
  mockedSetSkillEnabled.mockResolvedValue(createSkillSetEnabledResultFixture(false))
  mockedRefreshSkills.mockResolvedValue(createSkillRefreshResultFixture())
  mockedSubscribeSkillRegistry.mockImplementation((listener) => {
    activeSkillRegistryListener = listener
    return () => {
      if (activeSkillRegistryListener === listener) {
        activeSkillRegistryListener = null
      }
    }
  })

  Object.defineProperty(window, 'mcpRegistry', {
    configurable: true,
    writable: true,
    value: {
      loadRegistry: mockedLoadMcpRegistry,
      saveServer: mockedSaveMcpServer,
      deleteServer: mockedDeleteMcpServer,
      setServerEnabled: mockedSetMcpServerEnabled,
      testConnection: mockedTestMcpConnection,
      refreshCatalog: mockedRefreshMcpCatalog,
    },
  })

  Object.defineProperty(window, 'mcpRegistrySubscription', {
    configurable: true,
    writable: true,
    value: {
      subscribe: mockedSubscribeMcpRegistry,
    },
  })

  Object.defineProperty(window, 'skillRegistry', {
    configurable: true,
    writable: true,
    value: {
      loadRegistry: mockedLoadSkillRegistry,
      importSkill: mockedImportSkill,
      selectAndImportSkill: mockedSelectAndImportSkill,
      deleteSkill: mockedDeleteSkill,
      setSkillEnabled: mockedSetSkillEnabled,
      refreshSkills: mockedRefreshSkills,
    },
  })

  Object.defineProperty(window, 'skillRegistrySubscription', {
    configurable: true,
    writable: true,
    value: {
      subscribe: mockedSubscribeSkillRegistry,
    },
  })

  Object.defineProperty(window, 'managedRuntime', {
    configurable: true,
    writable: true,
    value: {
      load: mockedLoadManagedRuntime,
      installOrRepair: mockedInstallOrRepairManagedRuntime,
    },
  })
})

function getNavButton(container: ParentNode, sectionId: 'tool-permissions' | typeof LABEL_MCP_SERVERS | 'skills'): HTMLButtonElement {
  const expectedId = `capabilities-tab-${sectionId}`
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((element) => {
    return element.id === expectedId
  })

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing capabilities nav button for section=${sectionId}`)
  }

  return button
}

function getExactButton(container: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((element) => {
    return element.textContent?.trim() === text
  })

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing button with text=${text}`)
  }

  return button
}

function getToolRow(container: ParentNode, toolName: string): HTMLElement {
  const heading = Array.from(container.querySelectorAll<HTMLElement>('.tool-permission-row__name')).find((element) => {
    return element.textContent?.trim() === toolName
  })
  const row = heading?.closest(SELECTOR_TOOL_PERMISSION_ROW)

  if (!(row instanceof HTMLElement)) {
    throw new Error(`Missing tool permission row for tool=${toolName}`)
  }

  return row
}

function queryServerRow(container: ParentNode, serverName: string): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll<HTMLElement>('.mcp-server-row__title')).find((element) => {
    return element.textContent?.trim() === serverName
  })

  const row = heading?.closest('.mcp-server-row')
  return row instanceof HTMLElement ? row : null
}

function getServerRow(container: ParentNode, serverName: string): HTMLElement {
  const row = queryServerRow(container, serverName)

  if (row === null) {
    throw new Error(`Missing MCP server row for server=${serverName}`)
  }

  return row
}

function getDialog(container: ParentNode): HTMLElement {
  const dialog = container.querySelector(SELECTOR_ROLE_DIALOG)

  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing MCP editor dialog')
  }

  return dialog
}

function createSavedMcpServerState(
  server: McpServerRecord,
  overrides: Partial<McpServerStateSummary> = {},
): McpServerStateSummary {
  return {
    serverId: server.serverId,
    enabled: server.enabled,
    connectionState: server.enabled ? 'idle' : 'disabled',
    toolCount: 0,
    lastHandshakeAt: null,
    lastCatalogSyncAt: null,
    lastError: null,
    reconnectAttempt: 0,
    transportState: server.transportConfig.kind === 'stdio'
      ? {
          kind: 'stdio',
          processStatus: 'stopped',
          pid: null,
          lastExitCode: null,
          lastExitSignal: null,
        }
      : {
          kind: 'http-sse',
          endpointStatus: 'offline',
          lastHttpStatus: null,
          sseOnline: false,
        },
    ...overrides,
  }
}

function createLoadResult() {
  return {
    ok: true as const,
    source: 'stored' as const,
    state: createPersistedWorkspaceState({
      providerProfiles: [
        {
          ...createPersistedWorkspaceState().providerProfiles[0],
          id: 'openrouter',
          profileId: 'openrouter',
          name: 'Persisted Router',
          displayName: 'Persisted Router',
        },
      ],
      general: {
        language: 'en-US',
      },
      mcp: {
        toolPermissionMode: 'manual',
        toolPermissionPolicy: {
          version: 1,
          migrationSourceMode: 'manual',
          defaultMode: 'ask',
          toolPermissions: {
            [LABEL_TOOL_READ]: {
              mode: 'allow',
              source: 'user',
              updatedAt: '2026-04-17T04:00:00.000Z',
            },
            'mcp--fetch--fetch': {
              mode: 'deny',
              source: 'user',
              updatedAt: '2026-04-17T04:05:00.000Z',
            },
          },
        },
      },
    }),
  }
}

function createSkillRegistryLoadResultFixture(
  overrides: Partial<Extract<SkillRegistryLoadResult, { ok: true }>> = {},
): SkillRegistryLoadResult {
  return {
    ok: true,
    registryRevision: 3,
    snapshotRevision: 5,
    skills: [createSkillRecordFixture()],
    ...overrides,
  }
}

function createSkillImportResultFixture(
  overrides: Partial<Extract<SkillImportResult, { ok: true }>> = {},
): SkillImportResult {
  const skill = createSkillRecordFixture()
  return {
    ok: true,
    registryRevision: 4,
    snapshotRevision: 6,
    skill,
    validationErrors: [],
    ...overrides,
  }
}

function createSkillDeleteResultFixture(
  skillId = createSkillRecordFixture().skillId,
): SkillDeleteResult {
  return {
    ok: true,
    registryRevision: 5,
    snapshotRevision: 7,
    skillId,
    deleted: true,
  }
}

function createSkillSetEnabledResultFixture(enabled: boolean): SkillSetEnabledResult {
  return {
    ok: true,
    registryRevision: 6,
    snapshotRevision: 8,
    skill: createSkillRecordFixture({ enabled }),
  }
}

function createSkillRefreshResultFixture(
  skill: SkillRecord = createSkillRecordFixture(),
): SkillRefreshResult {
  return {
    ok: true,
    registryRevision: 7,
    snapshotRevision: 9,
    refreshedSkillIds: [skill.skillId],
    results: [{
      skillId: skill.skillId,
      status: skill.validation.status,
      errors: skill.validation.errors,
      warnings: skill.validation.warnings,
    }],
  }
}

function createToolCatalogLoadResult(
  overrides: Partial<Extract<ToolCatalogLoadResult, { ok: true }>> = {},
): ToolCatalogLoadResult {
  return {
    ok: true,
    directoryVersion: 'tools-v1',
    tools: [
      {
        toolId: LABEL_TOOL_READ,
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: DESC_CN_011,
        group: {
          id: LABEL_BUILTIN_CORE,
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: LABEL_BUILT_CORE,
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'tool.fs.write',
        kind: 'builtin',
        availability: 'available',
        displayName: '写入文件',
        description: '创建或覆盖文件内容，用于输出生成结果与落盘修改。',
        group: {
          id: LABEL_BUILTIN_CORE,
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: LABEL_BUILT_CORE,
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'tool.fs.edit',
        kind: 'builtin',
        availability: 'available',
        displayName: '编辑文件',
        description: '对现有文件执行精确编辑，适用于补丁式修改与小范围更新。',
        group: {
          id: LABEL_BUILTIN_CORE,
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: LABEL_BUILT_CORE,
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'mcp--fetch--fetch',
        kind: 'external',
        availability: 'available',
        displayName: '联网抓取',
        description: '抓取网页内容，用于补充外部说明与页面上下文。',
        group: {
          id: 'mcp',
          label: 'MCP 工具',
          labelZh: 'MCP 工具',
          labelEn: 'MCP Tools',
          order: 100,
          sourceKind: LABEL_MCP_SERVER,
        },
      },
      {
        toolId: 'mcp--puppeteer--puppeteer_navigate',
        kind: 'external',
        availability: 'available',
        displayName: '浏览器自动化',
        description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
        group: {
          id: 'mcp',
          label: 'MCP 工具',
          labelZh: 'MCP 工具',
          labelEn: 'MCP Tools',
          order: 100,
          sourceKind: LABEL_MCP_SERVER,
        },
      },
    ],
    ...overrides,
  }
}

function createDynamicMcpGroupCatalogLoadResult(): ToolCatalogLoadResult {
  return {
    ok: true,
    directoryVersion: 'tools-v2',
    tools: [
      {
        toolId: LABEL_TOOL_READ,
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: DESC_CN_011,
        group: {
          id: LABEL_BUILTIN_CORE,
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: LABEL_BUILT_CORE,
          order: 0,
          sourceKind: 'builtin',
        },
      },
      {
        toolId: 'blackboard.course_catalog.search',
        kind: 'contract',
        availability: 'available',
        displayName: '课程目录搜索',
        description: '搜索 Blackboard 课程目录。',
        group: {
          id: 'blackboard',
          label: DESC_CN_009,
          labelZh: DESC_CN_009,
          labelEn: 'Blackboard Tools',
          order: 10,
          sourceKind: 'sustech-blackboard',
        },
      },
      {
        toolId: 'tis.personal_grades.fetch',
        kind: 'contract',
        availability: 'available',
        displayName: '成绩查询',
        description: '读取教学系统个人成绩。',
        group: {
          id: 'tis',
          label: 'TIS 工具',
          labelZh: 'TIS 工具',
          labelEn: 'TIS Tools',
          order: 20,
          sourceKind: 'sustech-tis',
        },
      },
      {
        toolId: 'mcp__filesystem__read_text_file',
        kind: 'external',
        availability: 'available',
        displayName: '读取文本文件',
        description: '通过 filesystem 服务器读取文本文件。',
        group: {
          id: 'mcp.server.filesystem',
          label: LABEL_FILESYSTEM_MCP,
          labelZh: LABEL_FILESYSTEM_MCP,
          labelEn: LABEL_FILESYSTEM_MCP,
          order: 100,
          sourceKind: LABEL_MCP_SERVER,
        },
      },
    ],
  }
}

// Duplicate-string constants extracted for sonarjs/no-duplicate-string (continued)

// eslint-disable-next-line max-lines-per-function
describe('CapabilitiesWorkspace', () => {
  // eslint-disable-next-line max-lines-per-function
  describe('tool permissions', () => {
    // eslint-disable-next-line max-lines-per-function
    describe('tool catalog reload after registry events', () => {
      it('applies registry snapshot subscriptions and reloads the tool catalog when snapshotRevision changes', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        if (activeMcpRegistryListener === null) {
          throw new Error('Expected MCP registry subscription listener to be registered.')
        }

        await act(async () => {
          activeMcpRegistryListener?.({
            kind: 'snapshot',
            registryRevision: 7,
            snapshotRevision: 11,
            servers: [connectedStdioServer],
            states: [connectedStdioState],
          })
          await Promise.resolve()
        })

        await waitForNextFrame()
        await waitForNextFrame()
        await clickElement(getNavButton(rendered.container, LABEL_MCP_SERVERS))

        expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
        expect(getServerRow(rendered.container, LABEL_STDIO_STUB_SERVER).textContent).toContain('已就绪')
        expect(getServerRow(rendered.container, LABEL_STDIO_STUB_SERVER).textContent).toContain('2026-04-21 12:00:00Z')

        rendered.unmount()
        expect(activeMcpRegistryListener).toBeNull()
      })

      it('reloads the tool catalog after a snapshot event and automatically shows new MCP tools in permissions without manual refresh', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog
          .mockResolvedValueOnce(createToolCatalogLoadResult({ directoryVersion: 'tools-v1' }))
          .mockResolvedValueOnce(createDynamicMcpGroupCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        if (activeMcpRegistryListener === null) {
          throw new Error('Expected MCP registry subscription listener to be registered.')
        }

        await act(async () => {
          activeMcpRegistryListener?.({
            kind: 'snapshot',
            registryRevision: 7,
            snapshotRevision: 10,
            servers: [connectedStdioServer],
            states: [connectedStdioState],
          })
          await Promise.resolve()
        })

        await waitForNextFrame()
        await waitForNextFrame()

        expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
        expect(rendered.container.textContent).toContain(LABEL_FILESYSTEM_MCP)
        expect(rendered.container.textContent).toContain('读取文本文件')

        rendered.unmount()
      })

      it('reloads the tool catalog after saving an enabled server without requiring a synthetic snapshot event', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog
          .mockResolvedValueOnce(createToolCatalogLoadResult({ directoryVersion: 'tools-v1' }))
          .mockResolvedValueOnce(createDynamicMcpGroupCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })
        mockedSaveMcpServer.mockResolvedValue(createMcpSaveServerSuccessFixture({
          snapshotRevision: 9,
          server: {
            serverId: 'filesystem',
            displayName: LABEL_FILESYSTEM_MCP,
          },
          state: {
            connectionState: 'connected',
            toolCount: 1,
            lastHandshakeAt: LABEL_2026_21T12,
            lastCatalogSyncAt: LABEL_2026_21T12,
          },
        }))

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()
        await waitForNextFrame()

        await clickElement(getNavButton(document.body, LABEL_MCP_SERVERS))
        await waitForNextFrame()
        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()

        const dialog = getDialog(document.body)
        await clickElement(getExactButton(dialog, DESC_CN_013))

        const textarea = dialog.querySelector(DESC_CN_016) as HTMLTextAreaElement
        await setFormControlValue(textarea, JSON.stringify({
          mcpServers: {
            filesystem: {
              command: 'npx',
              args: ['@modelcontextprotocol/server-filesystem'],
            },
          },
        }, null, 2))
        await clickElement(getExactButton(dialog, '解析配置'))
        await clickElement(getExactButton(dialog, '保存服务器'))

        await waitForNextFrame()
        await waitForNextFrame()

        expect(mockedSaveMcpServer).toHaveBeenCalledWith(expect.objectContaining({
          serverId: 'filesystem',
          displayName: 'filesystem',
          transportConfig: expect.objectContaining({
            kind: 'stdio',
            command: 'npx',
            args: ['@modelcontextprotocol/server-filesystem'],
          }),
        }))
        expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
        expect(mockedLoadToolCatalog.mock.calls).toEqual([
          [null],
          [null],
        ])

        await clickElement(getNavButton(document.body, 'tool-permissions'))
        await waitForNextFrame()

        const tpContainer = rendered.container.querySelector('[aria-label="工具权限列表"]')
        expect(tpContainer).toBeTruthy()
        expect(tpContainer!.closest('[hidden]')).toBeNull()
        expect(tpContainer!.textContent).toContain(LABEL_FILESYSTEM_MCP)
        expect(tpContainer!.textContent).toContain('读取文本文件')

        rendered.unmount()
      })

      it('reloads the tool catalog when the registry publishes a catalog event with a new snapshot revision', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog
          .mockResolvedValueOnce(createToolCatalogLoadResult({ directoryVersion: 'tools-v1' }))
          .mockResolvedValueOnce(createDynamicMcpGroupCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        if (activeMcpRegistryListener === null) {
          throw new Error('Expected MCP registry subscription listener to be registered.')
        }

        await act(async () => {
          activeMcpRegistryListener?.({
            kind: 'catalog',
            registryRevision: 7,
            snapshotRevision: 11,
            serverId: connectedStdioServer.serverId,
            refreshedServerIds: [connectedStdioServer.serverId],
          })
          await Promise.resolve()
        })

        await waitForNextFrame()
        await waitForNextFrame()

        expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
        expect(rendered.container.textContent).toContain(LABEL_FILESYSTEM_MCP)
        expect(rendered.container.textContent).toContain('读取文本文件')

        rendered.unmount()
      })

      it('reloads the tool catalog after a successful connection test without requiring a manual refresh button', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog
          .mockResolvedValueOnce(createToolCatalogLoadResult())
          .mockResolvedValueOnce(createDynamicMcpGroupCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()
        await clickElement(getNavButton(rendered.container, LABEL_MCP_SERVERS))
        await clickElement(getExactButton(getServerRow(rendered.container, LABEL_STDIO_STUB_SERVER), '测试连接'))

        await act(async () => {
          activeMcpRegistryListener?.({
            kind: 'snapshot',
            registryRevision: 8,
            snapshotRevision: 12,
            servers: [connectedStdioServer],
            states: [connectedStdioState],
          })
          await Promise.resolve()
        })

        await waitForNextFrame()
        await waitForNextFrame()
        await clickElement(getNavButton(rendered.container, 'tool-permissions'))

        expect(mockedTestMcpConnection).toHaveBeenCalledWith({ serverId: connectedStdioServer.serverId })
        expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
        expect(rendered.container.textContent).toContain(LABEL_FILESYSTEM_MCP)
        expect(rendered.container.textContent).toContain('读取文本文件')
        expect(rendered.container.textContent).not.toContain('MCP 工具')
        expect(rendered.container.textContent).not.toContain('刷新工具列表')
      })
    })
    describe('catalog fallback', () => {
      it('falls back to a built-in catalog with an explicit status message when loading the runtime tool catalog fails', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue({
          ok: false,
          error: 'Hosted backend runtime URL is unavailable.',
        })
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_ROW).length).toBe(5)
        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_GROUP).length).toBe(2)
        expect(rendered.container.textContent).toContain('Hosted backend runtime tool catalog is temporarily unavailable. Using built-in fallback catalog.')
        expect(rendered.container.textContent).toContain('内置基础工具')
        expect(rendered.container.textContent).toContain('MCP 工具')
        expect(rendered.container.textContent).toContain('读取文件')
        expect(rendered.container.textContent).toContain('联网抓取')

        rendered.unmount()
      })

      it('falls back when the runtime tool catalog returns an incomplete directory', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue({
          ok: true,
          directoryVersion: 'tools-v1',
          tools: [
            {
              toolId: LABEL_TOOL_READ,
              kind: 'builtin',
              availability: 'available',
              displayName: '读取文件',
              description: DESC_CN_011,
            },
            {
              toolId: '',
              kind: 'builtin',
              availability: 'available',
              displayName: null,
              description: '无效工具项。',
            },
          ],
        })
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_ROW).length).toBe(1)
        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_GROUP).length).toBe(1)
        expect(rendered.container.textContent).toContain('Hosted backend returned an incomplete tool catalog. Invalid entries were dropped while keeping valid tools visible.')
        expect(rendered.container.textContent).toContain('读取文件')
        expect(rendered.container.textContent).not.toContain('浏览器自动化')

        rendered.unmount()
      })

      it('keeps valid mcp tools visible when the runtime catalog includes one broken entry', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue({
          ok: true,
          directoryVersion: 'tools-v-mixed-mcp',
          warnings: ['Hosted backend returned incomplete tool catalog entries. Invalid entries were dropped. Dropped 1 entry.'],
          tools: [
            {
              toolId: LABEL_TOOL_READ,
              kind: 'builtin',
              availability: 'available',
              displayName: '读取文件',
              description: DESC_CN_011,
              group: {
                id: LABEL_BUILTIN_CORE,
                label: '内置基础工具',
                labelZh: '内置基础工具',
                labelEn: LABEL_BUILT_CORE,
                order: 0,
                sourceKind: 'builtin',
              },
            },
            {
              toolId: 'mcp.server.filesystem.read_text_file',
              kind: 'external',
              availability: 'available',
              displayName: '读取文本文件',
              description: '从 filesystem MCP 读取文本文件。',
              group: {
                id: 'mcp.server.filesystem',
                label: LABEL_FILESYSTEM_MCP,
                labelZh: LABEL_FILESYSTEM_MCP,
                labelEn: LABEL_FILESYSTEM_MCP,
                order: 100,
                sourceKind: LABEL_MCP_SERVER,
              },
            },
            {
              toolId: '',
              kind: 'external',
              availability: 'available',
              displayName: null,
              description: '无效工具项。',
            },
          ] as RuntimeToolDirectoryEntry[],
        })
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        const groupLabels = Array.from(rendered.container.querySelectorAll('.tool-permission-group__label'))
          .map((element) => element.textContent?.trim())

        expect(rendered.container.textContent).toContain('Hosted backend returned an incomplete tool catalog. Invalid entries were dropped while keeping valid tools visible.')
        expect(rendered.container.textContent).toContain('读取文本文件')
        expect(rendered.container.textContent).toContain(LABEL_FILESYSTEM_MCP)
        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_ROW).length).toBe(2)
        expect(groupLabels).toEqual(['内置基础工具', LABEL_FILESYSTEM_MCP])
        expect(rendered.container.textContent).not.toContain('浏览器自动化')

        rendered.unmount()
      })
    })
    describe('permission policy', () => {
      it('merges and saves tool permission policy updates without dropping unrelated settings fields', async () => {
        const loadResult = createLoadResult()
        mockedLoadSettingsWorkspaceState.mockResolvedValue(loadResult)
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: loadResult.state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        await clickElement(getExactButton(getToolRow(rendered.container, '写入文件'), '总是关闭'))

        expect(mockedSaveSettingsWorkspaceState).toHaveBeenCalledTimes(1)
        const saveInput = mockedSaveSettingsWorkspaceState.mock.calls[0]?.[0] as SettingsWorkspaceStateSaveInput

        expect(saveInput.providerProfiles).toHaveLength(loadResult.state.providerProfiles.length)
        expect(saveInput.providerProfiles[0]?.profileId).toBe('openrouter')
        expect(saveInput.general.language).toBe('en-US')
        expect(saveInput.mcp.toolPermissionMode).toBe('strict')
        expect(saveInput.mcp.toolPermissionPolicy).toEqual({
          version: 1,
            defaultMode: 'deny',
            toolPermissions: {
            [LABEL_TOOL_READ]: {
              mode: 'allow',
              source: 'user',
              updatedAt: LABEL_2026_17T00,
            },
            'tool.fs.edit': {
              mode: 'ask',
              source: 'user',
              updatedAt: LABEL_2026_17T00,
            },
            'mcp--puppeteer--puppeteer_navigate': {
              mode: 'ask',
              source: 'user',
              updatedAt: LABEL_2026_17T00,
            },
          },
        })

        rendered.unmount()
      })

      it('switches segmented approval modes and expands then collapses the delay settings shell', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        expect(getToolRow(rendered.container, '读取文件').className).not.toContain('tool-permission-row--expanded')

        await clickElement(getExactButton(getToolRow(rendered.container, '读取文件'), '延迟处理'))

        const expandedRow = getToolRow(rendered.container, '读取文件')
        const secondsInput = expandedRow.querySelector(DESC_CN_018)

        if (!(secondsInput instanceof HTMLInputElement)) {
          throw new Error('Missing delay seconds input')
        }

        expect(expandedRow.className).toContain('tool-permission-row--expanded')
        expect(expandedRow.querySelector('.tool-permission-segmented')?.className).toContain('tool-permission-segmented--delay')
        expect(expandedRow.querySelector('.tool-permission-delay-shell')?.className).toContain('tool-permission-delay-shell--open')
        expect(getExactButton(expandedRow, '超时自动批准').className).toContain('tool-permission-delay-action--active')

        await clickElement(getExactButton(expandedRow, '超时自动禁止'))

        expect(getExactButton(getToolRow(rendered.container, '读取文件'), '超时自动禁止').className).toContain(
          'tool-permission-delay-action--active',
        )

        await setFormControlValue(
          getToolRow(rendered.container, '读取文件').querySelector(DESC_CN_018) as HTMLInputElement,
          '27',
        )

        expect((getToolRow(rendered.container, '读取文件').querySelector(DESC_CN_018) as HTMLInputElement).value).toBe('27')

        expect(mockedSaveSettingsWorkspaceState).toHaveBeenCalled()
        const lastSaveCall = mockedSaveSettingsWorkspaceState.mock.calls[mockedSaveSettingsWorkspaceState.mock.calls.length - 1]
        const saveInput = lastSaveCall?.[0] as SettingsWorkspaceStateSaveInput
        expect(saveInput.mcp.toolPermissionPolicy.toolPermissions[LABEL_TOOL_READ]).toEqual({
          mode: 'delay',
          timeoutAction: 'deny',
          timeoutSeconds: 27,
          source: 'user',
          updatedAt: LABEL_2026_17T00,
        })

        await clickElement(getExactButton(getToolRow(rendered.container, '读取文件'), '总是关闭'))

        const collapsedRow = getToolRow(rendered.container, '读取文件')
        const collapsedInput = collapsedRow.querySelector(DESC_CN_018)

        if (!(collapsedInput instanceof HTMLInputElement)) {
          throw new Error('Missing collapsed delay seconds input')
        }

        expect(collapsedRow.className).not.toContain('tool-permission-row--expanded')
        expect(collapsedRow.querySelector('.tool-permission-delay-shell')?.className).not.toContain('tool-permission-delay-shell--open')
        expect(collapsedInput.disabled).toBe(true)
        expect(getExactButton(collapsedRow, '超时自动批准').disabled).toBe(true)
        expect(getExactButton(collapsedRow, '超时自动禁止').disabled).toBe(true)

        rendered.unmount()
      })
    })
  })
})
