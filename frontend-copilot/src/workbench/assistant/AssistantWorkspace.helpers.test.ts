/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { enhanceRuntimeAgents } from '../config'
import {
  appendAssistantSessionShell,
  createAssistantSessionListState,
  moveAssistantSessionShellToIndex,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
} from './assistant-session-helpers'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionCapabilities,
  createAssistantSessionShell,
  createAssistantSessionShellForAgent,
} from './assistant-workspace-controller'
import {
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
} from './AssistantWorkspace.test-support'

describe('AssistantWorkspace helpers', () => {
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

    const createSession = async () => createSessionResponse()
    const getCapabilities = async () => createCapabilitiesResponse()

    const shell = await createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
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
    const createSession = async () => {
      throw new Error('session/create failed')
    }
    const getCapabilities = async () => createCapabilitiesResponse()

    await expect(createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
    })).rejects.toThrow('session/create failed')

    expect(existingState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1'])
    expect(existingState.activeSessionId).toBe('session-1')
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
})
