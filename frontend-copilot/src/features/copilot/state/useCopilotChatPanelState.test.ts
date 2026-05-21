/** @vitest-environment jsdom */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CopilotRunState, CopilotBootstrapState } from '../types'
import type { CopilotMessageListItem } from '../run-segment-view-model'
const mockIdleRunState: CopilotRunState = {
  phase: 'idle',
  runId: null,
  threadId: null,
  activeModelRoute: null,
  resolvedModelId: null,
  resolvedModelRoute: null,
  resolvedToolIds: [],
  requestOptions: {},
  requestedThinkingSelection: null,
  appliedThinkingSelection: null,
  requestedThinkingLevel: null,
  appliedThinkingLevel: null,
  thinkingCapabilitySnapshot: null,
  thinkingSeriesDecision: null,
  reasoningSuppressionBasis: null,
  reasoningSuppressed: false,
  reasoningTraceState: 'not_observed',
  diagnostic: null,
  failure: null,
  cancelReason: null,
  segments: [],
}

const mockEmptyComposerDraft = {
  messageText: '',
  selectedModelId: '',
  selectedModelRoute: null,
  thinkingSelection: null,
  thinkingSelectionByModelKey: {},
  enabledTools: [],
  requestOptionsText: '{}',
}

const mockEmptyAttachments = {
  items: [],
  panelOpen: false,
  isDragActive: false,
  dragDepth: 0,
  notice: null,
  preview: {
    open: false,
    attachmentId: null,
    status: 'idle' as const,
    kind: null,
    title: '',
    previewUrl: null,
    text: '',
    truncated: false,
    message: null,
  },
}

function createMockTransientState(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: '',
    composerDraft: { ...mockEmptyComposerDraft },
    composerAttachments: { ...mockEmptyAttachments },
    conversation: [] as CopilotMessageListItem[],
    runState: { ...mockIdleRunState },
    sendError: null,
    thinkingCapability: null,
    historyRebindAcknowledged: false,
    activeAbortController: null,
    pendingHistorySyncRunId: null,
    lastSettledRunId: null,
    pendingHistorySyncLogKey: null,
    lastAccessedAt: Date.now(),
    ...overrides,
  }
}

vi.mock('../attachments/state', () => ({
  createEmptyComposerAttachmentsState: vi.fn(() => ({ ...mockEmptyAttachments })),
  revokeComposerAttachmentPreviewUrls: vi.fn(),
}))

vi.mock('../../../workbench/settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(async () => ({ ok: false as const })),
}))

vi.mock('../chat-contract', () => {
  class RuntimeRequestError extends Error {
    code: string | null
    status: number | null
    details: Record<string, unknown>
    constructor(message: string, code?: string | null, details?: Record<string, unknown>) {
      super(message)
      this.code = code ?? null
      this.status = null
      this.details = details ?? {}
    }
  }
  return {
    cancelRuntimeRun: vi.fn(),
    getRuntimeThinkingCapability: vi.fn(async () => ({ capability: null as unknown })),
    RuntimeRequestError,
  }
})

vi.mock('../tool-approval', () => ({
  resolveRuntimeToolApproval: vi.fn(),
}))

vi.mock('../debug-mode-log', () => ({
  appendCopilotDebugLog: vi.fn(),
  isCopilotDebugModeEnabled: vi.fn(() => false),
}))

vi.mock('../run-segment-reducer', () => ({
  expirePendingCopilotInlineFormSegments: vi.fn((runState: CopilotRunState) => runState),
  markCopilotInlineFormSubmitted: vi.fn((runState: CopilotRunState) => runState),
}))

vi.mock('../copilot-chat-helpers', () => ({
  applyModelSelectionToComposerDraft: vi.fn((draft: typeof mockEmptyComposerDraft) => draft),
  buildRuntimeToolPermissionPolicy: vi.fn(() => null),
  buildRuntimeDebugSummary: vi.fn(() => null),
  buildRuntimeThinkingCapabilityFromError: vi.fn(() => ({
    status: 'unknown-without-override' as const,
    source: 'unknown' as const,
    series: null,
    seriesLabelZh: null,
    editorType: null,
    allowedValues: [],
    defaultValue: null,
    providerBuilderKey: null,
    supported: false,
    controlSpec: null,
    defaultSelection: null,
    supportedLevels: [],
    defaultLevel: null,
    reasonCode: 'thinking_capability_query_failed',
    providerHint: null,
    provenance: null,
    visibility: null,
    routeFingerprint: { providerProfileId: '', provider: '', endpointType: '', baseUrl: '', modelId: '' },
    overrideLevels: [],
  })),
  buildSessionDebugSummary: vi.fn(() => null),
}))

vi.mock('../persisted-history-drift', () => ({
  resolvePersistedHistoryDrift: vi.fn(() => null),
}))

vi.mock('../persisted-history-view-model', () => ({
  buildPersistedConversationFromHistory: vi.fn(() => ({
    conversation: [] as CopilotMessageListItem[],
    selectedRunConversationSource: 'none' as const,
  })),
  getPersistedInlineFormRebuildability: vi.fn(() => ({ hasPendingInlineForm: false })),
}))

vi.mock('../run-segment-view-model', () => ({
  buildCopilotMessageListItems: vi.fn(() => [] as CopilotMessageListItem[]),
  resolveCopilotAssistantPlaceholderState: vi.fn(() => null),
}))

vi.mock('../model-picker', () => ({
  createCopilotModelCatalog: vi.fn(() => ({ groups: [], models: [] })),
  getCopilotModelById: vi.fn(() => null),
  resolveCopilotPreferredModelId: vi.fn(() => ''),
}))

vi.mock('../copilot-send-controller', () => ({
  createIdleCopilotRunState: vi.fn(() => ({ ...mockIdleRunState })),
  dispatchCopilotMessage: vi.fn(),
  getCopilotSendDisabledReason: vi.fn(() => null),
  orchestrateCopilotSend: vi.fn(),
}))

vi.mock('../copilot-panel-diagnostics', () => ({
  isCopilotConnectableState: vi.fn(() => false),
}))

vi.mock('../thread-runtime-controller', () => ({
  resolveCopilotThreadRuntimeControllerState: vi.fn(
    (_stateBySessionId: Record<string, unknown>, sessionId: string | null | undefined) => {
      const normalizedSessionId = (sessionId ?? '').trim()
      return createMockTransientState(normalizedSessionId ? { sessionId: normalizedSessionId } : {})
    },
  ),
  updateCopilotThreadRuntimeControllerStateRecord: vi.fn(
    (stateBySessionId: Record<string, unknown>, sessionId: string, updater: (state: unknown) => unknown) => {
      const existing = stateBySessionId[sessionId] as ReturnType<typeof createMockTransientState> ?? createMockTransientState({ sessionId })
      const next = updater(existing)
      return { ...stateBySessionId, [sessionId]: next }
    },
  ),
}))

vi.mock('../useAssistantMessageNotification', () => ({
  useAssistantMessageNotification: vi.fn(),
}))

vi.mock('../useCopilotComposerResize', () => ({
  useCopilotComposerResize: vi.fn(() => ({
    composerHeight: 160,
    onComposerResizeStart: vi.fn(),
  })),
}))

vi.mock('./CopilotChatPanelViewModel', () => ({
  isSameModelRoute: vi.fn(() => false),
  resolveComposerDraftModelSelection: vi.fn((draft: typeof mockEmptyComposerDraft) => draft),
  resolveDisplayedThinkingCapability: vi.fn(() => null),
  resolveSelectedComposerModelRoute: vi.fn(() => null),
}))

function createReadyState(): CopilotBootstrapState {
  return {
    status: 'ready',
    bootstrapFields: {
      runtimeUrl: 'http://127.0.0.1:8765',
      agentName: null,
      debugModeEnabled: false,
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
  }
}

function createSessionShell(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    boundAgent: {
      id: 'general',
      label: '通用智能体',
      shortLabel: '通用智能体',
      description: '默认通用智能体',
      hint: '默认使用所有工具',
      status: 'active' as const,
      icon: (() => null) as unknown as any,
      recommendedTools: ['tool.fs.read'],
    },
    createdAt: '2026-03-27T10:00:00Z',
    updatedAt: '2026-03-27T10:00:00Z',
    capabilities: {
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [
        { toolId: 'tool.fs.read', kind: 'builtin' as const, availability: 'available' as const, displayName: '读取文件', description: '读取项目内文件内容。' },
      ],
      recommendedToolsForAgent: ['tool.fs.read'],
      defaultEnabledTools: ['tool.fs.read'],
      toolSelectionMode: 'recommendation-only' as const,
    },
    ...overrides,
  }
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

// =============================================================================
// Pure function tests: hasPendingInlineFormSegment
// =============================================================================
describe('hasPendingInlineFormSegment', () => {
  it('returns false for idle run state with no segments', async () => {
    const { hasPendingInlineFormSegment } = await import('./useCopilotChatPanelState')

    expect(hasPendingInlineFormSegment(mockIdleRunState)).toBe(false)
  })

  it('returns true when a pending inline form segment exists', async () => {
    const { hasPendingInlineFormSegment } = await import('./useCopilotChatPanelState')

    const state: CopilotRunState = {
      ...mockIdleRunState,
      segments: [
        {
          id: 'form-1',
          kind: 'inline-form',
          runId: 'run-1',
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          toolCallId: 'tool-1',
          toolId: 'tool.x',
          formId: 'form-a',
          title: 'Test Form',
          summary: 'summary',
          description: null,
          submitLabel: 'Submit',
          fields: [],
          formState: 'pending',
          formValues: {},
          submittedPayload: null,
        } as any,
      ],
    }

    expect(hasPendingInlineFormSegment(state)).toBe(true)
  })

  it('returns false when only completed inline form segments exist', async () => {
    const { hasPendingInlineFormSegment } = await import('./useCopilotChatPanelState')

    const state: CopilotRunState = {
      ...mockIdleRunState,
      segments: [
        {
          id: 'form-1',
          kind: 'inline-form',
          runId: 'run-1',
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          toolCallId: 'tool-1',
          toolId: 'tool.x',
          formId: 'form-a',
          title: 'Test Form',
          summary: 'summary',
          description: null,
          submitLabel: 'Submit',
          fields: [],
          formState: 'submitted',
          formValues: {},
          submittedPayload: null,
        } as any,
      ],
    }

    expect(hasPendingInlineFormSegment(state)).toBe(false)
  })

  it('returns false for non-inline-form segments', async () => {
    const { hasPendingInlineFormSegment } = await import('./useCopilotChatPanelState')

    const state: CopilotRunState = {
      ...mockIdleRunState,
      segments: [
        {
          id: 'tool-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 1,
          lastSequence: 1,
          status: 'completed',
          toolCallId: 'tc-1',
          toolId: 'tool.x',
          phases: [],
        } as any,
      ],
    }

    expect(hasPendingInlineFormSegment(state)).toBe(false)
  })
})

// =============================================================================
// Pure function tests: hasSufficientPersistedConversationForRun
// =============================================================================
describe('hasSufficientPersistedConversationForRun', () => {
  it('returns false for empty conversation', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    expect(
      hasSufficientPersistedConversationForRun({
        conversation: [],
        runId: 'run-1',
        runPhase: 'idle',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(false)
  })

  it('returns true for non-terminal phase with conversation', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'idle',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(true)
  })

  it('returns true for streaming phase with conversation', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'streaming',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(true)
  })

  it('returns true for starting phase with conversation', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'starting',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(true)
  })

  it('returns false for failed phase without terminal item', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'failed',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(false)
  })

  it('returns true for failed phase with matching terminal item', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      {
        id: 'term-1',
        kind: 'terminal',
        runId: 'run-1',
        terminalPhase: 'failed',
        sequence: 1,
        status: 'completed',
        title: 'Error',
        content: 'Something went wrong',
      } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'failed',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(true)
  })

  it('returns true for cancelled phase with matching terminal item', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      {
        id: 'term-1',
        kind: 'terminal',
        runId: 'run-1',
        terminalPhase: 'cancelled',
        sequence: 1,
        status: 'completed',
        title: 'Cancelled',
        content: 'Run was cancelled',
      } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'cancelled',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(true)
  })

  it('returns false for cancelled phase with mismatched terminal phase', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      {
        id: 'term-1',
        kind: 'terminal',
        runId: 'run-1',
        terminalPhase: 'failed',
        sequence: 1,
        status: 'completed',
        title: 'Error',
        content: 'Something went wrong',
      } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'cancelled',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(false)
  })

  it('returns false for cancelled phase with mismatched terminal runId', async () => {
    const { hasSufficientPersistedConversationForRun } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      {
        id: 'term-1',
        kind: 'terminal',
        runId: 'run-2',
        terminalPhase: 'cancelled',
        sequence: 1,
        status: 'completed',
        title: 'Cancelled',
        content: 'Run was cancelled',
      } as CopilotMessageListItem,
    ]

    expect(
      hasSufficientPersistedConversationForRun({
        conversation,
        runId: 'run-1',
        runPhase: 'cancelled',
        sessionHistory: null,
        runState: mockIdleRunState,
      }),
    ).toBe(false)
  })
})

// =============================================================================
// Pure function tests: resolvePersistedConversationHandoffWaitReason
// =============================================================================
describe('resolvePersistedConversationHandoffWaitReason', () => {
  it('returns "persisted-handoff-run-empty" for empty conversation', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation: [],
        pendingRunId: 'run-1',
        runState: mockIdleRunState,
        sessionHistory: null,
      }),
    ).toBe('persisted-handoff-run-empty')
  })

  it('returns null when pendingRunId is empty string', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: '',
        runState: mockIdleRunState,
        sessionHistory: null,
      }),
    ).toBeNull()
  })

  it('returns null when pendingRunId is null', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: null,
        runState: mockIdleRunState,
        sessionHistory: null,
      }),
    ).toBeNull()
  })

  it('returns null when pendingRunId does not match current runId', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: 'run-2',
        runState: { ...mockIdleRunState, runId: 'run-1' },
        sessionHistory: null,
      }),
    ).toBeNull()
  })

  it('returns null for completed phase with conversation', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: 'run-1',
        runState: { ...mockIdleRunState, phase: 'completed', runId: 'run-1' },
        sessionHistory: null,
      }),
    ).toBeNull()
  })

  it('returns "failed-terminal-missing-from-handoff" for failed phase without terminal', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: 'run-1',
        runState: { ...mockIdleRunState, phase: 'failed', runId: 'run-1' },
        sessionHistory: null,
      }),
    ).toBe('failed-terminal-missing-from-handoff')
  })

  it('returns "cancelled-terminal-missing-from-handoff" for cancelled phase without terminal', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      { id: '1', kind: 'user', title: 'User', content: 'Hello', status: 'completed' } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: 'run-1',
        runState: { ...mockIdleRunState, phase: 'cancelled', runId: 'run-1' },
        sessionHistory: null,
      }),
    ).toBe('cancelled-terminal-missing-from-handoff')
  })

  it('returns null for failed phase with matching terminal item', async () => {
    const { resolvePersistedConversationHandoffWaitReason } = await import('./useCopilotChatPanelState')

    const conversation: CopilotMessageListItem[] = [
      {
        id: 'term-1',
        kind: 'terminal',
        runId: 'run-1',
        terminalPhase: 'failed',
        sequence: 1,
        status: 'completed',
        title: 'Error',
        content: 'Something went wrong',
      } as CopilotMessageListItem,
    ]

    expect(
      resolvePersistedConversationHandoffWaitReason({
        conversation,
        pendingRunId: 'run-1',
        runState: { ...mockIdleRunState, phase: 'failed', runId: 'run-1' },
        sessionHistory: null,
      }),
    ).toBeNull()
  })
})

// =============================================================================
// Hook tests using renderToStaticMarkup (lightweight, no full react-dom render)
// We test the hook by wrapping it in a minimal component that produces static markup.
// This avoids the OOM issues of renderHook with the heavy hook.
// =============================================================================
describe('useCopilotChatPanelState (via static render)', () => {
  it('exports the main hook as a function', async () => {
    const mod = await import('./useCopilotChatPanelState')

    expect(typeof mod.useCopilotChatPanelState).toBe('function')
  })

  it('exports hasPendingInlineFormSegment', async () => {
    const mod = await import('./useCopilotChatPanelState')

    expect(typeof mod.hasPendingInlineFormSegment).toBe('function')
  })

  it('exports hasSufficientPersistedConversationForRun', async () => {
    const mod = await import('./useCopilotChatPanelState')

    expect(typeof mod.hasSufficientPersistedConversationForRun).toBe('function')
  })

  it('exports resolvePersistedConversationHandoffWaitReason', async () => {
    const mod = await import('./useCopilotChatPanelState')

    expect(typeof mod.resolvePersistedConversationHandoffWaitReason).toBe('function')
  })

  it('hook renders in a thin component without throwing', async () => {
    const { useCopilotChatPanelState } = await import('./useCopilotChatPanelState')

    function SimpleComponent() {
      const state = useCopilotChatPanelState({
        language: 'zh-CN',
        state: createReadyState(),
        retrying: false,
        retry: vi.fn(),
        selectedAgent: null,
        sessionShell: null,
        directoryState: {
          status: 'ready',
          directoryVersion: 'agents-v1',
          defaultAgentId: 'general',
          agents: [],
          error: null,
        },
        sessionStatus: 'idle',
        sessionError: null,
      })

      void state // use it to prevent dead-code elimination

      return React.createElement('div', { 'data-testid': 'wrapper' }, 'hook worked')
    }

    const html = renderToStaticMarkup(React.createElement(SimpleComponent))

    expect(html).toContain('hook worked')
    expect(html).toContain('data-testid="wrapper"')
  })

  it('hook renders with sessionShell without throwing', async () => {
    const { useCopilotChatPanelState } = await import('./useCopilotChatPanelState')

    function SimpleComponent() {
      const state = useCopilotChatPanelState({
        language: 'zh-CN',
        state: createReadyState(),
        retrying: false,
        retry: vi.fn(),
        selectedAgent: null,
        sessionShell: createSessionShell(),
        directoryState: {
          status: 'ready',
          directoryVersion: 'agents-v1',
          defaultAgentId: 'general',
          agents: [],
          error: null,
        },
        sessionStatus: 'idle',
        sessionError: null,
      })

      void state

      return React.createElement('div', { 'data-testid': 'wrapper-with-session' }, 'hook with session')
    }

    const html = renderToStaticMarkup(React.createElement(SimpleComponent))

    expect(html).toContain('hook with session')
  })

  it('hook renders with runtimeControllerBySessionId without throwing', async () => {
    const { useCopilotChatPanelState } = await import('./useCopilotChatPanelState')

    function SimpleComponent() {
      const state = useCopilotChatPanelState({
        language: 'zh-CN',
        state: createReadyState(),
        retrying: false,
        retry: vi.fn(),
        selectedAgent: null,
        sessionShell: createSessionShell(),
        directoryState: {
          status: 'ready',
          directoryVersion: 'agents-v1',
          defaultAgentId: 'general',
          agents: [],
          error: null,
        },
        sessionStatus: 'idle',
        sessionError: null,
        runtimeControllerBySessionId: {},
      })

      void state

      return React.createElement('div', { 'data-testid': 'wrapper-with-runtime' }, 'hook with runtime')
    }

    const html = renderToStaticMarkup(React.createElement(SimpleComponent))

    expect(html).toContain('hook with runtime')
  })

  it('hook returns object with all public properties', async () => {
    const { useCopilotChatPanelState } = await import('./useCopilotChatPanelState')

    const capturedState: Record<string, unknown> = {}

    function CapturingComponent() {
      const state = useCopilotChatPanelState({
        language: 'zh-CN',
        state: createReadyState(),
        retrying: false,
        retry: vi.fn(),
        selectedAgent: null,
        sessionShell: createSessionShell(),
        directoryState: {
          status: 'ready',
          directoryVersion: 'agents-v1',
          defaultAgentId: 'general',
          agents: [],
          error: null,
        },
        sessionStatus: 'idle',
        sessionError: null,
      })

      Object.assign(capturedState, state)

      return null
    }

    renderToStaticMarkup(React.createElement(CapturingComponent))

    expect(capturedState).toHaveProperty('sendError')
    expect(capturedState).toHaveProperty('modelGroups')
    expect(capturedState).toHaveProperty('thinkingCapability')
    expect(capturedState).toHaveProperty('composerDraft')
    expect(capturedState).toHaveProperty('composerAttachments')
    expect(capturedState).toHaveProperty('toolPermissionPolicy')
    expect(typeof capturedState.onComposerDraftChange).toBe('function')
    expect(typeof capturedState.onComposerAttachmentsChange).toBe('function')
    expect(typeof capturedState.onSend).toBe('function')
    expect(typeof capturedState.onSubmitInlineForm).toBe('function')
    expect(typeof capturedState.onCancelCurrentRun).toBe('function')
    expect(typeof capturedState.onResolveToolApproval).toBe('function')
    expect(capturedState.sendStatus).toBe('idle')
    expect(capturedState.canCancelSend).toBe(false)
    expect(capturedState.sendDisabledReason).toBe(null)
    expect(capturedState.composerLockedReason).toBe(null)
    expect(capturedState.historyDrift).toBe(null)
    expect(capturedState.historyRebindAcknowledged).toBe(false)
    expect(capturedState.persistedSelectedRunConversationSource).toBe('none')
    expect(capturedState.persistedSelectedRunConversationPending).toBe(false)
    expect(capturedState.hasTransientConversation).toBe(false)
    expect(Array.isArray(capturedState.conversation)).toBe(true)
    expect(capturedState.assistantPlaceholder).toBe(null)
    expect(capturedState.runtimeUrl).toBe(null)
    expect(capturedState.composerInputRef).toHaveProperty('current')
    expect(typeof capturedState.composerHeight).toBe('number')
    expect(typeof capturedState.onComposerResizeStart).toBe('function')
  })
})
