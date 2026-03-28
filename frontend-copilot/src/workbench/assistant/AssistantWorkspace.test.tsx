/** @vitest-environment jsdom */

import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type {
  RuntimeAgentsListResponse,
  RuntimeCapabilitiesGetResponse,
  RuntimeSessionCreateResponse,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { enhanceRuntimeAgents } from '../config'
import {
  AssistantWorkspace,
  appendAssistantSessionShell,
  createAssistantAgentDirectoryState,
  createAssistantSessionListState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
  createAssistantSessionShellForAgent,
  moveAssistantSessionShellToIndex,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
} from './AssistantWorkspace'

const mockCopilotChatPanel = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-copilot-chat-panel"
    data-selected-agent={String(props.selectedAgent ? (props.selectedAgent as { id: string }).id : '')}
    data-session-id={String(props.sessionShell ? (props.sessionShell as { sessionId: string }).sessionId : '')}
  >
    chat-shell
  </div>
))

vi.mock('../../features/copilot/CopilotChatPanel', () => ({
  CopilotChatPanel: (props: Record<string, unknown>) => mockCopilotChatPanel(props),
}))

describe('AssistantWorkspace', () => {
  it('renders backend directory agents and passes capability-backed session shell state into CopilotChatPanel', () => {
    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent directory.')
    }

    const sessionShell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })

    const html = renderToStaticMarkup(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        initialDirectoryState={directoryState}
        initialSessionShell={sessionShell}
      />,
    )

    expect(html).toContain('后端智能体目录')
    expect(html).toContain('通用智能体')
    expect(html).not.toContain('默认使用所有工具')
    expect(html).not.toContain('Minimal default agent exposed by the Copilot runtime run bridge.')
    expect(html).toContain('Blackboard')
    expect(html).not.toContain('当前会话')
    expect(html).not.toContain('已创建')
    expect(html).not.toContain('<span>session-1</span>')
    expect(html).not.toContain('当前入口语义')
    expect(html).not.toContain('当前会话绑定')
    expect(html).toContain('data-testid="assistant-chat-workspace"')
    expect(html).toContain('workspace-main workspace-main--chat')
    expect(html).not.toContain('workspace-chat-shell')
    expect(mockCopilotChatPanel).toHaveBeenCalled()
    expect(mockCopilotChatPanel.mock.calls[0][0]).toMatchObject({
      selectedAgent: expect.objectContaining({ id: 'general' }),
      sessionShell: expect.objectContaining({
        sessionId: 'session-1',
        capabilities: expect.objectContaining({
          capabilitiesVersion: 'cap-v12',
          recommendedToolsForAgent: ['tool.file-convert'],
        }),
      }),
      directoryState: expect.objectContaining({
        directoryVersion: 'agents-v1',
      }),
    })
  })

  it('creates session capabilities from the backend capability object without turning recommendation into a hard limit', () => {
    const capabilities = createAssistantSessionCapabilities(createCapabilitiesResponse())

    expect(capabilities).toEqual({
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [
        {
          toolId: 'tool.file-convert',
          kind: 'builtin',
          availability: 'available',
          displayName: '文件转换',
          description: 'DOCX/PDF/PPTX 转换工具',
        },
        {
          toolId: 'tool.remote-search',
          kind: 'external',
          availability: 'disabled-by-global-setting',
          displayName: '远程搜索',
          description: '访问外部搜索服务',
        },
      ],
      recommendedToolsForAgent: ['tool.file-convert'],
      defaultEnabledTools: ['tool.file-convert'],
      toolSelectionMode: 'recommendation-only',
      defaultModelPreference: 'openai/gpt-4.1',
    })
    expect(capabilities.allAvailableTools.map((tool) => tool.toolId)).toContain('tool.remote-search')
  })

  it('creates a session shell that preserves sessionId + boundAgent and stores capabilities in session state', () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const shell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })

    expect(shell).toEqual({
      sessionId: 'session-1',
      boundAgent: expect.objectContaining({
        id: 'general',
        label: '通用智能体',
      }),
      createdAt: '2026-03-27T10:00:00Z',
      updatedAt: '2026-03-27T10:00:00Z',
      capabilities: {
        capabilitiesVersion: 'cap-v12',
        allAvailableTools: [
          {
            toolId: 'tool.file-convert',
            kind: 'builtin',
            availability: 'available',
            displayName: '文件转换',
            description: 'DOCX/PDF/PPTX 转换工具',
          },
          {
            toolId: 'tool.remote-search',
            kind: 'external',
            availability: 'disabled-by-global-setting',
            displayName: '远程搜索',
            description: '访问外部搜索服务',
          },
        ],
        recommendedToolsForAgent: ['tool.file-convert'],
        defaultEnabledTools: ['tool.file-convert'],
        toolSelectionMode: 'recommendation-only',
        defaultModelPreference: 'openai/gpt-4.1',
      },
    })
  })

  it('loads capabilities immediately after session creation and seeds default enabled tools from the recommended subset', async () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const createSession = vi.fn().mockResolvedValue(createSessionResponse())
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse())

    const shell = await createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
    })

    expect(createSession).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      agentId: 'general',
    })
    expect(getCapabilities).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionId: 'session-1',
    })
    expect(shell.capabilities.capabilitiesVersion).toBe('cap-v12')
    expect(shell.capabilities.defaultEnabledTools).toEqual(['tool.file-convert'])
    expect(shell.capabilities.recommendedToolsForAgent).toEqual(['tool.file-convert'])
  })

  it('appends newly created sessions to the session list and switches the active session to the newest entry', () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const firstSession = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })
    const nextSession = createAssistantSessionShell({
      response: createSessionResponse({
        sessionId: 'session-2',
        createdAt: '2026-03-27T10:05:00Z',
        updatedAt: '2026-03-27T10:05:00Z',
      }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({
        sessionId: 'session-2',
        capabilitiesVersion: 'cap-v13',
      }),
    })

    const nextState = appendAssistantSessionShell(
      createAssistantSessionListState(firstSession),
      nextSession,
    )

    expect(nextState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-2', 'session-1'])
    expect(nextState.activeSessionId).toBe('session-2')
    expect(resolveActiveAssistantSessionShell(nextState)?.sessionId).toBe('session-2')
  })

  it('reorders sessions when a dragged session moves onto another session slot', () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const firstSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-1' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-1' }),
    })
    const secondSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-2' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-2' }),
    })
    const thirdSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-3' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-3' }),
    })

    const reordered = reorderAssistantSessionShells({
      sessions: [thirdSession, secondSession, firstSession],
      activeSessionId: 'session-2',
    }, 'session-1', 'session-3')

    expect(reordered.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1', 'session-3', 'session-2'])
    expect(reordered.activeSessionId).toBe('session-2')
  })

  it('supports moving a dragged session to the top and bottom insertion indexes', () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const firstSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-1' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-1' }),
    })
    const secondSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-2' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-2' }),
    })
    const thirdSession = createAssistantSessionShell({
      response: createSessionResponse({ sessionId: 'session-3' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-3' }),
    })

    const initialState = {
      sessions: [thirdSession, secondSession, firstSession],
      activeSessionId: 'session-2',
    }

    const movedToTop = moveAssistantSessionShellToIndex(initialState, 'session-1', 0)
    expect(movedToTop.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1', 'session-3', 'session-2'])

    const movedToBottom = moveAssistantSessionShellToIndex(initialState, 'session-3', 3)
    expect(movedToBottom.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-2', 'session-1', 'session-3'])
    expect(movedToBottom.activeSessionId).toBe('session-2')
  })

  it('keeps the create-session button label stable while creation is pending', async () => {
    const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())
    const createSessionDeferred = createDeferred<RuntimeSessionCreateResponse>()
    const createSession = vi.fn().mockReturnValue(createSessionDeferred.promise)
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse())

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={vi.fn().mockResolvedValue(createDirectoryResponse())}
        createSession={createSession}
        getCapabilities={getCapabilities}
        initialDirectoryState={directoryState}
      />,
    )

    const createButton = rendered.getByTestId('assistant-create-session-button') as HTMLButtonElement

    expect(createButton.textContent).toContain('为 通用智能体 创建会话')

    await clickElement(createButton)

    expect(createButton.textContent).toContain('为 通用智能体 创建会话')
    expect(createButton.textContent).not.toContain('正在创建会话')
    expect(createButton.getAttribute('aria-busy')).toBe('true')
    expect(createButton.disabled).toBe(true)

    await act(async () => {
      createSessionDeferred.resolve(createSessionResponse())
      await createSessionDeferred.promise
      await Promise.resolve()
    })

    rendered.unmount()
  })

  it('opens a session context menu with secondary submenus for copy and export on right click', async () => {
    const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())
    const selectedAgent = directoryState.agents[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent directory.')
    }

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={vi.fn().mockResolvedValue(createDirectoryResponse())}
        initialDirectoryState={directoryState}
        initialSessionShell={createAssistantSessionShell({
          response: createSessionResponse(),
          selectedAgent,
          capabilities: createCapabilitiesResponse(),
        })}
      />,
    )

    const sessionCard = rendered.getByTestId('assistant-session-card-session-1') as HTMLButtonElement

    await openContextMenu(sessionCard, 320, 240)

    const contextMenu = rendered.getByTestId('assistant-session-context-menu') as HTMLDivElement
    expect(contextMenu.style.left).toBe('320px')
    expect(contextMenu.style.top).toBe('240px')
    expect(contextMenu.textContent).toContain('重命名会话')
    expect(contextMenu.textContent).toContain('删除会话')
    expect(contextMenu.textContent).toContain('生成会话名')
    expect(contextMenu.textContent).toContain('复制会话')
    expect(contextMenu.textContent).toContain('导出会话')

    const copySubmenuTrigger = rendered.getByTestId('assistant-session-context-submenu-copy') as HTMLButtonElement
    const exportSubmenuTrigger = rendered.getByTestId('assistant-session-context-submenu-export') as HTMLButtonElement

    expect(rendered.queryByTestId('assistant-session-context-submenu-panel-copy')).toBeNull()
    expect(rendered.queryByTestId('assistant-session-context-submenu-panel-export')).toBeNull()

    await hoverElement(copySubmenuTrigger)
    const copySubmenu = rendered.getByTestId('assistant-session-context-submenu-panel-copy') as HTMLDivElement
    expect(copySubmenu.textContent).toContain('复制为新会话')
    expect(copySubmenu.textContent).toContain('复制为 Markdown')
    expect(copySubmenu.textContent).toContain('复制为纯文本')
    expect(copySubmenuTrigger.getAttribute('aria-expanded')).toBe('true')

    await hoverElement(exportSubmenuTrigger)
    expect(rendered.queryByTestId('assistant-session-context-submenu-panel-copy')).toBeNull()

    const exportSubmenu = rendered.getByTestId('assistant-session-context-submenu-panel-export') as HTMLDivElement
    expect(exportSubmenu.textContent).toContain('导出到 Markdown')
    expect(exportSubmenu.textContent).toContain('导出到 JSON')
    expect(exportSubmenu.textContent).toContain('导出为纯文本')
    expect(exportSubmenuTrigger.getAttribute('aria-expanded')).toBe('true')

    rendered.unmount()
  })

  it('does not append to the existing session list when creating a new session fails', async () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const existingSession = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })
    const existingState = createAssistantSessionListState(existingSession)
    const createSession = vi.fn().mockRejectedValue(new Error('session/create failed'))
    const getCapabilities = vi.fn()

    await expect(createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
    })).rejects.toThrow('session/create failed')

    expect(existingState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1'])
    expect(existingState.activeSessionId).toBe('session-1')
    expect(getCapabilities).not.toHaveBeenCalled()
  })
})

function createDirectoryResponse(): RuntimeAgentsListResponse {
  return {
    ok: true,
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [
      {
        agentId: 'general',
        status: 'active',
        recommendedTools: ['tool.file-convert'],
        defaultModelPreference: 'openai/gpt-4.1',
        displayName: 'Default',
        description: '默认通用智能体',
        iconKey: 'sparkles',
      },
      {
        agentId: 'blackboard',
        status: 'active',
        recommendedTools: [],
        defaultModelPreference: null,
        displayName: 'Blackboard',
        description: '课程数据助手',
        iconKey: 'database',
      },
    ],
  }
}

function createSessionResponse(overrides: Partial<RuntimeSessionCreateResponse> = {}): RuntimeSessionCreateResponse {
  return {
    ok: true,
    sessionId: 'session-1',
    boundAgent: {
      agentId: 'general',
      status: 'active',
      displayName: 'Default',
      description: '默认通用智能体',
      iconKey: 'sparkles',
    },
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
    capabilities: {
      tools: {
        selectionMode: 'recommendation-only',
      },
    },
    ...overrides,
  }
}

function createCapabilitiesResponse(overrides: Partial<RuntimeCapabilitiesGetResponse> = {}): RuntimeCapabilitiesGetResponse {
  return {
    ok: true,
    sessionId: 'session-1',
    boundAgent: {
      agentId: 'general',
      status: 'active',
      displayName: 'Default',
      description: '默认通用智能体',
      iconKey: 'sparkles',
    },
    capabilitiesVersion: 'cap-v12',
    tools: [
      {
        toolId: 'tool.file-convert',
        kind: 'builtin',
        availability: 'available',
        displayName: '文件转换',
        description: 'DOCX/PDF/PPTX 转换工具',
      },
      {
        toolId: 'tool.remote-search',
        kind: 'external',
        availability: 'disabled-by-global-setting',
        displayName: '远程搜索',
        description: '访问外部搜索服务',
      },
    ],
    recommendedTools: ['tool.file-convert'],
    toolSelectionMode: 'recommendation-only',
    defaultModelPreference: 'openai/gpt-4.1',
    ...overrides,
  }
}

function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:8765',
        agentName: null,
      },
      storageState: 'stored',
      runtime: {
        status: 'ready',
        expectedMode: 'development',
        resolvedMode: 'development',
        runtimeUrl: 'http://127.0.0.1:8765',
        isPackaged: false,
        failure: null,
      },
      runtimeUrl: 'http://127.0.0.1:8765',
      runtimeSource: 'hosted',
      agentName: null,
      agentNameSource: 'missing',
      diagnostics: {
        hostedStatus: 'ready',
        failure: null,
        mode: 'development',
        modeSource: 'resolved',
        runtimeSource: 'hosted',
      },
      devOverrideAllowed: true,
      devOverrideConfigured: false,
    },
  }
}

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (target === null) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }

      return target
    },
    queryByTestId(testId: string) {
      return container.querySelector(`[data-testid="${testId}"]`)
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function openContextMenu(element: Element, clientX: number, clientY: number) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
  })
}

async function hoverElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
  })
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}
