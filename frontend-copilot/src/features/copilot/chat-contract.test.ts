import { describe, expect, it, vi } from 'vitest'

import {
  buildRuntimeEndpoint,
  createRuntimeSession,
  listRuntimeAgents,
  type RuntimeSessionCreateResponse,
} from './chat-contract'

describe('chat-contract', () => {
  it('posts agents/list to the runtime root endpoint', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
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
        ],
      }),
    })

    const response = await listRuntimeAgents({
      runtimeUrl: 'http://127.0.0.1:8765',
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'agents/list',
      }),
    })
    expect(response.defaultAgentId).toBe('general')
    expect(response.agents[0]?.agentId).toBe('general')
  })

  it('posts session/create and returns the bound session payload', async () => {
    const payload: RuntimeSessionCreateResponse = {
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
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    })

    const response = await createRuntimeSession({
      runtimeUrl: 'http://127.0.0.1:8765',
      agentId: 'general',
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'session/create',
        body: {
          agentId: 'general',
        },
      }),
    })
    expect(response.sessionId).toBe('session-1')
    expect(response.boundAgent.agentId).toBe('general')
  })

  it('normalizes runtime endpoint paths to the root slash', () => {
    expect(buildRuntimeEndpoint('http://127.0.0.1:8765')).toBe('http://127.0.0.1:8765/')
    expect(buildRuntimeEndpoint('http://127.0.0.1:8765/')).toBe('http://127.0.0.1:8765/')
  })

  it('surfaces structured runtime errors without silently continuing', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: {
          code: 'legacy_chat_contract_removed',
          message: 'old provider path removed',
        },
      }),
    })

    await expect(createRuntimeSession({
      runtimeUrl: 'http://127.0.0.1:8765',
      agentId: 'general',
      fetchFn,
    })).rejects.toThrow('legacy_chat_contract_removed: old provider path removed')
  })
})
