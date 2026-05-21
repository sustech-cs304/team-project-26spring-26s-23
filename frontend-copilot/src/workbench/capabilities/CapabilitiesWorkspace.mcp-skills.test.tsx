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

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_003 = '新增 MCP 服务器'
const DESC_CN_009 = 'Blackboard 工具'
const DESC_CN_010 = 'input[aria-label="服务器名称"]'
const DESC_CN_011 = '读取项目内文件内容，用于理解上下文与定位实现细节。'
const DESC_CN_013 = '从标准 MCP 配置导入'
const DESC_CN_016 = 'textarea[aria-label="标准 MCP JSON"]'
const DESC_CN_018 = 'input[aria-label="超时秒数"]'
const LABEL_2026_17T00 = '2026-04-17T00:00:00.000Z'
const LABEL_2026_21T12 = '2026-04-21T12:00:00.000Z'
const LABEL_BUILTIN_CORE = 'builtin-core'
const LABEL_BUILT_CORE = 'Built-in Core Tools'
const LABEL_CHROME_DEVTOOLS_MCP = 'chrome-devtools-mcp@latest'
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
  const dialog = container.querySelector(SELECTOR_ROLE_DIALOG)

  if (!(dialog instanceof HTMLElement)) {
    throw new Error('Missing MCP editor dialog')
  }

  return dialog
}

async function advanceTimersByTime(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
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

function createHostedCatalogOnlyLoadResult(): ToolCatalogLoadResult {
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
          sourceKind: LABEL_MCP_SERVER,
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
  describe('MCP servers', () => {
    // eslint-disable-next-line max-lines-per-function
    describe('dialog', () => {
      it('opens the MCP dialog in visual form mode and closes it through cancel, close, and backdrop actions', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
        mockedSaveSettingsWorkspaceState.mockResolvedValue({
          ok: true,
          state: createLoadResult().state,
        })

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        const mcpNavButton = getNavButton(document.body, LABEL_MCP_SERVERS)
        await clickElement(mcpNavButton)
        await waitForNextFrame()
        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()

        let dialog = getDialog(document.body)
        let nameInput = dialog.querySelector(DESC_CN_010)

        if (!(nameInput instanceof HTMLInputElement)) {
          throw new Error('Missing MCP name input')
        }

        expect(dialog.getAttribute('aria-label')).toBe(DESC_CN_003)
        expect(dialog.textContent).toContain('可视化表单')
        expect(dialog.textContent).toContain(DESC_CN_013)
        expect(nameInput.value).toBe('new-server')
        expect(document.activeElement).toBe(nameInput)
        expect(getExactButton(dialog, '取消')).toBeTruthy()
        expect(getExactButton(dialog, '保存服务器')).toBeTruthy()

        await clickElement(getExactButton(dialog, '取消'))

        expect(document.body.querySelector(SELECTOR_ROLE_DIALOG)).toBeNull()

        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()

        dialog = getDialog(document.body)
        nameInput = dialog.querySelector(DESC_CN_010)

        if (!(nameInput instanceof HTMLInputElement)) {
          throw new Error('Missing add MCP name input')
        }

        expect(dialog.getAttribute('aria-label')).toBe(DESC_CN_003)
        expect(nameInput.value).toBe('new-server')

        const closeButton = dialog.querySelector('button[aria-label="关闭服务器编辑窗口"]')

        if (!(closeButton instanceof HTMLButtonElement)) {
          throw new Error('Missing MCP close button')
        }

        await clickElement(closeButton)

        expect(document.body.querySelector(SELECTOR_ROLE_DIALOG)).toBeNull()

        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()
        await clickElement(document.body.querySelector('.capabilities-dialog-backdrop') as HTMLElement)

        expect(document.body.querySelector(SELECTOR_ROLE_DIALOG)).toBeNull()

        rendered.unmount()
      })

      it('keeps focus in the MCP description and textarea fields while editing the dialog form', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()

        await clickElement(getNavButton(document.body, LABEL_MCP_SERVERS))
        await waitForNextFrame()
        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()

        const dialog = getDialog(document.body)
        const nameInput = dialog.querySelector(DESC_CN_010)
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
        expect(dialog.querySelector(DESC_CN_010)).toBe(nameInput)
        expect(dialog.querySelector('input[aria-label="服务器说明"]')).toBe(descriptionNodeBeforeInput)

        await focusElement(argsTextarea)
        expect(document.activeElement).toBe(argsTextarea)

        await setFormControlValue(argsTextarea, LABEL_CHROME_DEVTOOLS_MCP)

        expect(document.activeElement).toBe(argsTextarea)
        expect(argsTextarea.value).toBe(LABEL_CHROME_DEVTOOLS_MCP)
        expect(dialog.querySelector('textarea[aria-label="命令参数"]')).toBe(argsNodeBeforeInput)
        expect(dialog.querySelector('input[aria-label="服务器说明"]')).toBe(descriptionNodeBeforeInput)

        rendered.unmount()
      })

      it('imports a full mcpServers document and saves the selected server through the visual form', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
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
            fetch: {
              command: 'uvx',
              args: ['mcp-server-fetch'],
            },
          },
        }, null, 2))
        await clickElement(getExactButton(dialog, '解析配置'))

        expect((dialog.querySelector(DESC_CN_010) as HTMLInputElement).value).toBe('fetch')
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

        await clickElement(getNavButton(document.body, LABEL_MCP_SERVERS))
        await waitForNextFrame()
        await clickElement(getExactButton(document.body, DESC_CN_003))
        await waitForNextFrame()

        const dialog = getDialog(document.body)
        await clickElement(getExactButton(dialog, DESC_CN_013))

        let textarea = dialog.querySelector(DESC_CN_016) as HTMLTextAreaElement

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
              args: [LABEL_CHROME_DEVTOOLS_MCP],
            },
          },
        }, null, 2))
        await clickElement(getExactButton(dialog, '解析配置'))

        expect(dialog.textContent).toContain('检测到多个服务器，请先选择一个导入。')
        await clickElement(getExactButton(dialog, '导入此项'))

        expect((dialog.querySelector('input[aria-label="服务器标识"]') as HTMLInputElement).value).toBe('fetch')

        await clickElement(getExactButton(dialog, DESC_CN_013))
        textarea = dialog.querySelector(DESC_CN_016) as HTMLTextAreaElement
        await setFormControlValue(textarea, JSON.stringify({
          command: 'npx',
          args: [LABEL_CHROME_DEVTOOLS_MCP],
          serverId: 'chrome-devtools',
        }, null, 2))
        await clickElement(getExactButton(dialog, '解析配置'))

        expect((dialog.querySelector(DESC_CN_010) as HTMLInputElement).value).toBe('chrome-devtools')
        expect((dialog.querySelector('input[aria-label="启动命令"]') as HTMLInputElement).value).toBe('npx')

        rendered.unmount()
      })
    })

    it('toggles, tests, and deletes registry-backed MCP server rows from the panel', async () => {
      mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
      mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())
      mockedSaveSettingsWorkspaceState.mockResolvedValue({
        ok: true,
        state: createLoadResult().state,
      })
      const disabledServer = createMcpStdioStubServerFixture({
        displayName: LABEL_STDIO_STUB_SERVER,
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

      const mcpNavButton = getNavButton(document.body, LABEL_MCP_SERVERS)
      await clickElement(mcpNavButton)
      await waitForNextFrame()
      await waitForNextFrame()

      expect(getServerRow(document.body, LABEL_STDIO_STUB_SERVER)).toBeTruthy()

      const enableToggle = getServerRow(document.body, LABEL_STDIO_STUB_SERVER).querySelector('.mcp-server-toggle')

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
      expect(getServerRow(document.body, LABEL_STDIO_STUB_SERVER).textContent).toContain('成功：测试连接成功，可用工具 1 个。')
      expect(mockedRefreshMcpCatalog).not.toHaveBeenCalled()

      await clickElement(document.body.querySelector('button[aria-label="删除 stdio stub server"]') as HTMLButtonElement)
      await waitForNextFrame()

      expect(queryServerRow(document.body, LABEL_STDIO_STUB_SERVER)).toBeNull()
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

      await clickElement(getNavButton(document.body, LABEL_MCP_SERVERS))
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
  })

  // eslint-disable-next-line max-lines-per-function
  describe('skills', () => {
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
})
