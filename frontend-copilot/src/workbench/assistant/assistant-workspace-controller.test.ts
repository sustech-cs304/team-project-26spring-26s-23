import { describe, expect, it } from 'vitest'

import { enhanceRuntimeAgents } from '../config'

const TOOL_ID_FS_READ = 'tool.fs.read'
import {
  activateAssistantSession,
  createAssistantAgentDirectoryState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
  formatAssistantWorkspaceError,
} from './assistant-workspace-controller'
import {
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
} from './assistant-workspace-test-fixtures'

function getSelectedAgent() {
  const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

  if (!selectedAgent) {
    throw new Error('Expected seeded agent.')
  }

  return selectedAgent
}

describe('assistant-workspace-controller', () => {
  it('creates session capabilities from the backend capability object and defaults every tool on', () => {
    const capabilities = createAssistantSessionCapabilities(createCapabilitiesResponse())

    expect(capabilities).toEqual({
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [
        {
          toolId: TOOL_ID_FS_READ,
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容。',
        },
        {
          toolId: 'tool.remote-search',
          kind: 'external',
          availability: 'disabled-by-global-setting',
          displayName: '远程搜索',
          description: '访问外部搜索服务',
        },
      ],
      recommendedToolsForAgent: [TOOL_ID_FS_READ],
      defaultEnabledTools: [TOOL_ID_FS_READ, 'tool.remote-search'],
      toolSelectionMode: 'recommendation-only',
    })
    expect(capabilities.allAvailableTools.map((tool) => tool.toolId)).toContain('tool.remote-search')
  })

  it('creates a session shell that preserves sessionId + boundAgent and stores capabilities in session state', () => {
    const shell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent: getSelectedAgent(),
      capabilities: createCapabilitiesResponse(),
    })

    expect(shell).toEqual({
      sessionId: 'session-1',
      title: '新话题',
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
            toolId: TOOL_ID_FS_READ,
            kind: 'builtin',
            availability: 'available',
            displayName: '读取文件',
            description: '读取项目内文件内容。',
          },
          {
            toolId: 'tool.remote-search',
            kind: 'external',
            availability: 'disabled-by-global-setting',
            displayName: '远程搜索',
            description: '访问外部搜索服务',
          },
        ],
        recommendedToolsForAgent: [TOOL_ID_FS_READ],
        defaultEnabledTools: [TOOL_ID_FS_READ, 'tool.remote-search'],
        toolSelectionMode: 'recommendation-only',
      },
    })
  })

  it('maps runtime directory payload into assistant directory state', () => {
    const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())

    expect(directoryState).toMatchObject({
      status: 'ready',
      directoryVersion: 'agents-v1',
      defaultAgentId: 'general',
      error: null,
    })
    expect(directoryState.agents.map((agent) => agent.id)).toEqual(['general', 'blackboard'])
  })

  it('activates existing sessions and ignores unknown session ids', () => {
    const selectedAgent = getSelectedAgent()
    const firstSession = createAssistantSessionShell({
      response: createSessionResponse({ threadId: 'session-1' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-1' }),
    })
    const secondSession = createAssistantSessionShell({
      response: createSessionResponse({ threadId: 'session-2' }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({ sessionId: 'session-2' }),
    })
    const sessionListState = {
      sessions: [secondSession, firstSession],
      activeSessionId: 'session-1',
    }

    expect(activateAssistantSession(sessionListState, 'session-2')).toEqual({
      sessions: [secondSession, firstSession],
      activeSessionId: 'session-2',
    })
    expect(activateAssistantSession(sessionListState, 'missing')).toBe(sessionListState)
  })

  it('formats both Error objects and non-Error values into workspace-safe messages', () => {
    expect(formatAssistantWorkspaceError(new Error('directory failed'))).toBe('directory failed')
    expect(formatAssistantWorkspaceError({ reason: 'unknown' })).toBe('[object Object]')
  })
})
