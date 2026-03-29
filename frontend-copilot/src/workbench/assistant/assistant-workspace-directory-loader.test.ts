import { describe, expect, it, vi } from 'vitest'

import { createAssistantAgentDirectoryState } from './assistant-workspace-controller'
import {
  createAssistantDirectoryDisconnectedState,
  createAssistantDirectoryErrorState,
  createAssistantDirectoryLoadingState,
  createInitialAssistantSelectedAgentId,
  loadAssistantAgentDirectory,
  resolveAssistantSelectedAgent,
  resolveAssistantSelectedAgentId,
} from './assistant-workspace-directory-loader'
import { createDirectoryResponse } from './assistant-workspace-test-fixtures'

describe('assistant-workspace-directory-loader', () => {
  it('derives and preserves selected agent ids from the backend directory state', () => {
    const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())

    expect(createInitialAssistantSelectedAgentId(directoryState)).toBe('general')
    expect(resolveAssistantSelectedAgentId({
      directoryState,
      previousAgentId: 'blackboard',
    })).toBe('blackboard')
  })

  it('resolves concrete agent entries from the selected agent id', () => {
    const directoryState = createAssistantAgentDirectoryState(createDirectoryResponse())

    expect(resolveAssistantSelectedAgent({
      agents: directoryState.agents,
      selectedAgentId: 'blackboard',
    })?.id).toBe('blackboard')
    expect(resolveAssistantSelectedAgent({
      agents: directoryState.agents,
      selectedAgentId: 'missing',
    })).toBeNull()
  })

  it('builds disconnected, loading, and error directory states without discarding the current snapshot', () => {
    const readyDirectoryState = createAssistantAgentDirectoryState(createDirectoryResponse())

    expect(createAssistantDirectoryDisconnectedState({
      ...readyDirectoryState,
      error: 'stale',
    })).toMatchObject({
      status: 'ready',
      error: null,
      directoryVersion: 'agents-v1',
    })

    expect(createAssistantDirectoryLoadingState(readyDirectoryState)).toMatchObject({
      status: 'ready',
      error: null,
      directoryVersion: 'agents-v1',
    })

    expect(createAssistantDirectoryErrorState(new Error('directory failed'))).toEqual({
      status: 'error',
      directoryVersion: null,
      defaultAgentId: null,
      agents: [],
      error: 'directory failed',
    })
  })

  it('loads the runtime directory payload and maps it into assistant directory state', async () => {
    const listAgents = vi.fn().mockResolvedValue(createDirectoryResponse())

    const directoryState = await loadAssistantAgentDirectory({
      runtimeUrl: 'http://127.0.0.1:8765',
      listAgents,
    })

    expect(listAgents).toHaveBeenCalledWith({ runtimeUrl: 'http://127.0.0.1:8765' })
    expect(directoryState).toMatchObject({
      status: 'ready',
      directoryVersion: 'agents-v1',
      defaultAgentId: 'general',
      error: null,
    })
    expect(directoryState.agents.map((agent) => agent.id)).toEqual(['general', 'blackboard'])
  })
})
