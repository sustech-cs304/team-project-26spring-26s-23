/** @vitest-environment jsdom */

import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDeferred,
  createDirectoryResponse,
  createSessionResponse,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionShell,
} from './assistant-workspace-controller'
import {
  createRuntimeModelRoute,
  createRuntimeThinkingSelection,
} from '../../features/copilot/thread-run-contract.test-support'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'

const CHAT_HISTORY_VERSION = 'chat-history-v1'
const TOOL_ID_REMOTE_SEARCH = 'tool.remote-search'
const MODEL_ID_GPT4_1 = 'openai/gpt-4.1'
const TEST_ID_SESSION_CARD_THREAD_1 = 'assistant-session-card-thread-1'
const TS_2026_04_13T15_05_00Z = '2026-04-13T15:05:00Z'
const TS_2026_04_13T16_00_00Z = '2026-04-13T16:00:00Z'
const COPILOT_DEBUG_PREFIX = '[copilot-debug]'
const SCOPE_ASSISTANT_WORKSPACE = 'assistant-workspace'

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

describe('AssistantWorkspace retry and recovery', () => {
  it('retries an initially empty persisted history snapshot and restores threads when a later retry returns data', async () => {
    mockCopilotChatPanel.mockClear()

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const nativeSetTimeout = window.setTimeout.bind(window)
    const scheduledRetries: Array<{ handler: (() => void); delay: number }> = []
    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    let historyVisible = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: historyVisible ? [historyFixture.summary] : [],
    }))
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const bootstrap = createBootstrapController()
    if ('bootstrapFields' in bootstrap.state) {
      bootstrap.state.bootstrapFields.debugModeEnabled = true
    }
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number) => {
      const retryDelayMs = typeof delay === 'number' ? delay : 0
      if (retryDelayMs === 0) {
        return nativeSetTimeout(handler, retryDelayMs) as unknown as number
      }
      if (typeof handler !== 'function') {
        throw new Error('Expected history restore retry handler to be a function.')
      }

      scheduledRetries.push({
        handler: () => {
          handler()
        },
        delay: retryDelayMs,
      })
      return (1_000_000 + scheduledRetries.length) as unknown as number
    }) as typeof window.setTimeout)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={bootstrap}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length === 1)
    expect(rendered.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1)).toBeNull()
    expect(getHistoryThreadDetail).not.toHaveBeenCalled()
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(scheduledRetries).toHaveLength(1)
    expect(scheduledRetries[0]?.delay).toBe(1_000)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === COPILOT_DEBUG_PREFIX
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === SCOPE_ASSISTANT_WORKSPACE
      && 'event' in call[1]
      && call[1].event === 'history-restore-request-empty-provisional'
      && 'threadCount' in call[1]
      && call[1].threadCount === 0
    ))).toBe(true)

    historyVisible = true
    const scheduledRetry = scheduledRetries.shift()
    if (scheduledRetry === undefined) {
      throw new Error('Expected a scheduled history restore retry handler.')
    }

    await act(async () => {
      scheduledRetry.handler()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length === 2)
    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1) !== null)
    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length >= 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1).textContent).toContain('历史线程')
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === COPILOT_DEBUG_PREFIX
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === SCOPE_ASSISTANT_WORKSPACE
      && 'event' in call[1]
      && call[1].event === 'history-restore-request-succeeded'
      && 'isEmpty' in call[1]
      && call[1].isEmpty === false
      && 'threadCount' in call[1]
      && call[1].threadCount === 1
    ))).toBe(true)

    setTimeoutSpy.mockRestore()
    rendered.unmount()
  })

  it('protects a user-created live session from being overwritten by a late restore result', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    let releaseRestore: (() => void) | null = null
    const restoreRelease = new Promise<void>((resolve) => {
      releaseRestore = resolve
    })
    const listHistoryThreads = vi.fn().mockImplementation(async () => {
      await restoreRelease
      return {
        ok: true as const,
        version: CHAT_HISTORY_VERSION,
        threads: [historyFixture.summary],
      }
    })
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: 'thread-live-race',
      createdAt: '2026-04-14T09:00:00Z',
      updatedAt: '2026-04-14T09:00:00Z',
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: 'thread-live-race',
      capabilitiesVersion: 'cap-live-race',
    }))
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        createSession={createSession}
        getCapabilities={getCapabilities}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await flushAssistantWorkspaceMicrotasks()
    expect(listHistoryThreads.mock.calls.length).toBeGreaterThanOrEqual(1)
    await clickElement(rendered.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live-race'
    ))

    await act(async () => {
      releaseRestore?.()
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live-race'
    ))
    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1) !== null)

    rendered.unmount()
  })

  it('keeps a non-empty restore visible under StrictMode when startup agent hydration overlaps the restore request', async () => {
    mockCopilotChatPanel.mockClear()

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const directoryResponse = createDirectoryResponse()
    const historyFixture = createPersistedHistoryFixture()
    const secondMountRestore = createDeferred<{
      ok: true
      version: typeof CHAT_HISTORY_VERSION
      threads: [typeof historyFixture.summary]
    }>()
    let historyRequestCount = 0
    const listHistoryThreads = vi.fn().mockImplementation(() => {
      historyRequestCount += 1
      if (historyRequestCount === 2) {
        return secondMountRestore.promise
      }

      return new Promise<{
        ok: true
        version: typeof CHAT_HISTORY_VERSION
        threads: [typeof historyFixture.summary]
      }>(() => {})
    })
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const bootstrap = createBootstrapController()
    if ('bootstrapFields' in bootstrap.state) {
      bootstrap.state.bootstrapFields.debugModeEnabled = true
    }

    const rendered = renderWithRoot(
      <StrictMode>
        <AssistantWorkspace
          bootstrap={bootstrap}
          listAgents={listAgents}
          listHistoryThreads={listHistoryThreads}
          getHistoryThreadDetail={getHistoryThreadDetail}
          getHistoryRunReplay={getHistoryRunReplay}
        />
      </StrictMode>,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => listAgents.mock.calls.length >= 2)
    await flushAssistantWorkspaceEffects()

    expect(listHistoryThreads).toHaveBeenCalledTimes(2)

    await act(async () => {
      secondMountRestore.resolve({
        ok: true,
        version: CHAT_HISTORY_VERSION,
        threads: [historyFixture.summary],
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1) !== null)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))
    await flushAssistantWorkspaceEffects()

    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: 'thread-1',
      threadSummaries: [
        expect.objectContaining({
          threadId: 'thread-1',
        }),
      ],
    })
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === COPILOT_DEBUG_PREFIX
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === SCOPE_ASSISTANT_WORKSPACE
      && 'event' in call[1]
      && call[1].event === 'history-restore-request-succeeded'
      && 'threadCount' in call[1]
      && call[1].threadCount === 1
      && 'restoredSessionCount' in call[1]
      && call[1].restoredSessionCount === 1
    ))).toBe(true)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === COPILOT_DEBUG_PREFIX
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === SCOPE_ASSISTANT_WORKSPACE
      && 'event' in call[1]
      && call[1].event === 'workspace-shell-state-persisted'
      && 'threadSummaryCount' in call[1]
      && call[1].threadSummaryCount === 1
      && 'threadSummarySource' in call[1]
      && call[1].threadSummarySource === 'session-list'
    ))).toBe(true)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === COPILOT_DEBUG_PREFIX
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === SCOPE_ASSISTANT_WORKSPACE
      && 'event' in call[1]
      && call[1].event === 'history-restore-request-discarded'
      && 'discardReason' in call[1]
      && call[1].discardReason === 'stale-request-version'
      && 'threadCount' in call[1]
      && call[1].threadCount === 1
    ))).toBe(false)

    rendered.unmount()
  })

  it('retries persisted list restore with backoff and keeps the error visible even when a live session exists', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]
    if (!selectedAgent) {
      throw new Error('Expected seeded agent directory.')
    }

    const initialSessionShell = createAssistantSessionShell({
      response: createSessionResponse({
        threadId: 'thread-live-visible',
        createdAt: '2026-04-14T10:00:00Z',
        updatedAt: '2026-04-14T10:00:00Z',
      }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({
        sessionId: 'thread-live-visible',
        capabilitiesVersion: 'cap-live-visible',
      }),
    })
    const failureMessage = 'history list unavailable'
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: false as const,
      error: failureMessage,
    })
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const scheduledRetries: Array<{ handler: TimerHandler; delay: number }> = []
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((handler: TimerHandler, delay?: number) => {
      scheduledRetries.push({
        handler,
        delay: typeof delay === 'number' ? delay : 0,
      })
      return scheduledRetries.length as unknown as number
    }) as typeof window.setTimeout)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        initialDirectoryState={directoryState}
        initialSessionShell={initialSessionShell}
      />,
    )

    await flushAssistantWorkspaceMicrotasks()
    expect(getLastMockCopilotChatPanelProps().sessionShell?.sessionId).toBe('thread-live-visible')
    expect(getLastMockCopilotChatPanelProps().historyRestoreError).toBe(failureMessage)
    expect(listHistoryThreads.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(scheduledRetries.length).toBeGreaterThanOrEqual(1)
    expect(scheduledRetries.some((scheduledRetry) => scheduledRetry.delay === 1_000)).toBe(true)

    setTimeoutSpy.mockRestore()
    rendered.unmount()
  })

  it('retries persisted detail and replay loading when reactivating the same thread', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'detail unavailable',
      })
      .mockResolvedValueOnce(historyFixture.detail)
    const getHistoryRunReplay = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'replay unavailable',
      })
      .mockResolvedValueOnce(historyFixture.replay)

    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: historyFixture.summary.threadId,
      capabilitiesVersion: 'cap-thread-1',
    }))

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listHistoryThreads={listHistoryThreads}
        getCapabilities={getCapabilities}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length >= 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'error'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1))

    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))
    expect(getHistoryRunReplay).not.toHaveBeenCalled()

    await act(async () => {
      getLastMockCopilotChatPanelProps().selectSessionHistoryRun?.('run-1')
    })

    await waitForAssistantWorkspaceCondition(() => getHistoryRunReplay.mock.calls.length >= 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === 'run-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'error'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1))

    await waitForAssistantWorkspaceCondition(() => getHistoryRunReplay.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === 'run-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledTimes(2)
    expect(getHistoryRunReplay).toHaveBeenCalledTimes(2)

    rendered.unmount()
  })

  it('retries restored thread capability hydration after a failure and eventually hydrates the shell', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary],
    })
    const getCapabilities = vi.fn()
      .mockRejectedValueOnce(new Error('capabilities unavailable'))
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: historyFixture.summary.threadId,
        capabilitiesVersion: 'cap-thread-1-hydrated',
      }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getCapabilities={getCapabilities}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => getCapabilities.mock.calls.length >= 1)

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1))

    await waitForAssistantWorkspaceCondition(() => getCapabilities.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === historyFixture.summary.threadId
    ))

    rendered.unmount()
  })

  it('keeps startup-restored history thread immediately visible even before directory selection finishes syncing', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const delayedAgents = createDeferred<typeof directoryResponse>()
    const listAgents = vi.fn().mockImplementation(async () => delayedAgents.promise)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const bootstrap = createBootstrapController()
    if ('bootstrapFields' in bootstrap.state) {
      bootstrap.state.bootstrapFields.debugModeEnabled = true
    }

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={bootstrap}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId('assistant-session-list') !== null)
    expect(rendered.container.textContent).toContain(historyFixture.summary.title)

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === historyFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().selectedAgent?.id === historyFixture.summary.boundAgentId
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledWith(historyFixture.summary.threadId)
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    delayedAgents.resolve(directoryResponse)
    await flushAssistantWorkspaceMicrotasks()

    rendered.unmount()
  })

  it('restores an empty persisted thread through detail loading and keeps the new topic title', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const emptyHistoryFixture = createEmptyPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [emptyHistoryFixture.summary],
    })
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: emptyHistoryFixture.summary.threadId,
      capabilitiesVersion: 'cap-thread-empty-hydrated',
    }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(emptyHistoryFixture.detail)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getCapabilities={getCapabilities}
        getHistoryThreadDetail={getHistoryThreadDetail}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length >= 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === emptyHistoryFixture.summary.threadId
      && (getLastMockCopilotChatPanelProps().sessionShell as { sessionId?: string, title?: string } | undefined)?.title === '新话题'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledWith(emptyHistoryFixture.summary.threadId)
    expect(getLastMockCopilotChatPanelProps().sessionHistory).toMatchObject({
      detailStatus: 'ready',
      timelineItems: [],
      runSummaries: [],
    })

    rendered.unmount()
  })
})

function createPersistedHistoryFixture() {
  const summary = {
    threadId: 'thread-1',
    boundAgentId: 'general',
    title: '历史线程',
    titleSource: 'deterministic',
    summary: '历史摘要',
    summarySource: 'deterministic',
    createdAt: '2026-04-13T15:00:00Z',
    updatedAt: TS_2026_04_13T15_05_00Z,
    lastActivityAt: TS_2026_04_13T15_05_00Z,
    lastRunId: 'run-1',
    lastRunStatus: 'completed',
    lastUserMessagePreview: '你好',
    lastAssistantMessagePreview: '历史摘要',
    driftSummary: {
      status: 'not_evaluated',
    },
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
          runId: 'run-1',
          sequenceStart: 0,
          text: '你好',
        },
      ],
      runSummaries: [
        {
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'completed',
          createdAt: '2026-04-13T15:00:00Z',
          updatedAt: TS_2026_04_13T15_05_00Z,
          startedAt: '2026-04-13T15:00:01Z',
          terminalAt: TS_2026_04_13T15_05_00Z,
          resolvedModelId: MODEL_ID_GPT4_1,
          requestedMessageText: '你好',
          assistantText: '历史摘要',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-1',
        modelSnapshot: {
          resolvedModelId: MODEL_ID_GPT4_1,
          selectedModelRoute: createRuntimeModelRoute({
            providerProfileId: 'provider-openai',
            modelId: MODEL_ID_GPT4_1,
          }),
          appliedThinkingSelection: createRuntimeThinkingSelection({
            series: 'compat-discrete-levels-v1',
            level: 'medium',
          }),
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
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: TS_2026_04_13T15_05_00Z,
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: TS_2026_04_13T15_05_00Z,
        resolvedModelId: MODEL_ID_GPT4_1,
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: {
        resolvedModelId: MODEL_ID_GPT4_1,
        resolvedModelRoute: {
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-openai',
            modelId: MODEL_ID_GPT4_1,
          },
        },
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

function createEmptyPersistedHistoryFixture() {
  const summary = {
    threadId: 'thread-empty',
    boundAgentId: 'general',
    title: '新话题',
    titleSource: 'deterministic',
    summary: null,
    summarySource: null,
    createdAt: TS_2026_04_13T16_00_00Z,
    updatedAt: TS_2026_04_13T16_00_00Z,
    lastActivityAt: TS_2026_04_13T16_00_00Z,
    lastRunId: null,
    lastRunStatus: null,
    lastUserMessagePreview: null,
    lastAssistantMessagePreview: null,
    driftSummary: null,
  }

  return {
    summary,
    detail: {
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      thread: {
        ...summary,
      },
      timelineItems: [],
      runSummaries: [],
      latestConfigurationSnapshot: null,
      availabilityDrift: null,
    },
  }
}

function getLastMockCopilotChatPanelProps(): {
  selectedAgent?: {
    id?: string
  } | null
  sessionShell?: {
    sessionId?: string
    title?: string
  }
  historyRestoreError?: string | null
  sessionHistory?: {
    isPersistedThread?: boolean
    detailStatus?: string
    replayStatus?: string
    capabilitiesStatus?: string
    selectedRunId?: string | null
    timelineItems?: unknown[]
    runSummaries?: unknown[]
  }
  selectSessionHistoryRun?: (runId: string | null) => void
  onSessionRunSettled?: (runId: string | null, sessionId: string | null) => void
  runtimeControllerBySessionId?: Record<string, unknown>
  setRuntimeControllerBySessionId?: unknown
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
      title?: string
    }
    historyRestoreError?: string | null
    sessionHistory?: {
      isPersistedThread?: boolean
      detailStatus?: string
      replayStatus?: string
      capabilitiesStatus?: string
      selectedRunId?: string | null
      timelineItems?: unknown[]
      runSummaries?: unknown[]
    }
    selectSessionHistoryRun?: (runId: string | null) => void
    onSessionRunSettled?: (runId: string | null, sessionId: string | null) => void
    runtimeControllerBySessionId?: Record<string, unknown>
    setRuntimeControllerBySessionId?: unknown
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

function readPersistedAssistantWorkspaceShellState(): {
  selectedThreadId: string | null
  selectedRunIdByThreadId: Record<string, string>
  threadSummaries: Array<{
    threadId: string
  }>
} {
  const rawValue = window.localStorage.getItem(ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY)
  if (rawValue === null) {
    return {
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    }
  }

  return JSON.parse(rawValue) as {
    selectedThreadId: string | null
    selectedRunIdByThreadId: Record<string, string>
    threadSummaries: Array<{
      threadId: string
    }>
  }
}

async function flushAssistantWorkspaceEffects() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0)
    })
    await Promise.resolve()
  })
}

async function flushAssistantWorkspaceMicrotasks() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
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
