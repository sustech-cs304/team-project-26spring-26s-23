import { describe, expect, it, vi } from 'vitest'

import type { CopilotModelOption } from './model-picker'
import type { RuntimeRunEvent } from './thread-run-contract'
import {
  createFetchResponse,
  createFetchSequence,
  createRuntimeErrorPayload,
  createRuntimeModelRoute,
  createRuntimeRunCompletedEvent,
  createRuntimeRunStartResponse,
  createRuntimeThinkingSelection,
  createSseEventStream,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './thread-run-contract.test-support'
import { createIdleCopilotRunState } from './copilot-send-controller'
import { dispatchCopilotMessage, getCopilotSendDisabledReason } from './copilot-send-controller'
import type { AssistantSessionShell } from '../../workbench/types'
import type { CopilotBootstrapState, CopilotRunState } from './types'
import type { CopilotChatComposerDraft } from './copilot-chat-helpers'

const LABEL_HTTP_127 = 'http://127.0.0.1:8765/'

function createConnectableState(): CopilotBootstrapState {
  return {
    status: 'ready',
    bootstrapFields: {
      runtimeUrl: 'http://127.0.0.1:8765',
      agentName: 'general',
      debugModeEnabled: false,
    },
    storageState: 'stored',
    runtime: {
      status: 'running',
      resolvedMode: 'hosted',
      expectedMode: 'hosted',
      version: '1.0.0',
      pid: 1234,
      port: 8765,
    } as unknown as CopilotBootstrapState['runtime'],
    runtimeUrl: 'http://127.0.0.1:8765',
    runtimeSource: 'hosted',
    agentName: 'general',
    agentNameSource: 'config-center',
    diagnostics: {
      hostedStatus: 'running',
      failure: null,
      mode: 'hosted',
      modeSource: 'resolved',
      runtimeSource: 'hosted',
    },
    devOverrideAllowed: false,
    devOverrideConfigured: false,
  }
}

function createSessionShell(overrides: Partial<AssistantSessionShell> = {}): AssistantSessionShell {
  return {
    sessionId: 'session-1',
    boundAgent: {
      id: 'general',
      name: '通用助手',
      type: 'general',
      icon: 'sparkles',
    },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    capabilities: {
      capabilitiesVersion: 'v1',
      allAvailableTools: [],
      recommendedToolsForAgent: [],
      defaultEnabledTools: [],
      toolSelectionMode: 'recommendation-only',
    },
    ...overrides,
  }
}

function createComposerDraft(overrides: Partial<CopilotChatComposerDraft> = {}): CopilotChatComposerDraft {
  return {
    messageText: '你好',
    selectedModelId: 'qwen-plus',
    selectedModelRoute: createRuntimeModelRoute(),
    thinkingSelection: null,
    thinkingSelectionByModelKey: {},
    enabledTools: [],
    requestOptionsText: '{}',
    ...overrides,
  }
}

function createModelOption(overrides: Partial<CopilotModelOption> = {}): CopilotModelOption {
  return {
    id: 'qwen-plus',
    selectionValue: 'qwen-plus',
    modelId: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'openai',
    group: 'OpenAI',
    tags: [],
    icon: { label: 'Q', accent: '#000' },
    routeRef: {
      routeKind: 'provider-model',
      profileId: 'provider-openai',
      modelId: 'qwen-plus',
    },
    route: createRuntimeModelRoute(),
    available: true,
    unavailableReason: null,
    thinkingCapabilityOverride: null,
    ...overrides,
  }
}

describe('getCopilotSendDisabledReason', () => {
  const runState = createIdleCopilotRunState()
  const connectableState = createConnectableState()
  const sessionShell = createSessionShell()
  const draft = createComposerDraft()

  it('returns reason when state is not connectable (loading)', () => {
    const reason = getCopilotSendDisabledReason({
      state: { status: 'loading' },
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('当前运行态未就绪，无法发送消息。')
  })

  it('returns reason when session shell is null', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell: null,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('请先创建会话。')
  })

  it('returns reason when run is already starting', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState: { ...runState, phase: 'starting' },
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('当前消息仍在发送中。')
  })

  it('returns reason when run is streaming', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState: { ...runState, phase: 'streaming' },
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('当前消息仍在发送中。')
  })

  it('returns reason when no models are configured', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: false,
      hasAvailableModels: false,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('尚未配置模型，请先前往设置页完成模型配置。')
  })

  it('returns unavailable reason when selected model is specifically unavailable', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: false,
      selectedModelOption: createModelOption({
        available: false,
        unavailableReason: '该模型需要额外配置。',
      }),
    })
    expect(reason).toBe('该模型需要额外配置。')
  })

  it('returns default unavailable message when selected model is unavailable without reason', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: false,
      selectedModelOption: createModelOption({
        available: false,
        unavailableReason: null,
      }),
    })
    expect(reason).toBe('当前选择的模型不可用于聊天。')
  })

  it('returns reason when no models are available (generic, no specific model)', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: false,
      selectedModelOption: null,
    })
    expect(reason).toBe('当前没有可用模型，请前往设置页调整模型配置。')
  })

  it('returns reason when message is empty and no attachments', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: createComposerDraft({ messageText: '   ' }),
      hasAttachments: false,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('请输入消息内容。')
  })

  it('allows empty message when attachments are present', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: createComposerDraft({ messageText: '' }),
      hasAttachments: true,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBeNull()
  })

  it('returns reason when no model route or model id is selected', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: createComposerDraft({
        selectedModelRoute: null,
        selectedModelId: '',
      }),
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('请先选择模型。')
  })

  it('returns model unavailable reason when no model route is selected but selected model option is unavailable', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: createComposerDraft({
        selectedModelRoute: null,
        selectedModelId: '',
      }),
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption({
        available: false,
        unavailableReason: '服务已停用。',
      }),
    })
    expect(reason).toBe('服务已停用。')
  })

  it('returns streaming unsupported reason when route is invalid', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: createComposerDraft({
        selectedModelRoute: {
          routeRef: undefined as unknown as null,
        },
      }),
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBe('当前模型不可用，请重新选择。')
  })

  it('returns null when all checks pass', () => {
    const reason = getCopilotSendDisabledReason({
      state: connectableState,
      sessionShell,
      runState,
      composerDraft: draft,
      hasConfiguredModels: true,
      hasAvailableModels: true,
      selectedModelOption: createModelOption(),
    })
    expect(reason).toBeNull()
  })
})

describe('dispatchCopilotMessage', () => {
  it('emits terminal event upon successful run/start → run/stream cycle', async () => {
    const runEvents: RuntimeRunEvent[] = [
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId: 'session-1',
        sequence: 2,
      }),
    ]
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream(runEvents),
      }),
    )
    const onRunStart = vi.fn()

    const events: RuntimeRunEvent[] = []
    for await (const event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [],
      requestOptions: {},
      fetchFn: fetchFn as unknown as typeof fetch,
      onRunStart,
    })) {
      events.push(event)
    }

    expect(events.map((e) => e.type)).toEqual(['run_started', 'run_completed'])
    expect(onRunStart).toHaveBeenCalledOnce()
    expect(onRunStart).toHaveBeenCalledWith(
      expect.objectContaining({ run: expect.objectContaining({ runId: 'run-1' }) }),
    )
  })

  it('throws RuntimeRequestError when run/start fails with explicit backend error', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(
        createRuntimeErrorPayload({ code: 'invalid_request', message: 'bad model route' }),
        { ok: false, status: 400, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(async () => {
      for await (const _event of dispatchCopilotMessage({
        runtimeUrl,
        sessionId,
        agent: 'general',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        thinkingSelection: null,
        enabledTools: [],
        requestOptions: {},
        fetchFn: fetchFn as unknown as typeof fetch,
      })) {
        throw new Error(`Unexpected event: ${JSON.stringify(_event)}`)
      }
    }).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      code: 'invalid_request',
      status: 400,
    })
  })

  it('throws RuntimeRequestError when run/stream fetch fails with connectivity error', async () => {
    const rawFetchFn = vi.fn()
    rawFetchFn.mockResolvedValueOnce(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    rawFetchFn.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const fetchFn = rawFetchFn as unknown as typeof fetch

    await expect(async () => {
      for await (const _event of dispatchCopilotMessage({
        runtimeUrl,
        sessionId,
        agent: 'general',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        thinkingSelection: null,
        enabledTools: [],
        requestOptions: {},
        fetchFn,
      })) {
        // should not reach
      }
    }).rejects.toMatchObject({
      name: 'RuntimeRequestError',
      status: 0,
    })
  })

  it('throws AbortError when signal is aborted before run/start', async () => {
    const abortController = new AbortController()
    abortController.abort()

    await expect(async () => {
      for await (const _event of dispatchCopilotMessage({
        runtimeUrl,
        sessionId,
        agent: 'general',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        thinkingSelection: null,
        enabledTools: [],
        requestOptions: {},
        fetchFn: vi.fn().mockRejectedValue(
          (() => { const e = new Error('aborted'); e.name = 'AbortError'; return e })(),
        ) as unknown as typeof fetch,
        signal: abortController.signal,
      })) {
        // should not reach
      }
    }).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('throws when stream contains events with mismatched runId', async () => {
    const wrongRunEvents: RuntimeRunEvent[] = [
      {
        type: 'run_started',
        runId: 'wrong-run',
        sessionId: 'session-1',
        sequence: 1,
        payload: { assistantMessageId: 'msg-1' },
      },
    ]
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream(wrongRunEvents),
      }),
    )

    await expect(async () => {
      for await (const _event of dispatchCopilotMessage({
        runtimeUrl,
        sessionId,
        agent: 'general',
        message: createUserMessage(),
        modelRoute: createRuntimeModelRoute(),
        thinkingSelection: null,
        enabledTools: [],
        requestOptions: {},
        fetchFn: fetchFn as unknown as typeof fetch,
      })) {
        // should not reach runId mismatch error
      }
    }).rejects.toThrow(/Runtime event stream changed runId/)
  })

  it('calls onRunStart with the run start response', async () => {
    const runResponse = createRuntimeRunStartResponse({
      run: {
        runId: 'run-custom',
        threadId: 'session-1',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        startedAt: null,
        terminalAt: null,
        cancelRequested: false,
      },
      assistantMessageId: 'assistant-custom',
    })
    const fetchFn = createFetchSequence(
      createFetchResponse(runResponse, { headers: { 'content-type': 'application/json' } }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream([
          { type: 'run_started', runId: 'run-custom', sessionId: 'session-1', sequence: 1, payload: { assistantMessageId: 'assistant-custom' } },
          createRuntimeRunCompletedEvent({ runId: 'run-custom', sequence: 2 }),
        ]),
      }),
    )
    const onRunStart = vi.fn()

    for await (const _event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [],
      requestOptions: {},
      fetchFn: fetchFn as unknown as typeof fetch,
      onRunStart,
    })) {
      // consume
    }

    expect(onRunStart).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        run: expect.objectContaining({ runId: 'run-custom' }),
        assistantMessageId: 'assistant-custom',
      }),
    )
  })

  it('sends correct debugModeEnabled=true to the runtime API', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream([
          { type: 'run_started', runId: 'run-1', sessionId: 'session-1', sequence: 1, payload: { assistantMessageId: 'msg-1' } },
          createRuntimeRunCompletedEvent(),
        ]),
      }),
    )

    for await (const _event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [],
      debugModeEnabled: true,
      requestOptions: {},
      fetchFn: fetchFn as unknown as typeof fetch,
    })) {
      // consume
    }

    expect(fetchFn).toHaveBeenCalledTimes(2)
    const firstCallBody = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(firstCallBody.body.policy.debugModeEnabled).toBe(true)
  })

  it('passes thinking selection through to the runtime API', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream([
          { type: 'run_started', runId: 'run-1', sessionId: 'session-1', sequence: 1, payload: { assistantMessageId: 'msg-1' } },
          createRuntimeRunCompletedEvent(),
        ]),
      }),
    )

    const thinkingSelection = createRuntimeThinkingSelection({ level: 'auto' })

    for await (const _event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection,
      enabledTools: [],
      requestOptions: {},
      fetchFn: fetchFn as unknown as typeof fetch,
    })) {
      // consume
    }

    const firstCallBody = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(firstCallBody.body.policy.thinkingSelection).toBeDefined()
    expect(firstCallBody.body.policy.thinkingSelection.value.valueType).toBe('code')
  })

  it('passes requestOptions through to the runtime API', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream([
          { type: 'run_started', runId: 'run-1', sessionId: 'session-1', sequence: 1, payload: { assistantMessageId: 'msg-1' } },
          createRuntimeRunCompletedEvent(),
        ]),
      }),
    )

    for await (const _event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: [],
      requestOptions: { trace: true },
      fetchFn: fetchFn as unknown as typeof fetch,
    })) {
      // consume
    }

    const firstCallBody = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(firstCallBody.body.policy.requestOptions).toEqual({ trace: true })
  })

  it('passes toolPermissionPolicy through to the runtime API', async () => {
    const fetchFn = createFetchSequence(
      createFetchResponse(createRuntimeRunStartResponse(), {
        headers: { 'content-type': 'application/json' },
      }),
      createFetchResponse({}, {
        headers: { 'content-type': 'text/event-stream' },
        body: createSseEventStream([
          { type: 'run_started', runId: 'run-1', sessionId: 'session-1', sequence: 1, payload: { assistantMessageId: 'msg-1' } },
          createRuntimeRunCompletedEvent(),
        ]),
      }),
    )

    const toolPermissionPolicy = { defaultMode: 'auto_approve' } as const

    for await (const _event of dispatchCopilotMessage({
      runtimeUrl,
      sessionId,
      agent: 'general',
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      thinkingSelection: null,
      enabledTools: ['tool.fs.read'],
      toolPermissionPolicy: toolPermissionPolicy as unknown as Record<string, unknown> & { defaultMode: string; rules?: unknown[] },
      requestOptions: {},
      fetchFn: fetchFn as unknown as typeof fetch,
    })) {
      // consume
    }

    const firstCallBody = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(firstCallBody.body.policy.toolPermissionPolicy).toEqual(toolPermissionPolicy)
  })
})

describe('createIdleCopilotRunState', () => {
  it('returns a state object with phase idle', () => {
    const state = createIdleCopilotRunState()
    expect(state.phase).toBe('idle')
    expect(state.runId).toBeNull()
    expect(state.segments).toEqual([])
  })
})
