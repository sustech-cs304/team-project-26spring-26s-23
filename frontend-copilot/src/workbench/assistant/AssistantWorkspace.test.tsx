import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CopilotBootstrapController } from '../../features/copilot/types'
import { AssistantWorkspace } from './AssistantWorkspace'

const mockCopilotChatPanel = vi.fn(({ threadId }: { threadId: string }) => (
  <div data-testid="mock-copilot-chat-panel" data-thread-id={threadId}>
    {threadId}
  </div>
))

vi.mock('../../features/copilot/CopilotChatPanel', () => ({
  CopilotChatPanel: (props: { threadId: string }) => mockCopilotChatPanel(props),
}))

describe('AssistantWorkspace', () => {
  it('passes the active conversation id to CopilotChatPanel as threadId', () => {
    renderToStaticMarkup(<AssistantWorkspace bootstrap={createBootstrapController()} />)

    expect(mockCopilotChatPanel).toHaveBeenCalled()
    expect(mockCopilotChatPanel.mock.calls[0][0]).toMatchObject({
      threadId: 'general-project-sync',
    })
  })
})

function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
      bootstrapFields: {
        runtimeUrl: 'http://127.0.0.1:8765',
        agentName: 'campus-agent',
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
      agentName: 'campus-agent',
      agentNameSource: 'config-center',
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
