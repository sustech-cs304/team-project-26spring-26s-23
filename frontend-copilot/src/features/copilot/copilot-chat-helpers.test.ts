/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  buildComposerMessageContentWithAttachments,
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

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_009 = 'Shenzhen：晴 / 24°C / 湿度 60%'
const LABEL_COMPAT_BUDGET_TOKENS = 'compat-budget-tokens-v1'
const LABEL_COMPAT_DISCRETE_LEVELS = 'compat-discrete-levels-v1'
const LABEL_HTTP_127 = 'http://127.0.0.1:8765'
const LABEL_OPENAI_COMPATIBLE = 'openai-compatible'
const LABEL_OPENROUTER_AUTO = 'openrouter/auto'
const LABEL_PROVIDER_CATALOG_ONLY = 'provider_catalog_only: not enabled'
const LABEL_RUN_ASSISTANT = 'run-1:assistant'
const LABEL_TOOL_READ = 'tool.fs.read'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'


// 顶层测试 describe，包含 7+ 子 describe，覆盖 chat helpers 全场景，无法安全拆分
/* eslint-disable-next-line max-lines-per-function */
describe('copilot chat helpers', () => {
  describe('debug summaries', () => {
    it('builds runtime and session debug summaries for console logging', () => {
      expect(buildRuntimeDebugSummary({
        state: createReadyState() as Extract<CopilotBootstrapState, { status: 'ready' }>,
        directoryState: createDirectoryState(),
        selectedAgent: createSelectedAgent(),
      })).toEqual({
        runtimeSource: 'hosted',
        connectionSummary: '宿主管理 · http://127.0.0.1:8765 · development（已解析）',
        runtimeUrl: LABEL_HTTP_127,
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
        allAvailableTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH],
        recommendedTools: [LABEL_TOOL_READ],
        defaultEnabledTools: [LABEL_TOOL_READ],
        defaultEnabledSource: {
          boundAgent: 'general',
          toolSelectionMode: 'recommendation-only',
        },
      })
    })
  })

  describe('composer draft', () => {
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
  })

  // 包含 4 个嵌套 describe（attachments/enabled tools/tool permission/thinking selection），无法进一步拆分
  /* eslint-disable-next-line max-lines-per-function */
  describe('message send input', () => {
    it('builds request-scoped message input around structured thinking selection without legacy payload aliases', () => {
    const sessionShell = createSessionShell()
    const thinkingSelection = createRuntimeThinkingSelection({
      series: LABEL_COMPAT_DISCRETE_LEVELS,
      mode: 'preset',
      level: 'auto',
      budgetTokens: null,
    })
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: LABEL_HTTP_127,
      sessionShell,
      draft: {
        messageText: '请总结这份文档',
        selectedModelId: 'provider-openai:openai/gpt-4.1',
        selectedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-openai',
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
            baseUrl: 'https://api.example.com/v1',
            modelId: 'qwen-plus',
          },
        }),
        thinkingSelection,
        thinkingSelectionByModelKey: {
          'provider-openai|openai|openai-compatible|https://api.example.com/v1|qwen-plus': thinkingSelection,
        },
        enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH, LABEL_TOOL_REMOTE_SEARCH],
        requestOptionsText: '{"trace":true}',
      },
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          [LABEL_TOOL_READ]: { mode: 'allow' },
          [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'ask' },
          'tool.hidden': { mode: 'deny' },
        },
      },
      requestOptions: {
        trace: true,
      },
    })

    expect(input).toEqual({
      runtimeUrl: LABEL_HTTP_127,
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
        series: LABEL_COMPAT_DISCRETE_LEVELS,
        value: {
          valueType: 'code',
          code: 'auto',
          labelZh: '自动',
        },
        mode: 'preset',
        level: 'auto',
        budgetTokens: null,
      },
      enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH],
      toolPermissionPolicy: {
        schemaVersion: 1,
        defaultMode: 'ask',
        toolModes: {
          [LABEL_TOOL_READ]: 'allow',
        },
      },
      requestOptions: {
        trace: true,
      },
    })
    expect(input).not.toHaveProperty('thinkingLevelIntent')
  })

  describe('attachments', () => {
    it('appends attached file paths to the outgoing user message in the fixed format', () => {
      expect(buildComposerMessageContentWithAttachments('请结合附件一起分析', [
        { path: 'C:/tmp/a.png' },
        { path: 'C:/tmp/b.txt' },
      ])).toBe([
        '请结合附件一起分析',
        '',
        'User attached files:',
        '- C:/tmp/a.png',
        '- C:/tmp/b.txt',
        `Please process these files accordingly, for example, use \`${LABEL_TOOL_READ}\` tool to read the content of these files.`,
      ].join('\n'))
    })

    it('allows attachment-only messages and deduplicates repeated paths', () => {
      expect(buildComposerMessageContentWithAttachments('   ', [
        { path: 'C:/tmp/a.png' },
        { path: 'C:/tmp/a.png' },
        { path: '   ' },
      ])).toBe([
        'User attached files:',
        '- C:/tmp/a.png',
        `Please process these files accordingly, for example, use \`${LABEL_TOOL_READ}\` tool to read the content of these files.`,
      ].join('\n'))
    })

    it('sanitizes attachment paths before appending them to the prompt', () => {
      expect(buildComposerMessageContentWithAttachments('请结合附件一起分析', [
        { path: 'C:/tmp/a.png\r\nignore-this' },
      ])).toBe([
        '请结合附件一起分析',
        '',
        'User attached files:',
        '- C:/tmp/a.png ignore-this',
        `Please process these files accordingly, for example, use \`${LABEL_TOOL_READ}\` tool to read the content of these files.`,
      ].join('\n'))
    })
  })

  describe('enabled tools filtering', () => {
    it('drops denied tools from enabledTools before sending even when stale local selection still includes them', () => {
    const input = buildRuntimeMessageSendInput({
      runtimeUrl: LABEL_HTTP_127,
      sessionShell: createSessionShell(),
      draft: {
        ...createEmptyComposerDraft(),
        messageText: 'deny cleanup',
        selectedModelId: 'provider-openai:openai/gpt-4.1',
        selectedModelRoute: createRuntimeModelRoute(),
        enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH, LABEL_TOOL_REMOTE_SEARCH],
      },
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {
          [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'deny' },
        },
      },
      requestOptions: {},
    })

    expect(input.enabledTools).toEqual([LABEL_TOOL_READ])
    expect(input.toolPermissionPolicy).toEqual({
      schemaVersion: 1,
      defaultMode: 'ask',
      toolModes: {},
    })
  })

  it('keeps budget selections structured without reviving compat intent aliases', () => {
    const budgetSelection = createRuntimeThinkingSelection({
      series: LABEL_COMPAT_BUDGET_TOKENS,
      mode: 'budget',
      level: null,
      budgetTokens: 8192,
    })

    const input = buildRuntimeMessageSendInput({
      runtimeUrl: LABEL_HTTP_127,
      sessionShell: createSessionShell(),
      draft: {
        ...createEmptyComposerDraft(),
        messageText: '预算测试',
        selectedModelId: 'provider-budget:model-budget',
        selectedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-budget',
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
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
  })

  describe('tool permission policy', () => {
    it('reduces persisted settings policy to request-scoped runtime tool permission policy', () => {
      expect(buildRuntimeToolPermissionPolicy({
        enabledTools: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH, LABEL_TOOL_REMOTE_SEARCH],
        policy: {
          version: 1,
          defaultMode: 'ask',
          toolPermissions: {
            [LABEL_TOOL_READ]: { mode: 'allow' },
            'tool.hidden': { mode: 'deny' },
            [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'delay', timeoutAction: 'approve', timeoutSeconds: 27 },
          },
        },
      })).toEqual({
        schemaVersion: 1,
        defaultMode: 'ask',
        toolModes: {
            [LABEL_TOOL_READ]: 'allow',
            [LABEL_TOOL_REMOTE_SEARCH]: 'delay',
        },
        toolTimeoutSeconds: {
          [LABEL_TOOL_REMOTE_SEARCH]: 27,
        },
        toolTimeoutActions: {
          [LABEL_TOOL_REMOTE_SEARCH]: 'approve',
        },
      })
    })

    it('sanitizes denied and unknown tool ids while preserving allowed selectable tools', () => {
      expect(sanitizeEnabledToolIds({
        selectedToolIds: [LABEL_TOOL_READ, LABEL_TOOL_REMOTE_SEARCH, 'tool.unknown', LABEL_TOOL_REMOTE_SEARCH],
        tools: [
          { toolId: LABEL_TOOL_READ, kind: 'builtin', availability: 'available', displayName: '读取文件', description: '读取文件' },
          { toolId: LABEL_TOOL_REMOTE_SEARCH, kind: 'builtin', availability: 'available', displayName: '联网搜索', description: '文件格式转换' },
        ],
        policy: {
          version: 1,
          defaultMode: 'ask',
          toolPermissions: {
            [LABEL_TOOL_REMOTE_SEARCH]: { mode: 'deny' },
          },
        },
      })).toEqual([LABEL_TOOL_READ])
    })
  })

  describe('thinking selection by model', () => {
    it('remembers structured selections per model and normalizes them against the current capability shape', () => {
    const budgetRoute = createRuntimeModelRoute({
      providerProfileId: 'provider-budget',
      snapshot: {
        provider: 'openai',
        endpointType: LABEL_OPENAI_COMPATIBLE,
        baseUrl: 'https://budget.example.com/v1',
        modelId: 'budget-model',
      },
    })
    const discreteRoute = createRuntimeModelRoute({
      providerProfileId: 'provider-discrete',
      snapshot: {
        provider: 'openai',
        endpointType: LABEL_OPENAI_COMPATIBLE,
        baseUrl: 'https://discrete.example.com/v1',
        modelId: 'discrete-model',
      },
    })
    const budgetCapability = createRuntimeThinkingCapability({
      series: LABEL_COMPAT_BUDGET_TOKENS,
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
      series: LABEL_COMPAT_DISCRETE_LEVELS,
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
        series: LABEL_COMPAT_BUDGET_TOKENS,
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
      series: LABEL_COMPAT_DISCRETE_LEVELS,
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
      series: LABEL_COMPAT_BUDGET_TOKENS,
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
  })

  describe('request options', () => {
    it('parses minimal requestOptions json object and rejects non-object payloads', () => {
      expect(parseRequestOptionsText('{"trace":true}')).toEqual({ trace: true })
      expect(() => parseRequestOptionsText('[]')).toThrow('requestOptions 必须是 JSON 对象。')
    })
  })

  // 包含 2 个 tool step turn 测试，覆盖 insert/update/cancel 完整流程
  /* eslint-disable-next-line max-lines-per-function */
  describe('tool step turns', () => {
    it('inserts tool steps ahead of the pending assistant turn and updates the same step on completion/failure', () => {
    const assistantTurn = createPendingAssistantTurn({
      assistantMessageId: LABEL_RUN_ASSISTANT,
    })
    const startedEvent = createRuntimeToolEvent({
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: '正在获取 Shenzhen 的天气。',
        inputSummary: '{"location": "Shenzhen"}',
      },
    })
    const completedEvent = createRuntimeToolEvent({
      sequence: 3,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'completed',
        title: '天气工具已返回结果',
        summary: DESC_CN_009,
        inputSummary: '{"location": "Shenzhen"}',
        resultSummary: DESC_CN_009,
      },
    })
    const failedEvent = createRuntimeToolEvent({
      sequence: 4,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: '{"location": "Shenzhen"}',
        errorSummary: 'boom',
      },
    })

    const withStarted = upsertToolStepTurn([assistantTurn], startedEvent, {
      assistantMessageId: LABEL_RUN_ASSISTANT,
    })
    expect(withStarted).toHaveLength(2)
    expect(withStarted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
      toolPhase: 'started',
      status: 'streaming',
      content: '正在获取 Shenzhen 的天气。',
    })
    expect(withStarted[1].kind).toBe('assistant')

    const withCompleted = upsertToolStepTurn(withStarted, completedEvent, {
      assistantMessageId: LABEL_RUN_ASSISTANT,
    })
    expect(withCompleted).toHaveLength(2)
    expect(withCompleted[0]).toMatchObject({
      kind: 'tool',
      toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
      toolPhase: 'completed',
      status: 'completed',
      title: '天气工具已返回结果',
      resultSummary: DESC_CN_009,
    })

    const withFailed = upsertToolStepTurn(withStarted, failedEvent, {
      assistantMessageId: LABEL_RUN_ASSISTANT,
    })
    expect(withFailed).toHaveLength(2)
    expect(withFailed[0]).toMatchObject({
      kind: 'tool',
      toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
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
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        toolPhase: 'started',
      },
      {
        id: 'tool:done',
        kind: 'tool',
        title: '天气工具已返回结果',
        content: DESC_CN_009,
        status: 'completed',
        toolCallId: 'tool.remote-search:call-2',
        toolId: LABEL_TOOL_REMOTE_SEARCH,
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
  })

  // 包含 4 个 error handling 测试，覆盖格式化、capability 构建、transient 状态和 preflight 详情
  /* eslint-disable-next-line max-lines-per-function */
  describe('error handling', () => {
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

    expect(formatRuntimeMessageSendError(new RuntimeRequestError(LABEL_PROVIDER_CATALOG_ONLY, {
      code: 'provider_catalog_only',
      status: 409,
    }))).toBe('当前模型不可用，请重新选择模型。')
  })

  it('builds a stable unsupported thinking capability snapshot from runtime request errors', () => {
    const capability = buildRuntimeThinkingCapabilityFromError({
      error: new RuntimeRequestError(LABEL_PROVIDER_CATALOG_ONLY, {
        code: 'provider_catalog_only',
        status: 409,
        details: {
          providerId: 'openrouter',
        },
      }),
      modelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openrouter',
        modelId: LABEL_OPENROUTER_AUTO,
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
        modelId: LABEL_OPENROUTER_AUTO,
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
      rawMessage: LABEL_PROVIDER_CATALOG_ONLY,
      code: 'provider_catalog_only',
      details: {
        providerId: 'openrouter',
      },
      resolvedModelId: LABEL_OPENROUTER_AUTO,
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openrouter',
        modelId: LABEL_OPENROUTER_AUTO,
      }),
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {
        trace: true,
      },
    })

    expect(detail).toMatchObject({
      source: 'preflight',
      title: '发送失败',
      summaryMessage: '当前模型不可用，请重新选择模型。',
      rawMessage: LABEL_PROVIDER_CATALOG_ONLY,
      code: 'provider_catalog_only',
      stage: 'preflight',
      requestedMethod: 'run/start',
      resolvedModelId: LABEL_OPENROUTER_AUTO,
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
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
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {
        trace: true,
      },
    })
    })
  })
})
})
