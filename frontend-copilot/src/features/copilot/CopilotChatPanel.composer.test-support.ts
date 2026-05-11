import { act } from 'react'
import { vi } from 'vitest'

import type { CopilotMessageDispatchInput } from './copilot-send-controller'
import {
  createRuntimeMessageEventStream,
  createRuntimeResolvedModelRoute,
  createRuntimeToolEvent,
} from './chat-contract.test-support'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createPersistedWorkspaceState } from '../../workbench/settings/settings-workspace-test-fixtures'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
export const DESC_CN_019 = '请调用天气工具并处理 fatal 失败'
export const DESC_CN_022 = '正在获取 Shenzhen 的天气。'
export const DESC_CN_028 = '我可以解释工具失败并继续'
export const DESC_CN_038 = '当前模型暂不可用于聊天。'
export const DESC_CN_045 = 'Shenzhen：晴 / 24°C / 湿度 60%'
export const DESC_CN_048 = '当前响应失败，请重试。'
export const LABEL_2026 = '2026-04-06-provider-catalog-v1'
export const LABEL_2026_13T15 = '2026-04-13T15:05:00Z'
export const LABEL_2026_13T15_2 = '2026-04-13T15:00:00Z'
export const LABEL_2026_14T08 = '2026-04-14T08:00:03Z'
export const LABEL_2026_14T08_2 = '2026-04-14T08:00:00Z'
export const LABEL_2026_14T08_3 = '2026-04-14T08:00:01Z'
export const LABEL_CLAUDE = 'claude-3.7-sonnet'
export const LABEL_COURSE_FORM = 'course-form'
export const LABEL_ERROR_DETAIL_OVERLAY = 'error-detail-overlay'
export const LABEL_HTTPS_API_EXAMPLE = 'https://api.example.com/v1'
export const LABEL_HTTP_127 = 'http://127.0.0.1:8765'
export const LABEL_LEGACY_MODEL = 'legacy-model'
export const LABEL_LOCATION_SHENZHEN = '{"location":"Shenzhen"}'
export const LABEL_OPENAI_COMPATIBLE = 'OpenAI Compatible'
export const LABEL_OPENAI_COMPATIBLE_2 = 'openai-compatible'
export const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
export const LABEL_PROVIDER_BETA = 'provider-beta'
export const LABEL_PROVIDER_MODEL = 'provider-model'
export const LABEL_PROVIDER_OPENAI = 'provider-openai'
export const LABEL_PROVIDER_OPENAI_OPENAI = 'provider-openai:openai/gpt-4.1'
export const LABEL_RUN_CANCEL = 'run-cancel'
export const LABEL_RUN_HISTORY = 'run-history-1'
export const LABEL_RUN_INLINE_FORM = 'run-inline-form-switch'
export const LABEL_RUN_INTERRUPTED_UNTIL = 'Run interrupted until the user submits the requested form.'
export const LABEL_RUN_TOOL_FAILED = 'run-tool-failed'
export const LABEL_RUN_TOOL_SUCCESS = 'run-tool-success'
export const LABEL_RUN_TOOL_THEN = 'run-tool-then-failed'
export const LABEL_SHARED_MODEL = 'shared-model'
export const LABEL_TEXTAREA_NAME_MESSAGETEXT = 'textarea[name="messageText"]'
export const LABEL_TOOL_READ = 'tool.fs.read'
export const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
export const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'
export const LABEL_TOOL_REQUEST_USER = 'tool.request-user-form:call-1'
export const LABEL_TOOL_REQUEST_USER_2 = 'tool.request-user-form'
export const LABEL_UNKNOWN_MODEL = 'unknown-model'
export const LABEL_UNKNOWN_PROFILE = 'unknown-profile'
export const SELECTOR_ARIA_EXPANDED = 'aria-expanded'
export const SELECTOR_ARIA_PRESSED = 'aria-pressed'
export const SELECTOR_CHAT_ASSISTANT_PLACEHOLDER = 'chat-assistant-placeholder'
export const SELECTOR_CHAT_COMPOSER_DOCK = 'chat-composer-dock'
export const SELECTOR_CHAT_COMPOSER_SEND = 'chat-composer-send-button'
export const SELECTOR_CHAT_HISTORY_DRIFT = 'chat-history-drift-notice'
export const SELECTOR_CHAT_MESSAGE_INLINE = 'chat-message-inline-form-submit-1'
export const SELECTOR_CHAT_MESSAGE_SCROLL = 'chat-message-scroll-region'
export const SELECTOR_CHAT_MESSAGE_TOOL = 'chat-message-tool-panel-1'
export const SELECTOR_CHAT_MESSAGE_TOOL_2 = 'chat-message-tool-toggle-1'
export const SELECTOR_CHAT_MESSAGE_TOOL_3 = 'chat-message-tool-input-toggle-1'
export const SELECTOR_CHAT_MODEL_PICKER = 'chat-model-picker-trigger'
export const SELECTOR_CHAT_TOOL_OPTION = 'chat-tool-option-tool.remote-search'
export const SELECTOR_COPILOT_CHAT_PANEL = 'copilot-chat-panel'

export function restoreNotificationApi() {
  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async () => undefined),
    } as Window['desktopNotification'],
  })
}

export function restoreAttachmentManagerApi() {
  Object.defineProperty(window, 'attachmentManager', {
    configurable: true,
    writable: true,
    value: {
      resolveFilePath: vi.fn(() => null),
      readClipboardData: vi.fn(async () => ({ ok: true, status: 'empty', availableFormats: [] })),
      writeTempFile: vi.fn(async () => ({
        ok: true,
        file: {
          path: 'temp-image.png',
          name: 'temp-image.png',
          mimeType: 'image/png',
          size: 0,
          createdAt: '2026-05-09T00:00:00.000Z',
          isTemporary: true,
        },
      })),
      readPreview: vi.fn(async () => ({
        ok: true,
        kind: 'unsupported',
        path: 'unknown.bin',
        name: 'unknown.bin',
        size: 0,
        reason: 'unsupported_type',
      })),
      cleanupTempFiles: vi.fn(async () => ({
        ok: true,
        deletedPaths: [],
        missingPaths: [],
        skippedPaths: [],
      })),
    } as Window['attachmentManager'],
  })
}

export function createResolvedSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'text_delta',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '这是助手回显',
        },
      },
      {
        type: 'run_completed',
        runId: 'run-1',
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          assistantMessageId: 'run-1:assistant',
          assistantText: '这是助手回显',
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
          }),
          resolvedToolIds: input.enabledTools,
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

export interface DeferredSignal {
  wait: () => Promise<void>
  release: () => void
}

export function createDeferredSignal(): DeferredSignal {
  let releaseResolver: (() => void) | null = null
  const wait = new Promise<void>((resolve) => {
    releaseResolver = resolve
  })

  return {
    wait: () => wait,
    release: () => {
      releaseResolver?.()
    },
  }
}

export function createDeferredResolvedSendMessageSpy(
  control: DeferredSignal,
  overrides: {
    runId?: string
    assistantText?: string
  } = {},
) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }
    const runId = overrides.runId ?? 'run-1'
    const assistantText = overrides.assistantText ?? '这是助手回显'

    yield {
      type: 'run_started',
      runId,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: `${runId}:assistant`,
      },
    }

    await control.wait()
    yield {
      type: 'text_delta',
      runId,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        assistantMessageId: `${runId}:assistant`,
        delta: assistantText,
      },
    }
    yield {
      type: 'run_completed',
      runId,
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        assistantMessageId: `${runId}:assistant`,
        assistantText,
        resolvedModelId: routeRef.modelId,
        resolvedModelRoute: createRuntimeResolvedModelRoute({
          routeRef,
          providerProfileId: routeRef.profileId,
          provider: 'openai',
          providerId: 'openai',
          adapterId: 'openai',
          endpointFamily: 'openai',
          endpointType: LABEL_OPENAI_COMPATIBLE_2,
          baseUrl: LABEL_HTTPS_API_EXAMPLE,
          modelId: routeRef.modelId,
          catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
        }),
        resolvedToolIds: input.enabledTools,
        requestOptions: input.requestOptions ?? {},
      },
    }
  })
}

export function createToolLifecycleSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'started',
          title: '调用天气工具',
          summary: DESC_CN_022,
          inputSummary: LABEL_LOCATION_SHENZHEN,
        },
      }),
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'completed',
          title: '天气工具已返回结果',
          summary: '{\n  "condition": "晴",\n  "humidity": 60,\n  "location": "Shenzhen",\n  "summary": "体感舒适，适合外出。",\n  "temperatureC": 24\n}',
          inputSummary: LABEL_LOCATION_SHENZHEN,
          resultSummary: DESC_CN_045,
        },
      }),
      {
        type: 'text_delta',
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
          delta: '这是助手回显',
        },
      },
      {
        type: 'run_completed',
        runId: LABEL_RUN_TOOL_SUCCESS,
        sessionId: input.sessionId,
        sequence: 5,
        payload: {
          assistantMessageId: 'run-tool-success:assistant',
          assistantText: '这是助手回显',
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
          }),
          resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

export function createToolFailureSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => {
    const routeRef = input.modelRoute.routeRef ?? {
      routeKind: LABEL_PROVIDER_MODEL as const,
      profileId: LABEL_UNKNOWN_PROFILE,
      modelId: LABEL_UNKNOWN_MODEL,
    }

    return createRuntimeMessageEventStream([
      {
        type: 'run_started',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
        },
      },
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 2,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'started',
          title: '调用天气工具',
          summary: DESC_CN_022,
          inputSummary: LABEL_LOCATION_SHENZHEN,
        },
      }),
      createRuntimeToolEvent({
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 3,
        payload: {
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'failed',
          title: '工具调用失败',
          summary: '工具执行失败。',
          inputSummary: LABEL_LOCATION_SHENZHEN,
          errorSummary: 'boom',
        },
      }),
      {
        type: 'text_delta',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 4,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          delta: DESC_CN_028,
        },
      },
      {
        type: 'run_completed',
        runId: LABEL_RUN_TOOL_FAILED,
        sessionId: input.sessionId,
        sequence: 5,
        payload: {
          assistantMessageId: 'run-tool-failed:assistant',
          assistantText: DESC_CN_028,
          resolvedModelId: routeRef.modelId,
          resolvedModelRoute: createRuntimeResolvedModelRoute({
            routeRef,
            providerProfileId: routeRef.profileId,
            provider: 'openai',
            providerId: 'openai',
            adapterId: 'openai',
            endpointFamily: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE_2,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: routeRef.modelId,
            catalogRevision: input.modelRoute.catalogRevision ?? LABEL_2026,
          }),
          resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
          requestOptions: input.requestOptions ?? {},
        },
      },
    ])
  })
}

export function createToolFailureThenFatalSendMessageSpy() {
  return vi.fn((input: CopilotMessageDispatchInput) => createRuntimeMessageEventStream([
    {
      type: 'run_started',
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-then-failed:assistant',
      },
    },
    createRuntimeToolEvent({
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
      },
    }),
    createRuntimeToolEvent({
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'failed',
        title: '工具调用失败',
        summary: '工具执行失败。',
        inputSummary: LABEL_LOCATION_SHENZHEN,
        errorSummary: 'boom',
      },
    }),
    {
      type: 'run_failed',
      runId: LABEL_RUN_TOOL_THEN,
      sessionId: input.sessionId,
      sequence: 4,
      payload: {
        code: 'agent_execution_failed',
        message: 'Model stream collapsed.',
        details: {
          stage: 'execute_model',
        },
      },
    },
  ]))
}

export async function waitForAbort(signal?: AbortSignal) {
  await new Promise<never>((_resolve, reject) => {
    const abort = () => {
      const error = new Error('The operation was aborted.')
      error.name = 'AbortError'
      reject(error)
    }

    if (signal?.aborted) {
      abort()
      return
    }

    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function createToolWaitingApprovalSendMessageSpy(
  control: DeferredSignal,
  options?: {
    approval?: {
      mode: 'allow' | 'ask' | 'delay' | 'deny'
      timeoutAt: string | null
      timeoutSeconds: number | null
      timeoutAction: 'approve' | 'deny' | null
    }
  },
) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-tool-approval',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-approval:assistant',
      },
    }

    await control.wait()

    yield createRuntimeToolEvent({
      runId: 'run-tool-approval',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.remote-search:call-approve',
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'waiting_approval',
        title: '工具等待审批',
        summary: '工具调用正在等待审批决议。',
        inputSummary: LABEL_LOCATION_SHENZHEN,
        security: {
          riskLevel: 'high',
          approvalMethod: 'accept_reject',
        },
        approval: options?.approval ?? {
          mode: 'delay',
          timeoutAt: new Date(Date.now() + 30_000).toISOString(),
          timeoutSeconds: 30,
          timeoutAction: 'deny',
        },
      },
    })

    await waitForAbort(input.signal)
  })
}

export function createPersistedWorkspaceStateLoader() {
  return vi.fn(async () => ({
    ok: true as const,
    source: 'stored' as const,
    state: createPersistedWorkspaceState(),
  }))
}

export function createLoadingPersistedHistoryState(): AssistantSessionHistoryState {
  return {
    summary: {
      threadId: 'session-loading',
      boundAgentId: 'general',
      title: '加载中的历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15,
      lastActivityAt: LABEL_2026_13T15,
      lastRunId: 'run-loading-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: {
        status: 'not_evaluated',
      },
    },
    isPersistedThread: true,
    hasLoadedDetail: false,
    detailStatus: 'loading',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    selectedRunId: 'run-loading-1',
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
  }
}

export function createLiveReadyButEmptyPersistedHistoryState(
  overrides: Partial<AssistantSessionHistoryState> = {},
): AssistantSessionHistoryState {
  return {
    summary: {
      threadId: 'session-1',
      boundAgentId: 'general',
      title: '新建会话',
      titleSource: 'deterministic',
      summary: '最新摘要',
      summarySource: 'deterministic',
      createdAt: LABEL_2026_14T08_2,
      updatedAt: LABEL_2026_14T08,
      lastActivityAt: LABEL_2026_14T08,
      lastRunId: 'run-1',
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '这是助手回显',
      driftSummary: {
        status: 'not_evaluated',
      },
    },
    isPersistedThread: true,
    hasLoadedDetail: true,
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [],
    runSummaries: [],
    latestConfigurationSnapshot: null,
    availabilityDrift: null,
    selectedRunId: 'run-1',
    replayStatus: 'idle',
    replayError: null,
    replay: null,
    replayByRunId: {},
    ...overrides,
  }
}

export function createHistoryStateWithProviderDrift(): AssistantSessionHistoryState {
  const driftPayload = {
    status: 'historical_provider_removed',
    historicalModelId: LABEL_LEGACY_MODEL,
    historicalToolIds: [LABEL_TOOL_REMOTE_SEARCH],
    historicalThinkingSummary: 'unified-4-level-v1 / 中 / medium / preset',
    warnings: [{
      code: 'historical_provider_removed',
      message: '历史线程绑定的模型服务商当前已不可用，继续对话前需重新绑定模型。',
    }],
    requiresExplicitRebind: true,
  }

  return {
    summary: {
      threadId: 'session-1',
      boundAgentId: 'general',
      title: '历史线程',
      titleSource: 'deterministic',
      summary: '历史摘要',
      summarySource: 'deterministic',
      createdAt: LABEL_2026_13T15_2,
      updatedAt: LABEL_2026_13T15,
      lastActivityAt: LABEL_2026_13T15,
      lastRunId: LABEL_RUN_HISTORY,
      lastRunStatus: 'completed',
      lastUserMessagePreview: '你好',
      lastAssistantMessagePreview: '历史摘要',
      driftSummary: driftPayload,
    },
    isPersistedThread: true,
    detailStatus: 'ready',
    detailError: null,
    timelineItems: [
      {
        kind: 'assistant_message',
        runId: LABEL_RUN_HISTORY,
        sequenceStart: 1,
        sequenceEnd: 1,
        text: '历史摘要',
      },
    ],
    runSummaries: [
      {
        runId: LABEL_RUN_HISTORY,
        threadId: 'session-1',
        status: 'completed',
        createdAt: LABEL_2026_13T15_2,
        updatedAt: LABEL_2026_13T15,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: LABEL_2026_13T15,
        resolvedModelId: LABEL_LEGACY_MODEL,
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
    ],
    latestConfigurationSnapshot: null,
    availabilityDrift: driftPayload,
    selectedRunId: LABEL_RUN_HISTORY,
    replayStatus: 'ready',
    replayError: null,
    replay: {
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: LABEL_RUN_HISTORY,
        threadId: 'session-1',
        status: 'completed',
        createdAt: LABEL_2026_13T15_2,
        updatedAt: LABEL_2026_13T15,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: LABEL_2026_13T15,
        resolvedModelId: LABEL_LEGACY_MODEL,
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: {
        resolvedModelId: LABEL_LEGACY_MODEL,
        resolvedModelRoute: {
          routeRef: {
            routeKind: LABEL_PROVIDER_MODEL,
            profileId: 'provider-legacy',
            modelId: LABEL_LEGACY_MODEL,
          },
        },
        resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
        appliedThinkingSelection: {
          series: 'unified-4-level-v1',
          mode: 'preset',
          level: 'medium',
          value: {
            valueType: 'code',
            code: 'medium',
            labelZh: '中',
          },
        },
      },
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: driftPayload,
    },
  }
}

export function createAbortableSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
      },
    }

    await Promise.resolve()
    yield createRuntimeToolEvent({
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
      },
    })

    await Promise.resolve()
    yield {
      type: 'text_delta',
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 3,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
        delta: '第一段',
      },
    }

    await new Promise<never>((_resolve, reject) => {
      const abort = () => {
        const error = new Error('The operation was aborted.')
        error.name = 'AbortError'
        reject(error)
      }

      if (input.signal?.aborted) {
        abort()
        return
      }

      input.signal?.addEventListener('abort', abort, { once: true })
    })

    yield {
      type: 'text_delta',
      runId: LABEL_RUN_CANCEL,
      sessionId: input.sessionId,
      sequence: 4,
      payload: {
        assistantMessageId: 'run-cancel:assistant',
        delta: '第二段',
      },
    }
  })
}

export interface MockDesktopNotificationRecord {
  title: string
  body: string
  tag?: string
}

export interface MockDesktopNotificationController {
  records: MockDesktopNotificationRecord[]
}

export function installMockDesktopNotification(): MockDesktopNotificationController {
  const records: MockDesktopNotificationRecord[] = []

  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async (request: MockDesktopNotificationRecord) => {
        records.push({ ...request })
      }),
    } as Window['desktopNotification'],
  })

  return {
    records,
  }
}

export function installRejectingMockDesktopNotification(error: Error): MockDesktopNotificationController {
  const records: MockDesktopNotificationRecord[] = []

  Object.defineProperty(window, 'desktopNotification', {
    configurable: true,
    writable: true,
    value: {
      show: vi.fn(async (request: MockDesktopNotificationRecord) => {
        records.push({ ...request })
        throw error
      }),
    } as Window['desktopNotification'],
  })

  return {
    records,
  }
}

export function createFileWithPath(input: {
  name: string
  type: string
  path: string
  content: string
}) {
  const file = new File([input.content], input.name, { type: input.type })
  Object.defineProperty(file, 'path', {
    configurable: true,
    value: input.path,
  })
  return file
}

export function createPasteEvent(input: {
  types: string[]
  items: Array<{ kind: string; type: string }>
  files: File[]
}) {
  const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: {
      types: string[]
      items: Array<{ kind: string; type: string }>
      files: File[]
    }
  }

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: {
      types: input.types,
      items: input.items,
      files: input.files,
    },
  })

  return event
}

export async function waitForCondition(condition: () => boolean, label: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) {
      return
    }

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  throw new Error(`Timed out waiting for condition: ${label}`)
}

export async function waitForText(container: HTMLElement, expectedText: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (container.textContent?.includes(expectedText)) {
      return
    }

    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  throw new Error(`Timed out waiting for text: ${expectedText}`)
}

export function createStartOnlyPendingSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-placeholder-pending',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-placeholder-pending:assistant',
      },
    }

    await waitForAbort(input.signal)
  })
}

export function createToolFirstPendingSendMessageSpy(control: DeferredSignal) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-tool-placeholder',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-tool-placeholder:assistant',
      },
    }

    await control.wait()
    yield createRuntimeToolEvent({
      runId: 'run-tool-placeholder',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        toolCallId: 'tool.remote-search:call-placeholder',
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        phase: 'started',
        title: '调用天气工具',
        summary: DESC_CN_022,
        inputSummary: LABEL_LOCATION_SHENZHEN,
      },
    })

    await waitForAbort(input.signal)
  })
}

export function createTextFirstPendingSendMessageSpy() {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-text-placeholder',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-text-placeholder:assistant',
      },
    }

    await Promise.resolve()
    yield {
      type: 'text_delta',
      runId: 'run-text-placeholder',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        assistantMessageId: 'run-text-placeholder:assistant',
        delta: '这是助手回显',
      },
    }

    await waitForAbort(input.signal)
  })
}

export function createFailedBeforeAssistantSendMessageSpy(control: DeferredSignal) {
  return vi.fn(async function* (
    input: CopilotMessageDispatchInput,
  ): AsyncGenerator<import('./chat-contract').RuntimeRunEvent> {
    yield {
      type: 'run_started',
      runId: 'run-no-text-failed',
      sessionId: input.sessionId,
      sequence: 1,
      payload: {
        assistantMessageId: 'run-no-text-failed:assistant',
      },
    }

    await control.wait()
    yield {
      type: 'run_failed',
      runId: 'run-no-text-failed',
      sessionId: input.sessionId,
      sequence: 2,
      payload: {
        code: 'tool_execution_failed',
        message: 'Tool failed: boom',
        details: {
          toolId: LABEL_TOOL_REMOTE_SEARCH,
        },
      },
    }
  })
}
