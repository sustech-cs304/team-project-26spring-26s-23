import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CopilotBootstrapState, CopilotDiagnosticsSummary } from './types'
import { CopilotChatPanel } from './CopilotChatPanel'

const mockUseCopilotChatInternal = vi.fn()
const mockUseCopilotContext = vi.fn()

vi.mock('@copilotkit/react-core', () => ({
  useCopilotChatInternal: () => mockUseCopilotChatInternal(),
  useCopilotContext: () => mockUseCopilotContext(),
}))

describe('CopilotChatPanel', () => {
  beforeEach(() => {
    mockUseCopilotChatInternal.mockReset()
    mockUseCopilotContext.mockReset()

    mockUseCopilotChatInternal.mockReturnValue({
      messages: [],
      sendMessage: vi.fn(),
      isLoading: false,
      isAvailable: true,
      reset: vi.fn(),
    })

    mockUseCopilotContext.mockReturnValue({
      bannerError: null,
      setBannerError: vi.fn(),
      setThreadId: vi.fn(),
      threadId: 'general-project-sync',
    })
  })

  it('renders the mounted chat surface in ready state instead of the old placeholder copy', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        threadId="general-project-sync"
      />,
    )

    expect(html).toContain('最小聊天已挂载')
    expect(html).toContain('当前 threadId')
    expect(html).toContain('copilot-chat__stream')
    expect(html).not.toContain('后续接入占位')
  })

  it('renders runtime failures as inline red error messages inside the chat stream', () => {
    mockUseCopilotContext.mockReturnValue({
      bannerError: { message: 'agent_execution_failed: model crashed' },
      setBannerError: vi.fn(),
      setThreadId: vi.fn(),
      threadId: 'general-project-sync',
    })

    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createReadyState()}
        retrying={false}
        retry={() => {}}
        threadId="general-project-sync"
      />,
    )

    expect(html).toContain('运行时错误')
    expect(html).toContain('agent_execution_failed: model crashed')
    expect(html).toContain('copilot-chat__message--error')
  })

  it('keeps the non-connected branch intact for empty state', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createEmptyState()}
        retrying={false}
        retry={() => {}}
        threadId="general-project-sync"
      />,
    )

    expect(html).toContain('尚未获得可用运行时')
    expect(html).toContain('Runtime URL（仅开发态可手填）')
    expect(html).not.toContain('copilot-chat__stream')
  })

  it('keeps the failed branch intact and does not swallow startup failures', () => {
    const html = renderToStaticMarkup(
      <CopilotChatPanel
        state={createFailedState()}
        retrying={false}
        retry={() => {}}
        threadId="general-project-sync"
      />,
    )

    expect(html).toContain('宿主启动后端失败')
    expect(html).toContain('重试启动宿主后端')
    expect(html).toContain('spawn_failed')
    expect(html).not.toContain('copilot-chat__stream')
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
    agentName: null,
    agentNameSource: 'missing',
    diagnostics: createDiagnosticsSummary({
      hostedStatus: 'stopped',
      modeSource: 'expected',
      runtimeSource: 'none',
    }),
    missingFields: ['runtimeUrl', 'agentName'],
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
