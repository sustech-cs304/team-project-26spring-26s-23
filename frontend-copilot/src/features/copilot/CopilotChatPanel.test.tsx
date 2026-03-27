import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { AssistantAgentDirectoryState } from '../../workbench/assistant/AssistantWorkspace'
import type { AgentType, AssistantSessionShell } from '../../workbench/types'
import { CopilotChatPanel } from './CopilotChatPanel'
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
    expect(html).toContain('消息发送将在下一阶段接入')
    expect(html).toContain('当前不会静默回落到旧 Provider 消息路径')
    expect(html).not.toContain('当前 threadId')
    expect(html).not.toContain('发送消息')
  })

  it('renders bound session metadata once the new shell holds sessionId + boundAgent', () => {
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

    expect(html).toContain('当前会话已绑定智能体')
    expect(html).toContain('session-1')
    expect(html).toContain('通用助手')
    expect(html).toContain('下一阶段将在此处接入')
    expect(html).not.toContain('当前 threadId')
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
    label: '通用助手',
    shortLabel: '通用助手',
    description: '默认通用智能体',
    status: 'active',
    icon: (() => null) as AgentType['icon'],
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
    recommendedTools: ['tool.file-convert'],
    defaultModelPreference: 'openai/gpt-4.1',
  }
}
