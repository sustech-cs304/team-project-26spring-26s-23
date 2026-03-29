/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { RuntimeSessionCreateResponse } from '../../features/copilot/chat-contract'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDeferred,
  createDirectoryResponse,
  createSessionResponse,
  hoverElement,
  openContextMenu,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionShell,
} from './assistant-workspace-controller'

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

describe('AssistantWorkspace render + interactions', () => {
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
    expect(mockCopilotChatPanel.mock.calls[0]?.[0]).toMatchObject({
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

    createSessionDeferred.resolve(createSessionResponse())
    await createSessionDeferred.promise

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
})
