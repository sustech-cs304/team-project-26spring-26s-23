import { describe, expect, it, vi } from 'vitest'

import { enhanceRuntimeAgents } from '../config'
import { createAssistantSessionShell } from './assistant-workspace-controller'
import { createAssistantSessionListState } from './assistant-session-helpers'
import {
  createAssistantSessionShellForAgent,
  getAssistantCreateSessionLabel,
  isAssistantCreateSessionButtonDisabled,
} from './assistant-workspace-session-controller'
import {
  createBootstrapController,
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

describe('assistant-workspace-session-controller', () => {
  it('loads capabilities immediately after session creation and seeds only selectable tools as enabled by default', async () => {
    const selectedAgent = getSelectedAgent()
    const createSession = async () => createSessionResponse()
    const getCapabilities = async () => createCapabilitiesResponse()

    const shell = await createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
    })

    expect(shell.capabilities.capabilitiesVersion).toBe('cap-v12')
    expect(shell.capabilities.defaultEnabledTools).toEqual(['tool.fs.read'])
    expect(shell.capabilities.recommendedToolsForAgent).toEqual(['tool.fs.read'])
  })

  it('rejects thread creation before callers can append a new shell into the existing list', async () => {
    const selectedAgent = getSelectedAgent()
    const existingSession = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })
    const existingState = createAssistantSessionListState(existingSession)
    const createSession = async () => {
      throw new Error('thread/create failed')
    }
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse())

    await expect(createAssistantSessionShellForAgent({
      runtimeUrl: 'http://127.0.0.1:8765',
      selectedAgent,
      createSession,
      getCapabilities,
    })).rejects.toThrow('thread/create failed')

    expect(getCapabilities).not.toHaveBeenCalled()
    expect(existingState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1'])
    expect(existingState.activeSessionId).toBe('session-1')
  })

  it('builds create-session labels from the selected agent and current session shell metadata', () => {
    const selectedAgent = getSelectedAgent()
    const sessionShell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })
    const otherAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[1]

    if (!otherAgent) {
      throw new Error('Expected secondary seeded agent.')
    }

    expect(getAssistantCreateSessionLabel({
      selectedAgent,
      sessionShell,
    })).toBe('为 通用智能体 创建会话')
    expect(getAssistantCreateSessionLabel({
      selectedAgent: otherAgent,
      sessionShell,
    })).toBe('切换到 Blackboard 并新建会话')
    expect(getAssistantCreateSessionLabel({
      selectedAgent: null,
      sessionShell,
    })).toBe('等待后端目录提供可用智能体')
  })

  it('disables create-session actions when bootstrap is disconnected, no agent is selected, or creation is pending', () => {
    const bootstrap = createBootstrapController()
    const selectedAgent = getSelectedAgent()

    expect(isAssistantCreateSessionButtonDisabled({
      bootstrapState: bootstrap.state,
      selectedAgent,
      sessionStatus: 'idle',
    })).toBe(false)

    expect(isAssistantCreateSessionButtonDisabled({
      bootstrapState: { ...bootstrap.state, status: 'loading' },
      selectedAgent,
      sessionStatus: 'idle',
    })).toBe(true)

    expect(isAssistantCreateSessionButtonDisabled({
      bootstrapState: bootstrap.state,
      selectedAgent: null,
      sessionStatus: 'idle',
    })).toBe(true)

    expect(isAssistantCreateSessionButtonDisabled({
      bootstrapState: bootstrap.state,
      selectedAgent,
      sessionStatus: 'creating',
    })).toBe(true)
  })
})
