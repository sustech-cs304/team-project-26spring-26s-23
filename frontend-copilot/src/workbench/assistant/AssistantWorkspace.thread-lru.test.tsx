/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import { createAssistantAgentDirectoryState } from './assistant-workspace-controller'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'
import { COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY } from './useAssistantWorkspaceState'

const CHAT_HISTORY_VERSION = 'chat-history-v1'
const TOOL_ID_REMOTE_SEARCH = 'tool.remote-search'
const MODEL_ID_GPT4_1 = 'openai/gpt-4.1'
const ERROR_LRU_FIXTURES = 'Expected protected and evictable LRU fixtures.'

const mockCopilotChatPanel = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-copilot-chat-panel"
    data-selected-agent={String(props.selectedAgent ? (props.selectedAgent as { id: string }).id : '')}
    data-session-id={String(props.sessionShell ? (props.sessionShell as { sessionId: string }).sessionId : '')}
  >
    chat-shell
  </div>
))

vi.mock('../../features/copilot/CopilotChatPanel', () => ({
  CopilotChatPanel: (props: Record<string, unknown>) => mockCopilotChatPanel(props),
}))

afterEach(() => {
  window.localStorage.removeItem(ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AssistantWorkspace LRU eviction', () => {
  it('evicts least recently used rebuildable completed controllers and recreates them from cached history on reopen', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    const evictedFixture = fixtures[0]
    if (evictedFixture === undefined) {
      throw new Error('Expected at least one LRU fixture.')
    }

    const {
      rendered,
      getHistoryThreadDetail,
      getHistoryRunReplay,
    } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures, {
      afterFirstThreadReady: async () => {
        await updateAssistantWorkspaceRuntimeControllers((current) => ({
          ...current,
          [evictedFixture.summary.threadId]: {
            ...current[evictedFixture.summary.threadId],
            runState: {
              ...current[evictedFixture.summary.threadId]?.runState,
              phase: 'completed',
              runId: evictedFixture.replay.run.runId,
              threadId: evictedFixture.summary.threadId,
            },
          },
        }))
      },
    })

    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return Object.keys(controllerRecord).length === COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY
        && controllerRecord[evictedFixture.summary.threadId] === undefined
    }, 24)

    const detailCallCountBeforeReopen = getHistoryThreadDetail.mock.calls.filter(
      ([threadId]) => threadId === evictedFixture.summary.threadId,
    ).length
    const replayCallCountBeforeReopen = getHistoryRunReplay.mock.calls.filter(
      ([runId]) => runId === evictedFixture.replay.run.runId,
    ).length

    await clickElement(rendered.getByTestId(`assistant-session-card-${evictedFixture.summary.threadId}`))
    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return getLastMockCopilotChatPanelProps().sessionShell?.sessionId === evictedFixture.summary.threadId
        && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
        && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'idle'
        && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
        && controllerRecord[evictedFixture.summary.threadId] !== undefined
    }, 24)

    expect(getHistoryThreadDetail.mock.calls.filter(
      ([threadId]) => threadId === evictedFixture.summary.threadId,
    ).length).toBe(detailCallCountBeforeReopen)
    expect(getHistoryRunReplay.mock.calls.filter(
      ([runId]) => runId === evictedFixture.replay.run.runId,
    ).length).toBe(replayCallCountBeforeReopen)

    rendered.unmount()
  })

  it('does not evict streaming controllers when the registry exceeds the LRU capacity', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    const protectedFixture = fixtures[0]
    const evictableFixture = fixtures[1]
    if (protectedFixture === undefined || evictableFixture === undefined) {
      throw new Error(ERROR_LRU_FIXTURES)
    }

    const { rendered } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures, {
      afterFirstThreadReady: async () => {
        await updateAssistantWorkspaceRuntimeControllers((current) => ({
          ...current,
          [protectedFixture.summary.threadId]: {
            ...current[protectedFixture.summary.threadId],
            runState: {
              ...current[protectedFixture.summary.threadId]?.runState,
              phase: 'streaming',
              runId: protectedFixture.replay.run.runId,
              threadId: protectedFixture.summary.threadId,
            },
          },
        }))
      },
    })

    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return Object.keys(controllerRecord).length === COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY
        && controllerRecord[protectedFixture.summary.threadId] !== undefined
        && controllerRecord[protectedFixture.summary.threadId]?.runState?.phase === 'streaming'
        && controllerRecord[evictableFixture.summary.threadId] === undefined
    }, 24)

    rendered.unmount()
  })

  it('does not evict handoff-pending controllers while pending history sync is unresolved', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    const protectedFixture = fixtures[0]
    const evictableFixture = fixtures[1]
    if (protectedFixture === undefined || evictableFixture === undefined) {
      throw new Error(ERROR_LRU_FIXTURES)
    }

    const { rendered } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures, {
      afterFirstThreadReady: async () => {
        await updateAssistantWorkspaceRuntimeControllers((current) => ({
          ...current,
          [protectedFixture.summary.threadId]: {
            ...current[protectedFixture.summary.threadId],
            runState: {
              ...current[protectedFixture.summary.threadId]?.runState,
              phase: 'completed',
              runId: protectedFixture.replay.run.runId,
              threadId: protectedFixture.summary.threadId,
            },
            pendingHistorySyncRunId: protectedFixture.replay.run.runId,
            lastAccessedAt: Date.now(),
          },
        }))
      },
    })

    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return Object.keys(controllerRecord).length === COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY
        && controllerRecord[protectedFixture.summary.threadId] !== undefined
        && controllerRecord[protectedFixture.summary.threadId]?.pendingHistorySyncRunId === protectedFixture.replay.run.runId
        && controllerRecord[evictableFixture.summary.threadId] === undefined
    }, 24)

    rendered.unmount()
  })

  it('does not evict awaiting-input controllers with pending inline forms when persisted history cannot rebuild the form', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    const protectedFixture = fixtures[0]
    const evictableFixture = fixtures[1]
    if (protectedFixture === undefined || evictableFixture === undefined) {
      throw new Error(ERROR_LRU_FIXTURES)
    }

    protectedFixture.detail.runSummaries = [{
      ...protectedFixture.detail.runSummaries[0],
      status: 'failed',
    }]
    protectedFixture.summary.lastRunStatus = 'failed'
    ;(protectedFixture.detail as { timelineItems: Array<Record<string, unknown>> }).timelineItems = [{
      kind: 'user_message',
      runId: protectedFixture.replay.run.runId,
      sequenceStart: 0,
      text: protectedFixture.summary.lastUserMessagePreview,
    }]

    const { rendered } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures, {
      afterFirstThreadReady: async () => {
        await updateAssistantWorkspaceRuntimeControllers((current) => ({
          ...current,
          [protectedFixture.summary.threadId]: {
            ...current[protectedFixture.summary.threadId],
            runState: {
              ...current[protectedFixture.summary.threadId]?.runState,
              phase: 'awaiting_input',
              runId: protectedFixture.replay.run.runId,
              threadId: protectedFixture.summary.threadId,
              segments: [{
                kind: 'inline-form',
                formState: 'pending',
              }],
            },
            pendingHistorySyncRunId: protectedFixture.replay.run.runId,
            lastAccessedAt: Date.now(),
          },
        }))
      },
    })

    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return Object.keys(controllerRecord).length === COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY
        && controllerRecord[protectedFixture.summary.threadId] !== undefined
        && controllerRecord[evictableFixture.summary.threadId] === undefined
    }, 24)

    rendered.unmount()
  })

  it('evicts awaiting-input controllers with pending inline forms once persisted history can rebuild the form', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    const protectedFixture = fixtures[0]
    const evictableFixture = fixtures[1]
    if (protectedFixture === undefined || evictableFixture === undefined) {
      throw new Error(ERROR_LRU_FIXTURES)
    }

    protectedFixture.detail.runSummaries = [{
      ...protectedFixture.detail.runSummaries[0],
      status: 'failed',
    }]
    protectedFixture.summary.lastRunStatus = 'failed'
    ;(protectedFixture.detail as { timelineItems: Array<Record<string, unknown>> }).timelineItems = [
      {
        kind: 'user_message',
        runId: protectedFixture.replay.run.runId,
        sequenceStart: 0,
        text: protectedFixture.summary.lastUserMessagePreview,
      },
      {
        kind: 'tool_call_block',
        runId: protectedFixture.replay.run.runId,
        toolCallId: 'tool.request-user-form:call-1',
        toolId: 'tool.request-user-form',
        sequenceStart: 1,
        title: '请求课程表单',
        summary: '请填写课程编码。',
        resultSummary: '表单请求已发送，等待用户提交。',
        formRequest: {
          formId: 'course-form',
          title: '请求课程表单',
          submitLabel: '提交',
          fields: [{
            name: 'courseCode',
            label: '课程编码',
            type: 'text',
            required: true,
          }],
        },
        phases: [{
          phase: 'completed',
          sequence: 1,
          title: '请求课程表单',
          summary: '请填写课程编码。',
          resultSummary: '表单请求已发送，等待用户提交。',
          formRequest: {
            formId: 'course-form',
            title: '请求课程表单',
            submitLabel: '提交',
            fields: [{
              name: 'courseCode',
              label: '课程编码',
              type: 'text',
              required: true,
            }],
          },
        }],
      },
    ]

    const { rendered } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures, {
      afterFirstThreadReady: async () => {
        await updateAssistantWorkspaceRuntimeControllers((current) => ({
          ...current,
          [protectedFixture.summary.threadId]: {
            ...current[protectedFixture.summary.threadId],
            runState: {
              ...current[protectedFixture.summary.threadId]?.runState,
              phase: 'awaiting_input',
              runId: protectedFixture.replay.run.runId,
              threadId: protectedFixture.summary.threadId,
              segments: [{
                kind: 'inline-form',
                formState: 'pending',
              }],
            },
            pendingHistorySyncRunId: protectedFixture.replay.run.runId,
            lastAccessedAt: 0,
          },
        }))
      },
    })

    await waitForAssistantWorkspaceCondition(() => {
      const controllerRecord = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId ?? {}
      return Object.keys(controllerRecord).length === COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY
        && controllerRecord[protectedFixture.summary.threadId] === undefined
        && controllerRecord[evictableFixture.summary.threadId] !== undefined
    }, 24)

    rendered.unmount()
  })
})

type MockRuntimeControllerRecord = Record<string, {
  composerDraft?: {
    messageText?: string
    selectedModelId?: string
    selectedModelRoute?: Record<string, unknown> | null
    thinkingSelection?: Record<string, unknown> | null
    enabledTools?: string[]
    requestOptionsText?: string
  }
  runState?: {
    phase?: string
    runId?: string | null
    threadId?: string | null
    segments?: Array<{
      kind?: string
      formState?: string
    }>
  }
  pendingHistorySyncRunId?: string | null
  activeAbortController?: AbortController | null
  lastAccessedAt?: number
  [key: string]: unknown
}>

function createLruPersistedHistoryFixtures(
  count = COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY + 1,
) {
  return Array.from({ length: count }, (_, index) => createIndexedPersistedHistoryFixture(index + 1))
}

function createIndexedPersistedHistoryFixture(index: number) {
  const suffix = String(index).padStart(2, '0')
  const threadId = `thread-lru-${suffix}`
  const runId = `run-lru-${suffix}`
  const userText = `LRU 问题 ${index}`
  const assistantText = `LRU 回答 ${index}`
  const createdAt = `2026-04-14T08:${suffix}:00Z`
  const updatedAt = `2026-04-14T08:${suffix}:30Z`
  const summary = {
    threadId,
    boundAgentId: 'general',
    title: `LRU 线程 ${index}`,
    titleSource: 'deterministic',
    summary: assistantText,
    summarySource: 'deterministic',
    createdAt,
    updatedAt,
    lastActivityAt: updatedAt,
    lastRunId: runId,
    lastRunStatus: 'completed',
    lastUserMessagePreview: userText,
    lastAssistantMessagePreview: assistantText,
    driftSummary: {
      status: 'not_evaluated',
    },
  }
  const runSummary = {
    runId,
    threadId,
    status: 'completed',
    createdAt,
    updatedAt,
    startedAt: createdAt,
    terminalAt: updatedAt,
    resolvedModelId: MODEL_ID_GPT4_1,
    requestedMessageText: userText,
    assistantText,
  }

  return {
    summary,
    detail: {
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      thread: {
        ...summary,
      },
      timelineItems: [
        {
          kind: 'user_message',
          runId,
          sequenceStart: 0,
          text: userText,
        },
        {
          kind: 'assistant_message',
          runId,
          sequenceStart: 1,
          text: assistantText,
        },
      ],
      runSummaries: [{
        ...runSummary,
      }],
      latestConfigurationSnapshot: {
        runId,
        modelSnapshot: {
          resolvedModelId: MODEL_ID_GPT4_1,
        },
        toolsSnapshot: {
          resolvedToolIds: [TOOL_ID_REMOTE_SEARCH],
        },
      },
      availabilityDrift: {
        status: 'not_evaluated',
      },
    },
    replay: {
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      run: {
        ...runSummary,
      },
      historicalSnapshot: {
        resolvedModelId: MODEL_ID_GPT4_1,
        resolvedToolIds: [TOOL_ID_REMOTE_SEARCH],
      },
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: {
        status: 'not_evaluated',
      },
    },
  }
}

async function renderAssistantWorkspaceWithHydratedLruFixtures(
  fixtures: ReturnType<typeof createLruPersistedHistoryFixtures>,
  options: {
    afterFirstThreadReady?: () => Promise<void>
  } = {},
) {
  const directoryResponse = createDirectoryResponse()
  const directoryState = createAssistantAgentDirectoryState(directoryResponse)
  const fixtureByThreadId = Object.fromEntries(fixtures.map((fixture) => [fixture.summary.threadId, fixture]))
  const fixtureByRunId = Object.fromEntries(fixtures.map((fixture) => [fixture.replay.run.runId, fixture]))
  const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({
    sessionId,
    capabilitiesVersion: `cap-${sessionId}`,
  }))
  const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => fixtureByThreadId[threadId].detail)
  const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => fixtureByRunId[runId].replay)
  const rendered = renderWithRoot(
    <AssistantWorkspace
      bootstrap={createBootstrapController()}
      getCapabilities={getCapabilities}
      getHistoryThreadDetail={getHistoryThreadDetail}
      getHistoryRunReplay={getHistoryRunReplay}
      initialDirectoryState={directoryState}
      listHistoryThreads={vi.fn().mockResolvedValue({
        ok: true as const,
        version: CHAT_HISTORY_VERSION,
        threads: fixtures.map((fixture) => fixture.summary),
      })}
    />,
  )

  await waitForAssistantWorkspaceCondition(
    () => rendered.queryByTestId(`assistant-session-card-${fixtures[0]?.summary.threadId ?? ''}`) !== null,
    24,
  )

  for (const [index, fixture] of fixtures.entries()) {
    await clickElement(rendered.getByTestId(`assistant-session-card-${fixture.summary.threadId}`))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === fixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ), 24)

    if (index === 0) {
      await options.afterFirstThreadReady?.()
    }
  }

  return {
    rendered,
    getCapabilities,
    getHistoryThreadDetail,
    getHistoryRunReplay,
  }
}

async function updateAssistantWorkspaceRuntimeControllers(
  updater: (current: MockRuntimeControllerRecord) => MockRuntimeControllerRecord,
) {
  const setter = getLastMockCopilotChatPanelProps().setRuntimeControllerBySessionId
  if (setter === undefined) {
    throw new Error('Expected runtime controller setter from AssistantWorkspace.')
  }

  await act(async () => {
    setter((current) => updater(current))
    await Promise.resolve()
    await Promise.resolve()
  })
}

function getLastMockCopilotChatPanelProps(): {
  selectedAgent?: {
    id?: string
  } | null
  sessionShell?: {
    sessionId?: string
  }
  historyRestoreError?: string | null
  sessionHistory?: {
    isPersistedThread?: boolean
    detailStatus?: string
    replayStatus?: string
    capabilitiesStatus?: string
    selectedRunId?: string | null
  }
  selectSessionHistoryRun?: (runId: string | null) => void
  onSessionRunSettled?: (runId: string | null, sessionId: string | null) => void
  runtimeControllerBySessionId?: MockRuntimeControllerRecord
  setRuntimeControllerBySessionId?: (
    value: MockRuntimeControllerRecord | ((current: MockRuntimeControllerRecord) => MockRuntimeControllerRecord)
  ) => void
} {
  const activeCall = findLast(
    mockCopilotChatPanel.mock.calls,
    ([props]) => typeof (props as Record<string, unknown>).selectSessionHistoryRun === 'function',
  )
  const props = activeCall !== undefined
    ? activeCall[0]
    : mockCopilotChatPanel.mock.calls[mockCopilotChatPanel.mock.calls.length - 1]?.[0]

  if (props === undefined) {
    throw new Error('Expected CopilotChatPanel to receive props.')
  }

  return props as {
    selectedAgent?: {
      id?: string
    } | null
    sessionShell?: {
      sessionId?: string
    }
    historyRestoreError?: string | null
    sessionHistory?: {
      isPersistedThread?: boolean
      detailStatus?: string
      replayStatus?: string
      capabilitiesStatus?: string
      selectedRunId?: string | null
    }
    selectSessionHistoryRun?: (runId: string | null) => void
    onSessionRunSettled?: (runId: string | null, sessionId: string | null) => void
    runtimeControllerBySessionId?: MockRuntimeControllerRecord
    setRuntimeControllerBySessionId?: (
      value: MockRuntimeControllerRecord | ((current: MockRuntimeControllerRecord) => MockRuntimeControllerRecord)
    ) => void
  }
}

function findLast<T>(array: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = array.length - 1; index >= 0; index -= 1) {
    const item = array[index]
    if (item !== undefined && predicate(item)) {
      return item
    }
  }
  return undefined
}

async function flushAssistantWorkspaceEffects() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0)
    })
    await Promise.resolve()
  })
}

async function waitForAssistantWorkspaceCondition(predicate: () => boolean, attempts = 16) {
  for (let index = 0; index < attempts; index += 1) {
    await flushAssistantWorkspaceEffects()
    if (predicate()) {
      return
    }
  }

  expect(predicate()).toBe(true)
}
