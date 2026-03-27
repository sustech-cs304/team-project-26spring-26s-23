import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type {
  RuntimeAgentsListResponse,
  RuntimeSessionCreateResponse,
} from '../../features/copilot/chat-contract'
import type { CopilotBootstrapController } from '../../features/copilot/types'
import { enhanceRuntimeAgents } from '../config'
import { AssistantWorkspace, createAssistantAgentDirectoryState, createAssistantSessionShell } from './AssistantWorkspace'

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
  it('renders backend directory agents and passes selected agent + session shell state into CopilotChatPanel', () => {
    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent directory.')
    }

    const sessionShell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
    })

    const html = renderToStaticMarkup(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        initialDirectoryState={directoryState}
        initialSessionShell={sessionShell}
      />,
    )

    expect(html).toContain('后端智能体目录')
    expect(html).toContain('通用助手')
    expect(html).toContain('Blackboard')
    expect(mockCopilotChatPanel).toHaveBeenCalled()
    expect(mockCopilotChatPanel.mock.calls[0][0]).toMatchObject({
      selectedAgent: expect.objectContaining({ id: 'general' }),
      sessionShell: expect.objectContaining({ sessionId: 'session-1' }),
      directoryState: expect.objectContaining({
        directoryVersion: 'agents-v1',
      }),
    })
  })

  it('creates a session shell that preserves sessionId + boundAgent from the new contract', () => {
    const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

    if (!selectedAgent) {
      throw new Error('Expected seeded agent.')
    }

    const shell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
    })

    expect(shell).toEqual({
      sessionId: 'session-1',
      boundAgent: expect.objectContaining({
        id: 'general',
        label: '通用助手',
      }),
      createdAt: '2026-03-27T10:00:00Z',
      updatedAt: '2026-03-27T10:00:00Z',
      recommendedTools: ['tool.file-convert'],
      defaultModelPreference: 'openai/gpt-4.1',
    })
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
        displayName: '通用助手',
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

function createSessionResponse(): RuntimeSessionCreateResponse {
  return {
    ok: true,
    sessionId: 'session-1',
    boundAgent: {
      agentId: 'general',
      status: 'active',
      displayName: '通用助手',
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
