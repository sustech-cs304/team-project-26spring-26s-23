import { expect, vi } from 'vitest'

import type { RuntimeThreadCreateResponse } from '../../../features/copilot/chat-contract'

import { AssistantWorkspace } from '../AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDeferred,
  createDirectoryResponse,
  createSessionResponse,
  renderWithRoot,
} from '../AssistantWorkspace.test-support'
import { createAssistantAgentDirectoryState } from '../assistant-workspace-controller'

export async function runCreateSessionPendingScenario() {
  const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())
  const createSessionDeferred = createDeferred<RuntimeThreadCreateResponse>()
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
}
