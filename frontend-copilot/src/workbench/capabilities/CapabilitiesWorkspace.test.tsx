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
  focusElement,
  mockClipboardWriteText,
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
  lastHandshakeAt: '2026-04-21T12:00:00.000Z',
  lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
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

function getNavButton(container: ParentNode, sectionId: 'tool-permissions' | 'mcp-servers' | 'skills'): HTMLButtonElement {
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
  const row = heading?.closest('.tool-permission-row')

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

function querySkillRow(container: ParentNode, skillName: string): HTMLElement | null {
  const heading = Array.from(container.querySelectorAll<HTMLElement>('.skill-row__title')).find((element) => {
    return element.textContent?.trim() === skillName
  })

  const row = heading?.closest('.skill-row')
  return row instanceof HTMLElement ? row : null
}

function getSkillRow(container: ParentNode, skillName: string): HTMLElement {
  const row = querySkillRow(container, skillName)

  if (row === null) {
    throw new Error(`Missing Skill row for skill=${skillName}`)
  }

  return row
}

function getDialog(container: ParentNode): HTMLElement {
  const dialog = container.querySelector('[role="dialog"]')

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
            'tool.fs.read': {
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
        toolId: 'tool.fs.read',
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
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
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
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
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
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
          sourceKind: 'mcp-server',
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
          sourceKind: 'mcp-server',
        },
      },
    ],
    ...overrides,
  }
}

function createHostedCatalogOnlyLoadResult(): ToolCatalogLoadResult {
  return {
    ok: true,
    directoryVersion: 'tools-v1',
    tools: [
      {
        toolId: 'tool.fs.read',
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
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
          label: 'Blackboard 工具',
          labelZh: 'Blackboard 工具',
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
        toolId: 'campus.events.list',
        kind: 'external',
        availability: 'available',
        displayName: '校园活动',
        description: '读取校园活动。',
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
  }
}

function createDynamicMcpGroupCatalogLoadResult(): ToolCatalogLoadResult {
  return {
    ok: true,
    directoryVersion: 'tools-v2',
    tools: [
      {
        toolId: 'tool.fs.read',
        kind: 'builtin',
        availability: 'available',
        displayName: '读取文件',
        description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
        group: {
          id: 'builtin-core',
          label: '内置基础工具',
          labelZh: '内置基础工具',
          labelEn: 'Built-in Core Tools',
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
          label: 'Blackboard 工具',
          labelZh: 'Blackboard 工具',
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
          label: 'Filesystem MCP',
          labelZh: 'Filesystem MCP',
          labelEn: 'Filesystem MCP',
          order: 100,
          sourceKind: 'mcp-server',
        },
      },
    ],
  }
}

describe('CapabilitiesWorkspace', () => {
  it('renders persisted tool permissions and secondary navigation switch with real tool ids', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelector('.capabilities-workspace')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-panel')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main')).toBeTruthy()
    expect(rendered.container.querySelector('.capabilities-main__content')).toBeTruthy()
    expect(rendered.container.querySelector('[aria-label="工具权限列表"]')).toBeTruthy()
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
    expect(rendered.container.textContent).toContain('内置基础工具')
    expect(rendered.container.textContent).toContain('MCP 工具')
    expect(rendered.container.textContent).toContain('能力中心')
    expect(rendered.container.textContent).toContain('工具权限')
    expect(rendered.container.textContent).toContain('读取文件')
    expect(rendered.container.textContent).toContain('写入文件')
    expect(rendered.container.textContent).toContain('浏览器自动化')
    expect(getToolRow(rendered.container, '读取文件').textContent).toContain('tool.fs.read')
    expect(getExactButton(getToolRow(rendered.container, '读取文件'), '自动批准').className).toContain(
      'tool-permission-segmented__item--active',
    )
    expect(getExactButton(getToolRow(rendered.container, '联网抓取'), '总是关闭').className).toContain(
      'tool-permission-segmented__item--active',
    )

    await clickElement(getNavButton(rendered.container, 'mcp-servers'))
    await waitForNextFrame()

    const toolPermissionsList = rendered.container.querySelector('[aria-label="工具权限列表"]')
    expect(toolPermissionsList).toBeTruthy()
    expect(toolPermissionsList!.closest('[hidden]')).toBeTruthy()
    expect(rendered.container.querySelector('.mcp-server-row')).toBeTruthy()
    expect(rendered.container.textContent).toContain('MCP 服务器')
    expect(rendered.container.textContent).toContain('stdio stub server')
    expect(rendered.container.textContent).toContain('http sse stub server')
    expect(rendered.container.textContent).toContain('测试连接')
    expect(rendered.container.textContent).not.toContain('刷新工具列表')
    expect(mockedLoadMcpRegistry).toHaveBeenCalledWith({ includeDisabled: true })
    expect(rendered.container.textContent).toContain('新增 MCP 服务器')
    expect(rendered.container.textContent).not.toContain('录入新的 MCP registry 草稿')

    rendered.unmount()
  })

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
    await clickElement(getNavButton(rendered.container, 'mcp-servers'))

    expect(mockedLoadToolCatalog).toHaveBeenCalledTimes(2)
    expect(getServerRow(rendered.container, 'stdio stub server').textContent).toContain('已就绪')
    expect(getServerRow(rendered.container, 'stdio stub server').textContent).toContain('2026-04-21 12:00:00Z')

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
    expect(rendered.container.textContent).toContain('Filesystem MCP')
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
        displayName: 'Filesystem MCP',
      },
      state: {
        connectionState: 'connected',
        toolCount: 1,
        lastHandshakeAt: '2026-04-21T12:00:00.000Z',
        lastCatalogSyncAt: '2026-04-21T12:00:00.000Z',
      },
    }))

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await waitForNextFrame()

    await clickElement(getNavButton(document.body, 'mcp-servers'))
    await waitForNextFrame()
    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    const dialog = getDialog(document.body)
    await clickElement(getExactButton(dialog, '从标准 MCP 配置导入'))

    const textarea = dialog.querySelector('textarea[aria-label="标准 MCP JSON"]') as HTMLTextAreaElement
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
    expect(tpContainer!.textContent).toContain('Filesystem MCP')
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
    expect(rendered.container.textContent).toContain('Filesystem MCP')
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
    await clickElement(getNavButton(rendered.container, 'mcp-servers'))
    await clickElement(getExactButton(getServerRow(rendered.container, 'stdio stub server'), '测试连接'))

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
    expect(rendered.container.textContent).toContain('Filesystem MCP')
    expect(rendered.container.textContent).toContain('读取文本文件')
    expect(rendered.container.textContent).not.toContain('MCP 工具')
    expect(rendered.container.textContent).not.toContain('刷新工具列表')
  })

  it('renders mixed builtin, blackboard, tis and dynamic MCP groups in runtime order without filtering unknown group ids', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createDynamicMcpGroupCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    const groupLabels = Array.from(rendered.container.querySelectorAll('.tool-permission-group__label'))
      .map((element) => element.textContent?.trim())

    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(4)
    expect(groupLabels).toEqual(['内置基础工具', 'Blackboard 工具', 'TIS 工具', 'Filesystem MCP'])
    expect(rendered.container.textContent).toContain('读取文本文件')
    expect(rendered.container.textContent).toContain('课程目录搜索')
    expect(rendered.container.textContent).toContain('成绩查询')

    rendered.unmount()
  })

  it('renders readable mcp names in permissions view using the same presentation mapping as chat picker', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue({
      ok: true,
      directoryVersion: 'tools-v-readable-mcp',
      tools: [
        {
          toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
          kind: 'external',
          availability: 'available',
          displayName: null,
          description: null,
          serverId: 'mcp-stdio-stub',
          remoteToolName: 'search-campus',
          mcpServerName: 'stdio stub server',
          group: {
            id: 'mcp.server.mcp-stdio-stub',
            label: 'stdio stub server',
            labelZh: 'stdio stub server',
            labelEn: 'stdio stub server',
            order: 100,
            sourceKind: 'mcp-server',
          },
        } as RuntimeToolDirectoryEntry,
      ],
    })
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.textContent).toContain('stdio stub server')
    expect(getToolRow(rendered.container, 'stdio stub server / Search Campus')).toBeTruthy()

    rendered.unmount()
  })

  it('renders hosted backend builtin and contract tools instead of collapsing to the empty state', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createHostedCatalogOnlyLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(4)
    expect(rendered.container.textContent).toContain('课程目录搜索')
    expect(rendered.container.textContent).toContain('成绩查询')
    expect(rendered.container.textContent).toContain('校园活动')
    expect(rendered.container.textContent).not.toContain('尚未从运行时获取到可展示的工具目录。')
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(4)
    expect(rendered.container.textContent).toContain('内置基础工具')
    expect(rendered.container.textContent).toContain('Blackboard 工具')
    expect(rendered.container.textContent).toContain('TIS 工具')
    expect(rendered.container.textContent).toContain('MCP 工具')

    rendered.unmount()
  })

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

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(5)
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(2)
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
          toolId: 'tool.fs.read',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
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

    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(1)
    expect(rendered.container.querySelectorAll('.tool-permission-group').length).toBe(1)
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
          toolId: 'tool.fs.read',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
          group: {
            id: 'builtin-core',
            label: '内置基础工具',
            labelZh: '内置基础工具',
            labelEn: 'Built-in Core Tools',
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
            label: 'Filesystem MCP',
            labelZh: 'Filesystem MCP',
            labelEn: 'Filesystem MCP',
            order: 100,
            sourceKind: 'mcp-server',
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
    expect(rendered.container.textContent).toContain('Filesystem MCP')
    expect(rendered.container.querySelectorAll('.tool-permission-row').length).toBe(2)
    expect(groupLabels).toEqual(['内置基础工具', 'Filesystem MCP'])
    expect(rendered.container.textContent).not.toContain('浏览器自动化')

    rendered.unmount()
  })

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
        'tool.fs.read': {
          mode: 'allow',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
        'tool.fs.edit': {
          mode: 'ask',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
        },
        'mcp--puppeteer--puppeteer_navigate': {
          mode: 'ask',
          source: 'user',
          updatedAt: '2026-04-17T00:00:00.000Z',
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
    const secondsInput = expandedRow.querySelector('input[aria-label="超时秒数"]')

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
      getToolRow(rendered.container, '读取文件').querySelector('input[aria-label="超时秒数"]') as HTMLInputElement,
      '27',
    )

    expect((getToolRow(rendered.container, '读取文件').querySelector('input[aria-label="超时秒数"]') as HTMLInputElement).value).toBe('27')

    expect(mockedSaveSettingsWorkspaceState).toHaveBeenCalled()
    const lastSaveCall = mockedSaveSettingsWorkspaceState.mock.calls[mockedSaveSettingsWorkspaceState.mock.calls.length - 1]
    const saveInput = lastSaveCall?.[0] as SettingsWorkspaceStateSaveInput
    expect(saveInput.mcp.toolPermissionPolicy.toolPermissions['tool.fs.read']).toEqual({
      mode: 'delay',
      timeoutAction: 'deny',
      timeoutSeconds: 27,
      source: 'user',
      updatedAt: '2026-04-17T00:00:00.000Z',
    })

    await clickElement(getExactButton(getToolRow(rendered.container, '读取文件'), '总是关闭'))

    const collapsedRow = getToolRow(rendered.container, '读取文件')
    const collapsedInput = collapsedRow.querySelector('input[aria-label="超时秒数"]')

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

  it('opens the MCP dialog in visual form mode and closes it through cancel, close, and backdrop actions', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    const mcpNavButton = getNavButton(document.body, 'mcp-servers')
    await clickElement(mcpNavButton)
    await waitForNextFrame()
    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    let dialog = getDialog(document.body)
    let nameInput = dialog.querySelector('input[aria-label="服务器名称"]')

    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error('Missing MCP name input')
    }

    expect(dialog.getAttribute('aria-label')).toBe('新增 MCP 服务器')
    expect(dialog.textContent).toContain('可视化表单')
    expect(dialog.textContent).toContain('从标准 MCP 配置导入')
    expect(nameInput.value).toBe('new-server')
    expect(document.activeElement).toBe(nameInput)
    expect(getExactButton(dialog, '取消')).toBeTruthy()
    expect(getExactButton(dialog, '保存服务器')).toBeTruthy()

    await clickElement(getExactButton(dialog, '取消'))

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    dialog = getDialog(document.body)
    nameInput = dialog.querySelector('input[aria-label="服务器名称"]')

    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error('Missing add MCP name input')
    }

    expect(dialog.getAttribute('aria-label')).toBe('新增 MCP 服务器')
    expect(nameInput.value).toBe('new-server')

    const closeButton = dialog.querySelector('button[aria-label="关闭服务器编辑窗口"]')

    if (!(closeButton instanceof HTMLButtonElement)) {
      throw new Error('Missing MCP close button')
    }

    await clickElement(closeButton)

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()
    await clickElement(document.body.querySelector('.capabilities-dialog-backdrop') as HTMLElement)

    expect(document.body.querySelector('[role="dialog"]')).toBeNull()

    rendered.unmount()
  })

  it('toggles, tests, and deletes registry-backed MCP server rows from the panel', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedSaveSettingsWorkspaceState.mockResolvedValue({
      ok: true,
      state: createLoadResult().state,
    })
    const disabledServer = createMcpStdioStubServerFixture({
      displayName: 'stdio stub server',
      enabled: false,
    })
    mockedLoadMcpRegistry.mockResolvedValue({
      ok: true,
      registryRevision: 1,
      snapshotRevision: 0,
      servers: [disabledServer],
      states: [createSavedMcpServerState(disabledServer)],
    })
    mockedSetMcpServerEnabled.mockResolvedValue({
      ok: true,
      registryRevision: 2,
      snapshotRevision: 0,
      server: { ...disabledServer, enabled: true },
      state: createSavedMcpServerState({ ...disabledServer, enabled: true }),
    })
    mockedDeleteMcpServer.mockResolvedValue({
      ok: true,
      registryRevision: 3,
      snapshotRevision: 0,
      serverId: disabledServer.serverId,
      deleted: true,
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    const mcpNavButton = getNavButton(document.body, 'mcp-servers')
    await clickElement(mcpNavButton)
    await waitForNextFrame()
    await waitForNextFrame()

    expect(getServerRow(document.body, 'stdio stub server')).toBeTruthy()

    const enableToggle = getServerRow(document.body, 'stdio stub server').querySelector('.mcp-server-toggle')

    if (!(enableToggle instanceof HTMLButtonElement)) {
      throw new Error('Missing stdio stub server toggle')
    }

    await clickElement(enableToggle)

    expect(mockedSetMcpServerEnabled).toHaveBeenCalledWith(expect.objectContaining({
      serverId: disabledServer.serverId,
      enabled: expect.any(Boolean),
    }))

    await clickElement(document.body.querySelector('button[aria-label="测试 stdio stub server"]') as HTMLButtonElement)
    expect(mockedTestMcpConnection).toHaveBeenCalledWith({ serverId: disabledServer.serverId })
    expect(getServerRow(document.body, 'stdio stub server').textContent).toContain('成功：测试连接成功，可用工具 1 个。')
    expect(mockedRefreshMcpCatalog).not.toHaveBeenCalled()

    await clickElement(document.body.querySelector('button[aria-label="删除 stdio stub server"]') as HTMLButtonElement)
    await waitForNextFrame()

    expect(queryServerRow(document.body, 'stdio stub server')).toBeNull()
    const mcpContent = document.body.querySelector('.capabilities-main__content')
    expect(mcpContent).toBeTruthy()
    expect(mcpContent!.textContent).toContain('还没有可用的服务器')
    expect(mcpContent!.textContent?.match(/还没有可用的服务器/g)?.length).toBe(1)

    rendered.unmount()
  })

  it('shows the managed runtime status button, opens the panel, and triggers install or repair', async () => {
    const clipboardWriteText = mockClipboardWriteText()
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

    const baseSnapshot = createManagedRuntimeLoadResultFixture().snapshot
    mockedLoadManagedRuntime.mockResolvedValue({
      ok: true,
      snapshot: {
        ...baseSnapshot,
        overallStatus: 'missing',
        families: {
          node: {
            ...baseSnapshot.families.node,
            status: 'missing',
          },
          uv: {
            ...baseSnapshot.families.uv,
            status: 'missing',
          },
        },
      },
    })

    mockedInstallOrRepairManagedRuntime.mockResolvedValue({
      ok: true,
      snapshot: {
        ...baseSnapshot,
        overallStatus: 'ready',
        families: {
          node: {
            ...baseSnapshot.families.node,
            status: 'ready',
            activeVersion: '24.15.0',
            lastVerification: {
              verifiedAt: '2026-04-22T08:00:00.000Z',
              summary: 'node 与 npm 校验通过',
              launchers: {
                npx: 'D:/workspace/user-data/desktop-runtime/managed-runtime/node/active/npx.cmd',
              },
            },
          },
          uv: {
            ...baseSnapshot.families.uv,
            status: 'ready',
            activeVersion: 'python 3.12.10 + uv 0.11.7',
            lastVerification: {
              verifiedAt: '2026-04-22T08:00:00.000Z',
              summary: 'python 与 uv 校验通过',
              launchers: {
                uvx: 'D:/workspace/user-data/desktop-runtime/managed-runtime/uv/active/uvx.exe',
              },
            },
          },
        },
      },
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    await clickElement(getNavButton(document.body, 'mcp-servers'))
    await waitForNextFrame()
    await waitForNextFrame()

    const statusButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) => (
      button.textContent?.includes('环境状态')
    ))

    if (!(statusButton instanceof HTMLButtonElement)) {
      throw new Error('Missing managed runtime status button')
    }

    expect(statusButton.textContent).toContain('未安装')
    expect(statusButton.textContent).toContain('Node/npm 未安装')
    expect(statusButton.textContent).toContain('Python/uv 未安装')
    expect(statusButton.textContent).not.toContain('读取 MCP 环境状态中')

    await clickElement(statusButton)
    await waitForNextFrame()
    await waitForNextFrame()

    const panel = document.body.querySelector('[data-testid="managed-runtime-status-panel"]')

    if (!(panel instanceof HTMLElement)) {
      throw new Error('Missing managed runtime status panel')
    }

    expect(panel.getAttribute('aria-label')).toBe('MCP 托管运行时状态')
    expect(panel.className).toContain('managed-runtime-status-panel--open')
    expect(panel.textContent).toContain('Node/npm')
    expect(panel.textContent).toContain('Python/uv')
    expect(panel.textContent).toContain('未安装')
    expect(panel.textContent).toContain('尚未激活')
    expect(panel.textContent).not.toContain('复制路径')
    expect(panel.textContent).not.toContain('用于 MCP stdio 中的 npx 运行链路')
    expect(panel.textContent).not.toContain('用于 MCP stdio 中的 Python 与 uvx 运行链路')
    expect(panel.textContent).not.toContain('固定版本')
    expect(panel.textContent).not.toContain('最近校验')
    expect(panel.textContent).not.toContain('最近安装')
    expect(panel.textContent).not.toContain('最近修复')
    expect(panel.textContent).not.toContain('最近错误')

    await clickElement(getExactButton(panel, '一键安装/修复'))
    await waitForNextFrame()
    await waitForNextFrame()

    expect(mockedInstallOrRepairManagedRuntime).toHaveBeenCalledWith('install')
    expect(panel.textContent).toContain('可用')
    expect(panel.textContent).toContain('24.15.0')
    expect(panel.textContent).toContain('python 3.12.10 + uv 0.11.7')
    expect(panel.textContent).toContain('重新校验并修复')
    expect(panel.textContent).toContain('复制路径')

    await clickElement(getExactButton(panel, '复制路径'))

    expect(clipboardWriteText).toHaveBeenCalledWith('D:/workspace/user-data/desktop-runtime/managed-runtime/node/active/npx.cmd')

    await clickElement(statusButton)
    await waitForNextFrame()

    const closingPanel = document.body.querySelector('[data-testid="managed-runtime-status-panel"]')

    if (!(closingPanel instanceof HTMLElement)) {
      throw new Error('Missing closing managed runtime status panel')
    }

    expect(closingPanel.className).toContain('managed-runtime-status-panel--closing')
    expect(closingPanel.getAttribute('aria-hidden')).toBe('true')

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 160))
    })
    await waitForNextFrame()

    expect(document.body.querySelector('[data-testid="managed-runtime-status-panel"]')).toBeNull()

    rendered.unmount()
  })

  it('keeps focus in the MCP description and textarea fields while editing the dialog form', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    await clickElement(getNavButton(document.body, 'mcp-servers'))
    await waitForNextFrame()
    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    const dialog = getDialog(document.body)
    const nameInput = dialog.querySelector('input[aria-label="服务器名称"]')
    const descriptionInput = dialog.querySelector('input[aria-label="服务器说明"]')
    const argsTextarea = dialog.querySelector('textarea[aria-label="命令参数"]')

    if (!(nameInput instanceof HTMLInputElement)) {
      throw new Error('Missing MCP name input')
    }

    if (!(descriptionInput instanceof HTMLInputElement)) {
      throw new Error('Missing MCP description input')
    }

    if (!(argsTextarea instanceof HTMLTextAreaElement)) {
      throw new Error('Missing MCP args textarea')
    }

    const descriptionNodeBeforeInput = descriptionInput
    const argsNodeBeforeInput = argsTextarea

    await focusElement(descriptionInput)
    expect(document.activeElement).toBe(descriptionInput)

    await setFormControlValue(descriptionInput, '用于网页抓取')

    expect(document.activeElement).toBe(descriptionInput)
    expect(descriptionInput.value).toBe('用于网页抓取')
    expect(dialog.querySelector('input[aria-label="服务器名称"]')).toBe(nameInput)
    expect(dialog.querySelector('input[aria-label="服务器说明"]')).toBe(descriptionNodeBeforeInput)

    await focusElement(argsTextarea)
    expect(document.activeElement).toBe(argsTextarea)

    await setFormControlValue(argsTextarea, 'chrome-devtools-mcp@latest')

    expect(document.activeElement).toBe(argsTextarea)
    expect(argsTextarea.value).toBe('chrome-devtools-mcp@latest')
    expect(dialog.querySelector('textarea[aria-label="命令参数"]')).toBe(argsNodeBeforeInput)
    expect(dialog.querySelector('input[aria-label="服务器说明"]')).toBe(descriptionNodeBeforeInput)

    rendered.unmount()
  })

  it('imports a full mcpServers document and saves the selected server through the visual form', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    await clickElement(getNavButton(document.body, 'mcp-servers'))
    await waitForNextFrame()
    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    const dialog = getDialog(document.body)
    await clickElement(getExactButton(dialog, '从标准 MCP 配置导入'))

    const textarea = dialog.querySelector('textarea[aria-label="标准 MCP JSON"]') as HTMLTextAreaElement
    await setFormControlValue(textarea, JSON.stringify({
      mcpServers: {
        fetch: {
          command: 'uvx',
          args: ['mcp-server-fetch'],
        },
      },
    }, null, 2))
    await clickElement(getExactButton(dialog, '解析配置'))

    expect((dialog.querySelector('input[aria-label="服务器名称"]') as HTMLInputElement).value).toBe('fetch')
    expect((dialog.querySelector('input[aria-label="服务器标识"]') as HTMLInputElement).value).toBe('fetch')
    expect((dialog.querySelector('input[aria-label="启动命令"]') as HTMLInputElement).value).toBe('uvx')

    await clickElement(getExactButton(dialog, '保存服务器'))

    expect(mockedSaveMcpServer).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'fetch',
      displayName: 'fetch',
      transportKind: 'stdio',
      transportConfig: expect.objectContaining({
        kind: 'stdio',
        command: 'uvx',
        args: ['mcp-server-fetch'],
      }),
    }))

    rendered.unmount()
  })

  it('imports a single server object, supports multi-server selection, and reports invalid json', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()

    await clickElement(getNavButton(document.body, 'mcp-servers'))
    await waitForNextFrame()
    await clickElement(getExactButton(document.body, '新增 MCP 服务器'))
    await waitForNextFrame()

    const dialog = getDialog(document.body)
    await clickElement(getExactButton(dialog, '从标准 MCP 配置导入'))

    let textarea = dialog.querySelector('textarea[aria-label="标准 MCP JSON"]') as HTMLTextAreaElement

    await setFormControlValue(textarea, '{ invalid json }')
    await clickElement(getExactButton(dialog, '解析配置'))
    expect(dialog.textContent).toContain('JSON 解析失败')

    await setFormControlValue(textarea, JSON.stringify({
      mcpServers: {
        fetch: {
          command: 'uvx',
          args: ['mcp-server-fetch'],
        },
        'chrome-devtools': {
          command: 'npx',
          args: ['chrome-devtools-mcp@latest'],
        },
      },
    }, null, 2))
    await clickElement(getExactButton(dialog, '解析配置'))

    expect(dialog.textContent).toContain('检测到多个服务器，请先选择一个导入。')
    await clickElement(getExactButton(dialog, '导入此项'))

    expect((dialog.querySelector('input[aria-label="服务器标识"]') as HTMLInputElement).value).toBe('fetch')

    await clickElement(getExactButton(dialog, '从标准 MCP 配置导入'))
    textarea = dialog.querySelector('textarea[aria-label="标准 MCP JSON"]') as HTMLTextAreaElement
    await setFormControlValue(textarea, JSON.stringify({
      command: 'npx',
      args: ['chrome-devtools-mcp@latest'],
      serverId: 'chrome-devtools',
    }, null, 2))
    await clickElement(getExactButton(dialog, '解析配置'))

    expect((dialog.querySelector('input[aria-label="服务器名称"]') as HTMLInputElement).value).toBe('chrome-devtools')
    expect((dialog.querySelector('input[aria-label="启动命令"]') as HTMLInputElement).value).toBe('npx')

    rendered.unmount()
  })

  it('renders the polished Skills section without path input or internal revision details', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    const validSkill = createSkillRecordFixture()
    const builtinSkill = createSkillRecordFixture({
      skillId: 'builtin-placeholder-skill',
      displayName: '内置占位 Skill',
      description: '应用自带的占位 Skill。',
      source: 'builtin',
      managedDirectoryName: 'builtin-placeholder-skill',
      tags: ['builtin'],
    })
    const invalidSkill = createSkillRecordFixture({
      skillId: 'code-review-helper',
      displayName: '代码审查助手',
      description: '帮助模型执行结构化代码审查。',
      enabled: false,
      validation: {
        status: 'invalid',
        errors: [{
          fieldPath: 'SKILL.md',
          message: 'Skill entry file is not readable.',
          code: 'entry_missing',
        }],
        warnings: [],
      },
      entrySummary: null,
      resourceSummaries: [],
      tags: ['review'],
    })
    mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture({
      registryRevision: 12,
      snapshotRevision: 8,
      skills: [validSkill, builtinSkill, invalidSkill],
    }))

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await clickElement(getNavButton(rendered.container, 'skills'))
    await waitForNextFrame()

    expect(rendered.container.textContent).toContain('Skills')
    expect(rendered.container.textContent).not.toContain('本地 Skills')
    expect(rendered.container.textContent).toContain('导入 Skill')
    expect(rendered.container.textContent).toContain('刷新')
    expect(rendered.container.querySelector('.capabilities-main__actions')).toBeTruthy()
    expect(rendered.container.querySelector('input[aria-label="Skill 目录路径"]')).toBeNull()
    expect(rendered.container.textContent).not.toContain('Registry rev')
    expect(rendered.container.textContent).not.toContain('Snapshot rev')
    expect(rendered.container.textContent).not.toContain('Skills 管理')
    expect(rendered.container.querySelector('.skills-header')).toBeNull()
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).not.toContain('校验通过')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).not.toContain('已开启')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('documentation')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).not.toContain('未声明版本')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).not.toContain('个显式资源')
    expect(getSkillRow(rendered.container, '代码审查助手').textContent).toContain('Skill entry file is not readable.')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).not.toContain('帮助模型整理需求、设计与 API 文档。')
    expect((getSkillRow(rendered.container, '内置占位 Skill').querySelector('button[aria-label="删除 内置占位 Skill"]') as HTMLButtonElement).disabled).toBe(true)

    await clickElement(getSkillRow(rendered.container, '清晰文档写作').querySelector('button[aria-label="查看 清晰文档写作 详情"]') as HTMLButtonElement)

    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('适用场景')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('帮助模型编写结构清晰、面向开发者的技术文档。')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('技能预览')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('资源')
    expect(getSkillRow(rendered.container, '清晰文档写作').textContent).toContain('resources/checklist.md')

    rendered.unmount()

    mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture({ skills: [] }))
    const emptyRendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await clickElement(getNavButton(emptyRendered.container, 'skills'))
    await waitForNextFrame()

    expect(emptyRendered.container.textContent).toContain('还没有 Skills')
    expect(emptyRendered.container.textContent).toContain('可从本地文件夹导入 Skill')
    expect(emptyRendered.container.textContent).not.toContain('输入本地 Skill 包目录路径')

    emptyRendered.unmount()
  })

  it('imports through folder selection, toggles, refreshes, deletes, and applies subscriptions for Skills', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    const disabledSkill = createSkillRecordFixture({ enabled: false })
    const enabledSkill = createSkillRecordFixture({ enabled: true })
    mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture({ skills: [disabledSkill] }))
    mockedSelectAndImportSkill.mockResolvedValue(createSkillImportResultFixture({
      registryRevision: 13,
      snapshotRevision: 9,
      skill: enabledSkill,
    }))
    mockedSetSkillEnabled.mockResolvedValue(createSkillSetEnabledResultFixture(true))
    mockedRefreshSkills.mockResolvedValue(createSkillRefreshResultFixture(enabledSkill))
    mockedDeleteSkill.mockResolvedValue(createSkillDeleteResultFixture(enabledSkill.skillId))

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await clickElement(getNavButton(rendered.container, 'skills'))
    await waitForNextFrame()

    expect(rendered.container.querySelector('input[aria-label="Skill 目录路径"]')).toBeNull()
    await clickElement(getExactButton(rendered.container, '导入 Skill'))
    await waitForNextFrame()

    expect(mockedSelectAndImportSkill).toHaveBeenCalledOnce()
    expect(mockedImportSkill).not.toHaveBeenCalled()
    expect(rendered.container.textContent).not.toContain('已导入 清晰文档写作，当前已开启。')
    expect(rendered.container.textContent).not.toContain('成功：已导入')
    expect(rendered.container.textContent).not.toContain('未声明版本')

    const toggle = getSkillRow(rendered.container, '清晰文档写作').querySelector('button[aria-label="关闭 清晰文档写作"]')
      ?? getSkillRow(rendered.container, '清晰文档写作').querySelector('button[aria-label="开启 清晰文档写作"]')
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('Missing Skill toggle')
    }

    await clickElement(toggle)
    await waitForNextFrame()

    expect(mockedSetSkillEnabled).toHaveBeenCalledWith({
      skillId: enabledSkill.skillId,
      enabled: expect.any(Boolean),
    })

    await clickElement(rendered.container.querySelector(`button[aria-label="刷新 ${enabledSkill.displayName}"]`) as HTMLButtonElement)
    await waitForNextFrame()
    expect(mockedRefreshSkills).toHaveBeenCalledWith({ skillId: enabledSkill.skillId })

    await clickElement(getExactButton(rendered.container, '刷新'))
    await waitForNextFrame()
    expect(mockedRefreshSkills).toHaveBeenCalledWith(undefined)
    expect(rendered.container.querySelector('.skills-global-message')).toBeNull()

    if (activeSkillRegistryListener === null) {
      throw new Error('Expected Skill registry subscription listener to be registered.')
    }

    await act(async () => {
      activeSkillRegistryListener?.({
        kind: 'snapshot',
        registryRevision: 20,
        snapshotRevision: 14,
        skills: [enabledSkill],
      })
      await Promise.resolve()
    })
    await waitForNextFrame()

    expect(rendered.container.textContent).not.toContain('Registry rev 20')
    expect(rendered.container.textContent).not.toContain('Snapshot rev 14')

    await clickElement(rendered.container.querySelector(`button[aria-label="删除 ${enabledSkill.displayName}"]`) as HTMLButtonElement)
    await waitForNextFrame()

    expect(confirmSpy).toHaveBeenCalled()
    expect(mockedDeleteSkill).toHaveBeenCalledWith(enabledSkill.skillId)

    rendered.unmount()
    expect(activeSkillRegistryListener).toBeNull()
    confirmSpy.mockRestore()
  })

  it('renders markdown entry details and shows all resources in a scrollable panel', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture({
      skills: [createSkillRecordFixture({
        entrySummary: 'UI Aesthetics ## Intent Use this skill to make web UI output feel more professional, stable, and product-grade. Default goals: - Prefer restraint - Keep hierarchy clear - Fix composition before decoration Before adding polish, confirm structure first.',
        resourceSummaries: [
          { path: 'references/a.md' },
          { path: 'references/b.md' },
          { path: 'references/c.md' },
          { path: 'references/d.md' },
          { path: 'references/e.md' },
          { path: 'references/f.md' },
        ],
      })],
    }))

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await clickElement(getNavButton(rendered.container, 'skills'))
    await waitForNextFrame()

    await clickElement(getSkillRow(rendered.container, '清晰文档写作').querySelector('button[aria-label="查看 清晰文档写作 详情"]') as HTMLButtonElement)

    const row = getSkillRow(rendered.container, '清晰文档写作')
    expect(row.textContent).toContain('UI Aesthetics')
    expect(row.textContent).toContain('Use this skill to make web UI output feel more professional')
    expect(row.textContent).toContain('Prefer restraint')
    expect(row.textContent).toContain('Keep hierarchy clear')
    expect(row.textContent).toContain('Before adding polish, confirm structure first.')
    expect(row.textContent).toContain('帮助模型编写结构清晰、面向开发者的技术文档。')
    expect(row.querySelectorAll('.skill-row__markdown li').length).toBeGreaterThanOrEqual(3)
    expect(row.querySelector('.skill-row__detail-scroll')).toBeTruthy()
    expect(row.textContent).toContain('references/a.md')
    expect(row.textContent).toContain('references/e.md')
    expect(row.textContent).toContain('references/f.md')
    expect(row.querySelector('.skill-row__markdown ul li')).toBeTruthy()
    expect(row.querySelector('.skill-resource-list__overflow')).toBeNull()

    rendered.unmount()
  })

  it('shows user-friendly Skill import validation failures from folder selection', async () => {
    mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
    mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
    mockedLoadSkillRegistry.mockResolvedValue(createSkillRegistryLoadResultFixture({ skills: [] }))
    mockedSelectAndImportSkill.mockResolvedValue({
      ok: false,
      error: 'Skill package failed validation.',
      code: 'validation_failed',
      validationErrors: [{
        fieldPath: 'SKILL.md.frontmatter.description',
        message: 'Skill frontmatter description must be a non-empty string within 1000 characters.',
        code: 'invalid_description',
      }],
    })

    const rendered = renderWithRoot(<CapabilitiesWorkspace />)
    await waitForNextFrame()
    await clickElement(getNavButton(rendered.container, 'skills'))
    await waitForNextFrame()

    expect(rendered.container.querySelector('input[aria-label="Skill 目录路径"]')).toBeNull()
    await clickElement(getExactButton(rendered.container, '导入 Skill'))
    await waitForNextFrame()

    expect(mockedSelectAndImportSkill).toHaveBeenCalledOnce()
    expect(mockedImportSkill).not.toHaveBeenCalled()
    expect(rendered.container.textContent).toContain('导入遇到问题')
    expect(rendered.container.textContent).toContain('Skill frontmatter description must be a non-empty string within 1000 characters.')
    expect(rendered.container.textContent).toContain('位置：SKILL.md.frontmatter.description')
    expect(rendered.container.textContent).not.toContain('invalid_description')

    rendered.unmount()
  })

})
