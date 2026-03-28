/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  buildRuntimeDebugSummary,
  buildRuntimeMessageSendInput,
  buildSessionDebugSummary,
  createComposerDraftFromSession,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
} from './copilot-chat-helpers'
import { RuntimeRequestError } from './chat-contract'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
} from './CopilotChatPanel.test-support'
import { DEFAULT_COPILOT_MODEL_ID } from './model-picker'
import type { CopilotBootstrapState } from './types'

describe('copilot chat helpers', () => {
  it('builds runtime and session debug summaries for console logging', () => {
    expect(buildRuntimeDebugSummary({
      state: createReadyState() as Extract<CopilotBootstrapState, { status: 'ready' }>,
      directoryState: createDirectoryState(),
      selectedAgent: createSelectedAgent(),
    })).toEqual({
      runtimeSource: 'hosted',
      connectionSummary: '宿主管理 · http://127.0.0.1:8765 · development（已解析）',
      runtimeUrl: 'http://127.0.0.1:8765',
      hostedStatus: 'ready',
      directoryStatus: 'ready',
      selectedAgent: {
        id: 'general',
        label: '通用智能体',
      },
    })

    expect(buildSessionDebugSummary(createSessionShell())).toEqual({
      sessionId: 'session-1',
      boundAgent: 'general',
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: ['tool.file-convert', 'tool.remote-search'],
      recommendedTools: ['tool.file-convert'],
      defaultEnabledTools: ['tool.file-convert'],
      defaultEnabledSource: {
        boundAgent: 'general',
        defaultModelPreference: 'openai/gpt-4.1',
        toolSelectionMode: 'recommendation-only',
      },
    })
  })

  it('creates composer defaults from session capabilities instead of hardcoded values', () => {
    const draft = createComposerDraftFromSession(createSessionShell())

    expect(draft).toEqual({
      messageText: '',
      model: DEFAULT_COPILOT_MODEL_ID,
      enabledTools: ['tool.file-convert'],
      requestOptionsText: '{}',
    })
  })

  it('builds request-scoped message input with sessionId, boundAgent validation value, model, enabledTools and requestOptions', () => {
    const sessionShell = createSessionShell()
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionShell,
      draft: {
        messageText: '请总结这份文档',
        model: 'qwen-plus',
        enabledTools: ['tool.remote-search', 'tool.file-convert', 'tool.remote-search'],
        requestOptionsText: '{"trace":true}',
      },
      requestOptions: {
        trace: true,
      },
    })

    expect(input).toEqual({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionId: 'session-1',
      agent: 'general',
      message: {
        role: 'user',
        content: '请总结这份文档',
      },
      model: 'qwen-plus',
      enabledTools: ['tool.remote-search', 'tool.file-convert'],
      requestOptions: {
        trace: true,
      },
    })
  })

  it('parses minimal requestOptions json object and rejects non-object payloads', () => {
    expect(parseRequestOptionsText('{"trace":true}')).toEqual({ trace: true })
    expect(() => parseRequestOptionsText('[]')).toThrow('requestOptions 必须是 JSON 对象。')
  })

  it('formats structured backend errors into explicit user-facing messages', () => {
    expect(formatRuntimeMessageSendError(new RuntimeRequestError('agent_mismatch: session bound agent differs', {
      code: 'agent_mismatch',
      status: 409,
    }))).toContain('agent_mismatch：当前消息携带的 agent 校验值与会话绑定智能体不一致')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('tool_not_found: unknown tool', {
      code: 'tool_not_found',
      status: 400,
    }))).toContain('tool_not_found：本次消息启用了后端未注册的 toolId')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('invalid_request: bad payload', {
      code: 'invalid_request',
      status: 400,
    }))).toContain('invalid_request：消息请求结构无效')
  })
})
