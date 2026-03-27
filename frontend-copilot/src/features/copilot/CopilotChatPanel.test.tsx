import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AssistantAgentDirectoryState } from '../../workbench/assistant/AssistantWorkspace'
import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import {
  buildRuntimeDebugSummary,
  buildSessionDebugSummary,
  buildRuntimeMessageSendInput,
  CopilotChatPanel,
  createComposerDraftFromSession,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
} from './CopilotChatPanel'
import { RuntimeRequestError } from './chat-contract'
import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './types'

describe('CopilotChatPanel', () => {
  it('renders the session-first placeholder when runtime is ready but no session has been created yet', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={null}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
      />,
    )

    expect(html).toContain('尚未创建会话')
    expect(html).toContain('会话创建成功后会立即拉取')
    expect(html).toContain('消息发送只会从新的 session-first message/send 路径进入')
    expect(html).toContain('当前不会静默回落到旧 Provider 消息路径')
    expect(html).not.toContain('当前 Runtime URL')
    expect(html).not.toContain('当前 threadId')
    expect(html).not.toContain('发送消息')
  })

  it('renders the minimal message shell for a bound session without the removed debug information blocks', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={createSelectedAgent()}
        sessionShell={createSessionShell()}
        directoryState={createDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
      />,
    )

    expect(html).toContain('当前校验 Agent')
    expect(html).toContain('general')
    expect(html).toContain('消息级模型')
    expect(html).toContain('requestOptions（JSON 对象）')
    expect(html).toContain('消息级 enabledTools')
    expect(html).toContain('发送消息')
    expect(html).not.toContain('当前 Runtime URL')
    expect(html).not.toContain('Runtime 来源')
    expect(html).not.toContain('目录状态')
    expect(html).not.toContain('Capabilities Version')
    expect(html).not.toContain('总体可用工具集合（后端能力面真源）')
    expect(html).not.toContain('当前默认启用来源')
    expect(html).not.toContain('当前 threadId')
  })

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
      model: 'openai/gpt-4.1',
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

  it('keeps the non-connected branch intact for empty state', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createEmptyState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={null}
        sessionShell={null}
        directoryState={createIdleDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
      />,
    )

    expect(html).toContain('尚未获得可用运行时')
    expect(html).toContain('Runtime URL（仅开发态可手填）')
    expect(html).not.toContain('session-1')
  })

  it('keeps the failed branch intact and does not swallow startup failures', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createFailedState()}
        retrying={false}
        retry={() => {}}
        selectedAgent={null}
        sessionShell={null}
        directoryState={createIdleDirectoryState()}
        sessionStatus="idle"
        sessionError={null}
      />,
    )

    expect(html).toContain('宿主启动后端失败')
    expect(html).toContain('重试启动宿主后端')
    expect(html).toContain('spawn_failed')
    expect(html).not.toContain('当前 threadId')
  })
})

function createDiagnosticsSummary(
  overrides: Partial<CopilotDiagnosticsSummary> = {},
): CopilotDiagnosticsSummary {
  return {
    hostedStatus: 'ready',
    failure: null,
    mode: 'development',
    modeSource: 'resolved',
    runtimeSource: 'hosted',
    ...overrides,
  }
}

function createBaseResolvedState(): Omit<Extract<CopilotBootstrapState, { status: 'ready' }>, 'status'> {
  return {
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
    diagnostics: createDiagnosticsSummary(),
    devOverrideAllowed: true,
    devOverrideConfigured: false,
  }
}

function createReadyState(): CopilotBootstrapState {
  return {
    status: 'ready',
    ...createBaseResolvedState(),
  }
}

function createEmptyState(): CopilotBootstrapState {
  return {
    ...createBaseResolvedState(),
    status: 'empty',
    runtime: {
      status: 'stopped',
      expectedMode: 'development',
      resolvedMode: null,
      runtimeUrl: null,
      isPackaged: false,
      failure: null,
    },
    runtimeUrl: null,
    runtimeSource: 'none',
    diagnostics: createDiagnosticsSummary({
      hostedStatus: 'stopped',
      modeSource: 'expected',
      runtimeSource: 'none',
    }),
    missingFields: ['runtimeUrl'],
  }
}

function createFailedState(): CopilotBootstrapState {
  return {
    ...createBaseResolvedState(),
    status: 'failed',
    runtime: {
      status: 'failed',
      expectedMode: 'bundled',
      resolvedMode: 'bundled',
      runtimeUrl: null,
      isPackaged: true,
      failure: {
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Bundled backend process failed to boot.',
        retryable: true,
        exitCode: 1,
        signal: null,
        timestamp: '2026-03-24T00:00:00.000Z',
      },
    },
    runtimeUrl: null,
    runtimeSource: 'none',
    diagnostics: createDiagnosticsSummary({
      hostedStatus: 'failed',
      mode: 'bundled',
      failure: {
        code: 'spawn_failed',
        phase: 'spawn',
        message: 'Bundled backend process failed to boot.',
        retryable: true,
        exitCode: 1,
        signal: null,
        timestamp: '2026-03-24T00:00:00.000Z',
      },
      runtimeSource: 'none',
    }),
  }
}

function createSelectedAgent(): AgentType {
  return {
    id: 'general',
    label: '通用智能体',
    shortLabel: '通用智能体',
    description: '默认通用智能体',
    hint: '默认使用所有工具',
    status: 'active',
    icon: ((() => null) as unknown) as AgentType['icon'],
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
  }
}

function createDirectoryState(): AssistantAgentDirectoryState {
  return {
    status: 'ready',
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [createSelectedAgent()],
    error: null,
  }
}

function createIdleDirectoryState(): AssistantAgentDirectoryState {
  return {
    status: 'idle',
    directoryVersion: null,
    defaultAgentId: null,
    agents: [],
    error: null,
  }
}

function createSessionShell(): AssistantSessionShell {
  return {
    sessionId: 'session-1',
    boundAgent: createSelectedAgent(),
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
  }
}
