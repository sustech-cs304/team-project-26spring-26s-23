import { expect, vi } from 'vitest'

import { AssistantWorkspace } from '../AssistantWorkspace'
import {
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
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
  expect(contextMenu.textContent).toContain('复制为新会话')
  expect(contextMenu.textContent).toContain('复制会话')
  expect(contextMenu.textContent).toContain('导出会话')
  expect(contextMenu.textContent).not.toContain('生成会话名')
  expect(rendered.queryByTestId('assistant-session-context-submenu-copy')).not.toBeNull()
  expect(rendered.queryByTestId('assistant-session-context-submenu-export')).not.toBeNull()

  rendered.unmount()
}
