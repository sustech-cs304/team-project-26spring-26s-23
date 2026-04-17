/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  buildRuntimeDebugSummary,
  buildRuntimeMessageSendInput,
  buildRuntimeThinkingCapabilityFromError,
  buildSessionDebugSummary,
  cancelStreamingToolTurns,
  createComposerDraftFromSession,
  createCopilotTransientErrorState,
  createEmptyComposerDraft,
  createPendingAssistantTurn,
  createPreflightErrorDetail,
  createRuntimeRequestErrorDetail,
  describeThinkingCapabilityUnavailableReason,
  formatRuntimeMessageSendError,
  parseRequestOptionsText,
  syncComposerDraftThinkingSelection,
  upsertToolStepTurn,
  buildRuntimeToolPermissionPolicy,
} from './copilot-chat-helpers'
import { sanitizeEnabledToolIds } from './tool-picker'
import { RuntimeRequestError } from './thread-run-contract'
import {
  createRuntimeCanonicalThinkingSelection,
  createRuntimeModelRoute,
  createRuntimeThinkingCapability,
  createRuntimeThinkingControlSpec,
  createRuntimeThinkingSelection,
  createRuntimeToolEvent,
} from './thread-run-contract.test-support'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
} from './CopilotChatPanel.test-support'
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
        toolSelectionMode: 'recommendation-only',
      },
    })
  })

  it('creates composer defaults from empty state and keeps model selection empty until route-based restoration happens elsewhere', () => {
    expect(createEmptyComposerDraft()).toEqual({
      messageText: '',
      selectedModelId: '',
      selectedModelRoute: null,
      thinkingSelection: null,
      thinkingSelectionByModelKey: {},
      enabledTools: [],
      requestOptionsText: '{}',
    })

    const draft = createComposerDraftFromSession(createSessionShell())

    expect(draft).toEqual({
      messageText: '',
      selectedModelId: '',
      selectedModelRoute: null,
      thinkingSelection: null,
      thinkingSelectionByModelKey: {},
      enabledTools: [],
      requestOptionsText: '{}',
    })
  })

  it('builds request-scoped message input around structured thinking selection without legacy payload aliases', () => {
    const sessionShell = createSessionShell()
    const thinkingSelection = createRuntimeThinkingSelection({
      series: 'compat-discrete-levels-v1',
      mode: 'preset',
      level: 'auto',
      budgetTokens: null,
    })
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionShell,
      draft: {
        messageText: '请总结这份文档',
        selectedModelId: 'provider-openai:openai/gpt-4.1',
        selectedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-openai',
          snapshot: {
            provider: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'qwen-plus',
          },
        }),
        thinkingSelection,
        thinkingSelectionByModelKey: {
          'provider-openai|openai|openai-compatible|https://api.example.com/v1|qwen-plus': thinkingSelection,
        },
        enabledTools: ['tool.remote-search', 'tool.file-convert', 'tool.remote-search'],
        requestOptionsText: '{"trace":true}',
      },
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          'tool.remote-search': { mode: 'allow' },
          'tool.file-convert': { mode: 'ask' },
          'tool.hidden': { mode: 'deny' },
        },
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
      modelRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'provider-openai',
          modelId: 'qwen-plus',
        },
        catalogRevision: '2026-04-06-provider-catalog-v1',
      },
      thinkingSelection: {
        series: 'compat-discrete-levels-v1',
        value: {
          valueType: 'code',
          code: 'auto',
          labelZh: '自动',
        },
        mode: 'preset',
        level: 'auto',
        budgetTokens: null,
      },
      enabledTools: ['tool.remote-search', 'tool.file-convert'],
      toolPermissionPolicy: {
        schemaVersion: 1,
        defaultMode: 'ask',
        toolModes: {
          'tool.remote-search': 'allow',
        },
      },
      requestOptions: {
        trace: true,
      },
    })
    expect(input).not.toHaveProperty('thinkingLevelIntent')
  })

  it('drops denied tools from enabledTools before sending even when stale local selection still includes them', () => {
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionShell: createSessionShell(),
      draft: {
        ...createEmptyComposerDraft(),
        messageText: 'deny cleanup',
        selectedModelId: 'provider-openai:openai/gpt-4.1',
        selectedModelRoute: createRuntimeModelRoute(),
        enabledTools: ['tool.remote-search', 'tool.file-convert', 'tool.remote-search'],
      },
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          'tool.remote-search': { mode: 'deny' },
        },
      },
      requestOptions: {},
    })

    expect(input.enabledTools).toEqual(['tool.file-convert'])
    expect(input.toolPermissionPolicy).toEqual({
      schemaVersion: 1,
      defaultMode: 'ask',
      toolModes: {},
    })
  })

  it('keeps budget selections structured without reviving compat intent aliases', () => {
    const budgetSelection = createRuntimeThinkingSelection({
      series: 'compat-budget-tokens-v1',
      mode: 'budget',
      level: null,
      budgetTokens: 8192,
    })

    const input = buildRuntimeMessageSendInput({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionShell: createSessionShell(),
      draft: {
        ...createEmptyComposerDraft(),
        messageText: '预算测试',
        selectedModelId: 'provider-budget:model-budget',
        selectedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-budget',
          snapshot: {
            provider: 'openai',
            endpointType: 'openai-compatible',
            baseUrl: 'https://budget.example.com/v1',
            modelId: 'model-budget',
          },
        }),
        thinkingSelection: budgetSelection,
        thinkingSelectionByModelKey: {
          'provider-budget|openai|openai-compatible|https://budget.example.com/v1|model-budget': budgetSelection,
        },
      },
      requestOptions: {},
    })

    expect(input.thinkingSelection).toEqual(budgetSelection)
    expect(input).not.toHaveProperty('thinkingLevelIntent')
  })

  it('reduces persisted settings policy to request-scoped runtime tool permission policy', () => {
    expect(buildRuntimeToolPermissionPolicy({
      enabledTools: ['tool.remote-search', 'tool.file-convert', 'tool.remote-search'],
      policy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          'tool.remote-search': { mode: 'allow' },
          'tool.hidden': { mode: 'deny' },
          'tool.file-convert': { mode: 'ask' },
        },
      },
    })).toEqual({
      schemaVersion: 1,
      defaultMode: 'ask',
      toolModes: {
        'tool.remote-search': 'allow',
      },
    })
  })

  it('sanitizes denied and unknown tool ids while preserving allowed selectable tools', () => {
    expect(sanitizeEnabledToolIds({
      selectedToolIds: ['tool.remote-search', 'tool.file-convert', 'tool.unknown', 'tool.file-convert'],
      tools: [
        { toolId: 'tool.remote-search', kind: 'builtin', availability: 'available', displayName: '远程搜索', description: '联网搜索' },
        { toolId: 'tool.file-convert', kind: 'builtin', availability: 'available', displayName: '文件转换', description: '文件格式转换' },
      ],
      policy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          'tool.remote-search': { mode: 'deny' },
        },
      },
    })).toEqual(['tool.file-convert'])
  })

  it('remembers structured selections per model and normalizes them against the current capability shape', () => {
    const budgetRoute = createRuntimeModelRoute({
      providerProfileId: 'provider-budget',
      snapshot: {
        provider: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://budget.example.com/v1',
        modelId: 'budget-model',
      },
    })
    const discreteRoute = createRuntimeModelRoute({
      providerProfileId: 'provider-discrete',
      snapshot: {
        provider: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://discrete.example.com/v1',
        modelId: 'discrete-model',
      },
    })
    const budgetCapability = createRuntimeThinkingCapability({
      series: 'compat-budget-tokens-v1',
      controlSpec: createRuntimeThinkingControlSpec({
        kind: 'budget',
        selectionKind: 'budget',
        presetOptions: [createRuntimeCanonicalThinkingSelection({ value: 'off' })],
        budget: {
          minTokens: 0,
          maxTokens: 32768,
          stepTokens: 1024,
        },
      }),
      defaultSelection: createRuntimeCanonicalThinkingSelection({ kind: 'budget', budgetTokens: 4096 }),
      supportedLevels: ['off'],
      defaultLevel: null,
    })
    const discreteCapability = createRuntimeThinkingCapability({
      series: 'compat-discrete-levels-v1',
      controlSpec: createRuntimeThinkingControlSpec({
        kind: 'discrete',
        selectionKind: 'preset',
        presetOptions: [
          createRuntimeCanonicalThinkingSelection({ value: 'off' }),
          createRuntimeCanonicalThinkingSelection({ value: 'auto' }),
          createRuntimeCanonicalThinkingSelection({ value: 'medium' }),
        ],
      }),
      defaultSelection: createRuntimeCanonicalThinkingSelection({ value: 'auto' }),
      supportedLevels: ['off', 'auto', 'medium'],
      defaultLevel: 'auto',
    })

    let draft = applyModelSelectionToComposerDraft(createEmptyComposerDraft(), {
      modelId: 'budget-model',
      modelRoute: budgetRoute,
    })
    draft = syncComposerDraftThinkingSelection(draft, {
      modelRoute: budgetRoute,
      thinkingCapability: budgetCapability,
    })
    draft = applyThinkingSelectionToComposerDraft(draft, {
      modelRoute: budgetRoute,
      thinkingSelection: createRuntimeThinkingSelection({
        series: 'compat-budget-tokens-v1',
        mode: 'budget',
        level: null,
        budgetTokens: 12288,
      }),
    })

    draft = applyModelSelectionToComposerDraft(draft, {
      modelId: 'discrete-model',
      modelRoute: discreteRoute,
    })
    expect(draft.thinkingSelection).toBeNull()

    draft = syncComposerDraftThinkingSelection(draft, {
      modelRoute: discreteRoute,
      thinkingCapability: discreteCapability,
    })
    expect(draft.thinkingSelection).toEqual({
      series: 'compat-discrete-levels-v1',
      value: {
        valueType: 'code',
        code: 'auto',
        labelZh: '自动',
      },
      mode: 'preset',
      level: 'auto',
      budgetTokens: null,
    })

    draft = applyModelSelectionToComposerDraft(draft, {
      modelId: 'budget-model',
      modelRoute: budgetRoute,
    })
    expect(draft.thinkingSelection).toEqual({
      series: 'compat-budget-tokens-v1',
      value: {
        valueType: 'budget',
        mode: 'budget',
        budgetTokens: 12288,
        labelZh: '12288',
      },
      mode: 'budget',
      level: null,
      budgetTokens: 12288,
    })
  })

  it('parses minimal requestOptions json object and rejects non-object payloads', () => {
    expect(parseRequestOptionsText('{"trace":true}')).toEqual({ trace: true })
    expect(() => parseRequestOptionsText('[]')).toThrow('requestOptions 必须是 JSON 对象。')
  })

  it('inserts tool steps ahead of the pending assistant turn and updates the same step on completion/failure', () => {
    const assistantTurn = createPendingAssistantTurn({
      assistantMessageId: 'run-1:assistant',
    })
    const startedEvent = createRuntimeToolEvent({
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location": "Shenzhen"}',
      },
    })
    const completedEvent = createRuntimeToolEvent({
      sequence: 3,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'completed',
        title: '天气工具已返回结果',
        summary: 'Shenzhen：晴 / 24°C / 湿度 60%',
        inputSummary: '{"location": "Shenzhen"}',
        resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
      },
    })
    const failedEvent = createRuntimeToolEvent({
      sequence: 4,
      payload: {
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: '{"location": "Shenzhen"}',
        errorSummary: 'boom',
      },
    })

    const withStarted = upsertToolStepTurn([assistantTurn], startedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withStarted).toHaveLength(2)
    expect(withStarted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'started',
      status: 'streaming',
      content: '正在获取 Shenzhen 的天气。',
    })
    expect(withStarted[1].kind).toBe('assistant')

    const withCompleted = upsertToolStepTurn(withStarted, completedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withCompleted).toHaveLength(2)
    expect(withCompleted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'completed',
      status: 'completed',
      title: '天气工具已返回结果',
      resultSummary: 'Shenzhen：晴 / 24°C / 湿度 60%',
    })

    const withFailed = upsertToolStepTurn(withStarted, failedEvent, {
      assistantMessageId: 'run-1:assistant',
    })
    expect(withFailed).toHaveLength(2)
    expect(withFailed[0]).toMatchObject({
      kind: 'tool',
      toolCallId: 'tool.weather-current:call-1',
      toolPhase: 'failed',
      status: 'failed',
      title: '工具调用失败',
      errorSummary: 'boom',
    })
  })

  it('cancels only in-flight tool steps while keeping other turns unchanged', () => {
    const cancelled = cancelStreamingToolTurns([
      {
        id: 'tool:pending',
        kind: 'tool',
        title: '调用天气工具',
        content: '正在获取 Shenzhen 的天气。',
        status: 'streaming',
        toolCallId: 'tool.weather-current:call-1',
        toolId: 'tool.weather-current',
        toolPhase: 'started',
      },
      {
        id: 'tool:done',
        kind: 'tool',
        title: '天气工具已返回结果',
        content: 'Shenzhen：晴 / 24°C / 湿度 60%',
        status: 'completed',
        toolCallId: 'tool.weather-current:call-2',
        toolId: 'tool.weather-current',
        toolPhase: 'completed',
      },
      {
        id: 'assistant:1',
        kind: 'assistant',
        title: '助手响应',
        content: '第一段',
        status: 'streaming',
      },
    ])

    expect(cancelled[0]).toMatchObject({
      kind: 'tool',
      status: 'cancelled',
      toolPhase: 'cancelled',
    })
    expect(cancelled[1]).toMatchObject({
      kind: 'tool',
      status: 'completed',
      toolPhase: 'completed',
    })
    expect(cancelled[2]).toMatchObject({
      kind: 'assistant',
      status: 'streaming',
    })
  })

  it('formats structured backend errors into explicit user-facing messages', () => {
    expect(formatRuntimeMessageSendError(new RuntimeRequestError('agent_mismatch: session bound agent differs', {
      code: 'agent_mismatch',
      status: 409,
    }))).toBe('当前会话已更新，请重新发送。')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('tool_not_found: unknown tool', {
      code: 'tool_not_found',
      status: 400,
    }))).toBe('当前所选工具暂不可用，请调整后重试。')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('invalid_request: bad payload', {
      code: 'invalid_request',
      status: 400,
    }))).toBe('当前消息暂时无法发送，请调整内容后重试。')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('thinking_not_supported_for_route: unsupported thinking selection', {
      code: 'thinking_not_supported_for_route',
      status: 400,
    }))).toBe('当前模型暂不支持所选思考设置，请调整后重试。')

    expect(formatRuntimeMessageSendError(new RuntimeRequestError('provider_catalog_only: not enabled', {
      code: 'provider_catalog_only',
      status: 409,
    }))).toBe('当前模型不可用，请重新选择模型。')
  })

  it('builds a stable unsupported thinking capability snapshot from runtime request errors', () => {
    const capability = buildRuntimeThinkingCapabilityFromError({
      error: new RuntimeRequestError('provider_catalog_only: not enabled', {
        code: 'provider_catalog_only',
        status: 409,
        details: {
          providerId: 'openrouter',
        },
      }),
      modelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openrouter',
        modelId: 'openrouter/auto',
      }),
    })

    expect(capability).toEqual({
      status: 'verified-unsupported',
      source: 'verified',
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
      reasonCode: 'provider_catalog_only',
      providerHint: 'openrouter',
      provenance: null,
      visibility: null,
      routeFingerprint: {
        providerProfileId: 'provider-openrouter',
        provider: 'openrouter',
        endpointType: '',
        baseUrl: '',
        modelId: 'openrouter/auto',
      },
      overrideLevels: [],
    })
    expect(describeThinkingCapabilityUnavailableReason(capability)).toBe('当前无法调整思考设置')
  })

  it('creates a minimal transient error state with normalized fallback text', () => {
    expect(createCopilotTransientErrorState({
      message: '   ',
    })).toEqual({
      message: '当前响应失败，请重试。',
      errorDetail: null,
    })
  })

  it('builds preflight error details with request and model context preserved', () => {
    const detail = createPreflightErrorDetail({
      summaryMessage: '当前模型不可用，请重新选择模型。',
      rawMessage: 'provider_catalog_only: not enabled',
      code: 'provider_catalog_only',
      details: {
        providerId: 'openrouter',
      },
      resolvedModelId: 'openrouter/auto',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openrouter',
        modelId: 'openrouter/auto',
      }),
      resolvedToolIds: ['tool.remote-search'],
      requestOptions: {
        trace: true,
      },
    })

    expect(detail).toMatchObject({
      source: 'preflight',
      title: '发送失败',
      summaryMessage: '当前模型不可用，请重新选择模型。',
      rawMessage: 'provider_catalog_only: not enabled',
      code: 'provider_catalog_only',
      stage: 'preflight',
      requestedMethod: 'run/start',
      resolvedModelId: 'openrouter/auto',
      resolvedToolIds: ['tool.remote-search'],
      requestOptions: {
        trace: true,
      },
    })
  })

  it('builds run-start request error details without losing raw diagnostics', () => {
    const detail = createRuntimeRequestErrorDetail({
      error: new RuntimeRequestError('tool_not_found: unknown tool', {
        code: 'tool_not_found',
        status: 400,
        details: {
          supportedMethods: ['run/start'],
        },
      }),
      stage: 'run-start',
      requestedMethod: 'run/start',
      resolvedModelId: 'openai/gpt-4.1',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: 'openai/gpt-4.1',
      }),
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: {
        trace: true,
      },
    })

    expect(detail).toMatchObject({
      source: 'run-start',
      summaryMessage: '当前所选工具暂不可用，请调整后重试。',
      rawMessage: 'tool_not_found: unknown tool',
      code: 'tool_not_found',
      stage: 'run-start',
      requestedMethod: 'run/start',
      status: 400,
      details: {
        supportedMethods: ['run/start'],
      },
      resolvedModelId: 'openai/gpt-4.1',
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: {
        trace: true,
      },
    })
  })
})
