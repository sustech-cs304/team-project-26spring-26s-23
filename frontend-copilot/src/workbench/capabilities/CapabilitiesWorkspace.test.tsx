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
} from '../../../electron/mcp-registry/types'
import type { SkillRecord, SkillRegistrySubscriptionEvent } from '../../../electron/skill-registry/types'
import type { ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'
import type { RuntimeToolDirectoryEntry } from '../../features/copilot/chat-contract'

import {
  createManagedRuntimeLoadResultFixture,
  createMcpDeleteServerSuccessFixture,
  createMcpRegistryLoadResultFixture,
  createMcpSaveServerSuccessFixture,
  createMcpSetServerEnabledSuccessFixture,
  createMcpTestConnectionSuccessFixture,
  createSkillRecordFixture,
} from '../../../electron/renderer-ipc.test-support'
import {
  clickElement,
  renderWithRoot,
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
const LABEL_BUILTIN_CORE = 'builtin-core'
const LABEL_BUILT_CORE = 'Built-in Core Tools'
const LABEL_FILESYSTEM_MCP = 'Filesystem MCP'
const LABEL_MCP_SERVER = 'mcp-server'
const LABEL_MCP_SERVERS = 'mcp-servers'
const LABEL_STDIO_STUB_SERVER = 'stdio stub server'
const LABEL_TOOL_READ = 'tool.fs.read'
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

async function advanceTimersByTime(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
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
  describe('tool permissions', () => {
    describe('rendering', () => {
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
        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_GROUP).length).toBe(2)
        expect(rendered.container.textContent).toContain('内置基础工具')
        expect(rendered.container.textContent).toContain('MCP 工具')
        expect(rendered.container.textContent).toContain('能力中心')
        expect(rendered.container.textContent).toContain('工具权限')
        expect(rendered.container.textContent).toContain('读取文件')
        expect(rendered.container.textContent).toContain('写入文件')
        expect(rendered.container.textContent).toContain('浏览器自动化')
        expect(getToolRow(rendered.container, '读取文件').textContent).toContain(LABEL_TOOL_READ)
        expect(getExactButton(getToolRow(rendered.container, '读取文件'), '自动批准').className).toContain(
          'tool-permission-segmented__item--active',
        )
        expect(getExactButton(getToolRow(rendered.container, '联网抓取'), '总是关闭').className).toContain(
          'tool-permission-segmented__item--active',
        )

        await clickElement(getNavButton(rendered.container, LABEL_MCP_SERVERS))
        await waitForNextFrame()

        const toolPermissionsList = rendered.container.querySelector('[aria-label="工具权限列表"]')
        expect(toolPermissionsList).toBeTruthy()
        const toolPermissionsSection = toolPermissionsList!.closest('[data-capabilities-section="tool-permissions"]')
        expect(toolPermissionsSection).toBeTruthy()
        expect(toolPermissionsSection!.className).toContain('capabilities-section-view--exiting')
        expect(toolPermissionsSection!.getAttribute('aria-hidden')).toBe('true')
        expect(rendered.container.querySelector(`[data-capabilities-section="${LABEL_MCP_SERVERS}"]`)?.className).toContain(
          'capabilities-section-view--active',
        )
        expect(rendered.container.querySelector('.mcp-server-row')).toBeTruthy()
        expect(rendered.container.textContent).toContain('MCP 服务器')
        expect(rendered.container.textContent).toContain(LABEL_STDIO_STUB_SERVER)
        expect(rendered.container.textContent).toContain('http sse stub server')
        expect(rendered.container.textContent).toContain('测试连接')
        expect(rendered.container.textContent).not.toContain('刷新工具列表')
        expect(mockedLoadMcpRegistry).toHaveBeenCalledWith({ includeDisabled: true })
        expect(rendered.container.textContent).toContain(DESC_CN_003)
        expect(rendered.container.textContent).not.toContain('录入新的 MCP registry 草稿')

        rendered.unmount()
      })

      it('keeps visited capability sections mounted and preserves internal state after transition exit', async () => {
        mockedLoadSettingsWorkspaceState.mockResolvedValue(createLoadResult())
        mockedLoadToolCatalog.mockResolvedValue(createToolCatalogLoadResult())

        const rendered = renderWithRoot(<CapabilitiesWorkspace />)
        await waitForNextFrame()
        await clickElement(getNavButton(rendered.container, 'skills'))
        await waitForNextFrame()

        await clickElement(
          getSkillRow(rendered.container, '清晰文档写作')
            .querySelector('button[aria-label="查看 清晰文档写作 详情"]') as HTMLButtonElement,
        )
        expect(getSkillRow(rendered.container, '清晰文档写作').querySelector('.skill-row__details-panel')).toBeTruthy()

        vi.useFakeTimers()
        try {
          await clickElement(getNavButton(rendered.container, LABEL_MCP_SERVERS))

          const exitingSkillsSection = rendered.container.querySelector('[data-capabilities-section="skills"]') as HTMLElement
          expect(exitingSkillsSection.className).toContain('capabilities-section-view--exiting')
          expect(exitingSkillsSection.hidden).toBe(false)

          await advanceTimersByTime(200)

          expect(exitingSkillsSection.hidden).toBe(true)
          expect(exitingSkillsSection.getAttribute('aria-hidden')).toBe('true')
          expect(getSkillRow(rendered.container, '清晰文档写作').querySelector('.skill-row__details-panel')).toBeTruthy()

          await clickElement(getNavButton(rendered.container, 'skills'))

          const activeSkillsSection = rendered.container.querySelector('[data-capabilities-section="skills"]') as HTMLElement
          expect(activeSkillsSection.hidden).toBe(false)
          expect(activeSkillsSection.className).toContain('capabilities-section-view--active')
          expect(getSkillRow(rendered.container, '清晰文档写作').querySelector('.skill-row__details-panel')).toBeTruthy()
        } finally {
          rendered.unmount()
          vi.useRealTimers()
        }
      })
    })

    describe('group rendering', () => {
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

        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_GROUP).length).toBe(4)
        expect(groupLabels).toEqual(['内置基础工具', DESC_CN_009, 'TIS 工具', LABEL_FILESYSTEM_MCP])
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
              mcpServerName: LABEL_STDIO_STUB_SERVER,
              group: {
                id: 'mcp.server.mcp-stdio-stub',
                label: LABEL_STDIO_STUB_SERVER,
                labelZh: LABEL_STDIO_STUB_SERVER,
                labelEn: LABEL_STDIO_STUB_SERVER,
                order: 100,
                sourceKind: LABEL_MCP_SERVER,
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

        expect(rendered.container.textContent).toContain(LABEL_STDIO_STUB_SERVER)
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

        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_ROW).length).toBe(4)
        expect(rendered.container.textContent).toContain('课程目录搜索')
        expect(rendered.container.textContent).toContain('成绩查询')
        expect(rendered.container.textContent).toContain('校园活动')
        expect(rendered.container.textContent).not.toContain('尚未从运行时获取到可展示的工具目录。')
        expect(rendered.container.querySelectorAll(SELECTOR_TOOL_PERMISSION_GROUP).length).toBe(4)
        expect(rendered.container.textContent).toContain('内置基础工具')
        expect(rendered.container.textContent).toContain(DESC_CN_009)
        expect(rendered.container.textContent).toContain('TIS 工具')
        expect(rendered.container.textContent).toContain('MCP 工具')

        rendered.unmount()
      })
    })
  })
})
