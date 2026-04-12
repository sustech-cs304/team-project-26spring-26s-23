import { expect, vi } from 'vitest'

import { AssistantWorkspace } from '../AssistantWorkspace'
import {
  blurElement,
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
  hoverElement,
  inputText,
  keyDownElement,
  openContextMenu,
  renderWithRoot,
} from '../AssistantWorkspace.test-support'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionShell,
} from '../assistant-workspace-controller'

export async function runSessionContextMenuScenario() {
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

  await clickElement(copySubmenuTrigger)
  expect(rendered.queryByTestId('assistant-session-context-submenu-panel-copy')).toBeNull()
  expect(copySubmenuTrigger.getAttribute('aria-expanded')).toBe('false')

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
}

export async function runSessionRenameScenario() {
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

  await openContextMenu(sessionCard, 120, 80)
  await clickElement(rendered.getByTestId('assistant-session-context-action-rename'))

  const renameInput = rendered.getByTestId('assistant-session-rename-input-session-1') as HTMLInputElement
  expect(renameInput.value).toBe('通用智能体')

  await inputText(renameInput, '需求澄清')
  await keyDownElement(renameInput, 'Enter')

  expect((rendered.getByTestId('assistant-session-card-session-1') as HTMLButtonElement).textContent).toContain('需求澄清')

  await openContextMenu(rendered.getByTestId('assistant-session-card-session-1'), 140, 96)
  await clickElement(rendered.getByTestId('assistant-session-context-action-rename'))

  const escapeRenameInput = rendered.getByTestId('assistant-session-rename-input-session-1') as HTMLInputElement
  await inputText(escapeRenameInput, '不会保存')
  await keyDownElement(escapeRenameInput, 'Escape')

  expect((rendered.getByTestId('assistant-session-card-session-1') as HTMLButtonElement).textContent).toContain('需求澄清')

  await openContextMenu(rendered.getByTestId('assistant-session-card-session-1'), 150, 108)
  await clickElement(rendered.getByTestId('assistant-session-context-action-rename'))

  const blurRenameInput = rendered.getByTestId('assistant-session-rename-input-session-1') as HTMLInputElement
  await inputText(blurRenameInput, '最终标题')
  await blurElement(blurRenameInput)

  expect((rendered.getByTestId('assistant-session-card-session-1') as HTMLButtonElement).textContent).toContain('最终标题')

  rendered.unmount()
}

export async function runSessionDeletionScenario() {
  const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())
  const selectedAgent = directoryState.agents[0]

  if (!selectedAgent) {
    throw new Error('Expected seeded agent directory.')
  }

  const createSession = vi.fn().mockResolvedValue(createSessionResponse({
    threadId: 'session-2',
    createdAt: '2026-03-27T10:05:00Z',
    updatedAt: '2026-03-27T10:05:00Z',
  }))
  const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
    sessionId: 'session-2',
    capabilitiesVersion: 'cap-v13',
  }))

  const rendered = renderWithRoot(
    <AssistantWorkspace
      bootstrap={createBootstrapController()}
      listAgents={vi.fn().mockResolvedValue(createDirectoryResponse())}
      createSession={createSession}
      getCapabilities={getCapabilities}
      initialDirectoryState={directoryState}
      initialSessionShell={createAssistantSessionShell({
        response: createSessionResponse(),
        selectedAgent,
        capabilities: createCapabilitiesResponse(),
      })}
    />,
  )

  await clickElement(rendered.getByTestId('assistant-create-session-button'))

  const activeChatPanel = rendered.getByTestId('mock-copilot-chat-panel') as HTMLDivElement
  expect(activeChatPanel.dataset.sessionId).toBe('session-2')

  await openContextMenu(rendered.getByTestId('assistant-session-card-session-2'), 260, 180)
  await clickElement(rendered.getByTestId('assistant-session-context-action-delete'))

  expect(rendered.getByTestId('assistant-session-card-session-2')).toBeTruthy()
  expect(rendered.getByTestId('assistant-session-context-action-delete-confirm').textContent).toContain('确认删除')
  expect(rendered.queryByTestId('assistant-session-context-action-delete')).toBeNull()

  await clickElement(rendered.getByTestId('assistant-session-context-action-delete-confirm'))

  expect(rendered.queryByTestId('assistant-session-card-session-2')).toBeNull()
  expect(rendered.getByTestId('assistant-session-card-session-1')).toBeTruthy()
  expect((rendered.getByTestId('mock-copilot-chat-panel') as HTMLDivElement).dataset.sessionId).toBe('')
  expect((rendered.getByTestId('mock-copilot-chat-panel') as HTMLDivElement).dataset.selectedAgent).toBe('general')

  rendered.unmount()
}
