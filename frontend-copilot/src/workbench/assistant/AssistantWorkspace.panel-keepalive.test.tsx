/** @vitest-environment jsdom */

import { act } from 'react'
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
import { createAssistantAgentDirectoryState } from './assistant-workspace-controller'
import {
  createRuntimeModelRoute,
  createRuntimeThinkingSelection,
} from '../../features/copilot/thread-run-contract.test-support'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'
import { COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY } from './useAssistantWorkspaceState'

const CHAT_HISTORY_VERSION = 'chat-history-v1'
const TOOL_ID_REMOTE_SEARCH = 'tool.remote-search'
const MODEL_ID_GPT4_1 = 'openai/gpt-4.1'
const TEST_ID_SESSION_CARD_THREAD_1 = 'assistant-session-card-thread-1'
const TEST_ID_SESSION_CARD_THREAD_2 = 'assistant-session-card-thread-2'
const TEST_ID_CREATE_SESSION_BUTTON = 'assistant-create-session-button'
const ARIA_HIDDEN = 'aria-hidden'
const ERROR_SEEDED_AGENT_DIRECTORY = 'Expected seeded agent directory.'
const TS_2026_04_14T08_00_00Z = '2026-04-14T08:00:00Z'

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

describe('AssistantWorkspace panel keepalive', () => {
  it('renders keepalive wrapper with layout class on the active panel and hides inactive panels accessibly', async () => {
    mockCopilotChatPanel.mockClear()

    const fixtures = createLruPersistedHistoryFixtures()
    if (fixtures.length < 2) {
      throw new Error('Expected at least 2 LRU fixtures for keepalive wrapper test.')
    }

    const { rendered } = await renderAssistantWorkspaceWithHydratedLruFixtures(fixtures)

    const keepaliveWrappers = rendered.container.querySelectorAll('[data-keepalive-panel]')
    expect(keepaliveWrappers.length).toBeGreaterThanOrEqual(1)

    const activeWrappers: Element[] = []
    const hiddenWrappers: Element[] = []

    for (const wrapper of keepaliveWrappers) {
      if (wrapper.hasAttribute('hidden')) {
        hiddenWrappers.push(wrapper)
      } else {
        activeWrappers.push(wrapper)
      }
    }

    expect(activeWrappers.length).toBe(1)
    expect(hiddenWrappers.length).toBeGreaterThanOrEqual(1)

    const activeWrapper = activeWrappers[0]!
    expect(activeWrapper.classList.contains('workspace-chat-keepalive-panel')).toBe(true)
    expect(activeWrapper.hasAttribute('hidden')).toBe(false)
    expect(activeWrapper.getAttribute('data-keepalive-panel')).toBeTruthy()
    expect(activeWrapper.querySelector('[data-testid="mock-copilot-chat-panel"]')).not.toBeNull()

    for (const hiddenWrapper of hiddenWrappers) {
      expect(hiddenWrapper.classList.contains('workspace-chat-keepalive-panel')).toBe(true)
      expect(hiddenWrapper.hasAttribute('hidden')).toBe(true)
      expect(hiddenWrapper.getAttribute(ARIA_HIDDEN)).toBe('true')
      expect(hiddenWrapper.getAttribute('data-keepalive-panel')).toBeTruthy()
    }

    rendered.unmount()
  })

  it('keeps the previous visited panel visible and locked while an unvisited restored thread loads', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const firstFixture = createPersistedHistoryFixture()
    const secondFixture = createMultiRunPersistedHistoryFixture()
    const pendingSecondDetail = createDeferred<typeof secondFixture.detail>()
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [firstFixture.summary, secondFixture.summary],
    })
    const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({
      sessionId,
      capabilitiesVersion: `cap-${sessionId}`,
    }))
    const getHistoryThreadDetail = vi.fn().mockImplementation((threadId: string) => (
      threadId === secondFixture.summary.threadId ? pendingSecondDetail.promise : Promise.resolve(firstFixture.detail)
    ))
    const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === firstFixture.replay.run.runId) {
        return firstFixture.replay
      }

      return secondFixture.replaysByRunId[runId as keyof typeof secondFixture.replaysByRunId]
    })

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

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === firstFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    await clickElement(rendered.getByTestId(`assistant-session-card-${secondFixture.summary.threadId}`))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === secondFixture.summary.threadId)
    ))
    await flushAssistantWorkspaceEffects()

    const retainedPanel = rendered.container.querySelector(`[data-keepalive-panel="${firstFixture.summary.threadId}"]`)
    const pendingPanel = rendered.container.querySelector(`[data-keepalive-panel="${secondFixture.summary.threadId}"]`)
    expect(retainedPanel).not.toBeNull()
    expect(retainedPanel?.hasAttribute('hidden')).toBe(false)
    expect(retainedPanel?.getAttribute(ARIA_HIDDEN)).toBe('false')
    expect(retainedPanel?.getAttribute('data-session-switch-retained')).toBe('true')
    expect(retainedPanel?.hasAttribute('inert')).toBe(true)
    expect(pendingPanel === null || pendingPanel.hasAttribute('hidden')).toBe(true)

    pendingSecondDetail.resolve(secondFixture.detail)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === secondFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    const readyPanel = rendered.container.querySelector(`[data-keepalive-panel="${secondFixture.summary.threadId}"]`)
    expect(readyPanel).not.toBeNull()
    expect(readyPanel?.hasAttribute('hidden')).toBe(false)
    expect(readyPanel?.getAttribute(ARIA_HIDDEN)).toBe('false')
    expect(readyPanel?.hasAttribute('inert')).toBe(false)
    expect(retainedPanel?.hasAttribute('hidden')).toBe(true)
    expect(retainedPanel?.getAttribute('data-session-switch-retained')).toBeNull()

    rendered.unmount()
  })

  it('keeps recently visited chat panels alive in the DOM with hidden inactive panels when switching sessions', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]
    if (!selectedAgent) {
      throw new Error(ERROR_SEEDED_AGENT_DIRECTORY)
    }

    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const createSession = vi.fn()
      .mockResolvedValueOnce(createSessionResponse({ threadId: 'session-a', createdAt: TS_2026_04_14T08_00_00Z, updatedAt: TS_2026_04_14T08_00_00Z }))
      .mockResolvedValueOnce(createSessionResponse({ threadId: 'session-b', createdAt: '2026-04-14T08:01:00Z', updatedAt: '2026-04-14T08:01:00Z' }))
      .mockResolvedValueOnce(createSessionResponse({ threadId: 'session-c', createdAt: '2026-04-14T08:02:00Z', updatedAt: '2026-04-14T08:02:00Z' }))
    const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({ sessionId }))

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        createSession={createSession}
        getCapabilities={getCapabilities}
        initialDirectoryState={directoryState}
      />,
    )

    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'session-a'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'session-b'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'session-c'
    ))

    const panelA = rendered.container.querySelector('[data-keepalive-panel="session-a"]')
    const panelB = rendered.container.querySelector('[data-keepalive-panel="session-b"]')
    const panelC = rendered.container.querySelector('[data-keepalive-panel="session-c"]')

    expect(panelA).not.toBeNull()
    expect(panelB).not.toBeNull()
    expect(panelC).not.toBeNull()

    expect(panelA?.hasAttribute('hidden')).toBe(true)
    expect(panelA?.getAttribute(ARIA_HIDDEN)).toBe('true')
    expect(panelB?.hasAttribute('hidden')).toBe(true)
    expect(panelB?.getAttribute(ARIA_HIDDEN)).toBe('true')
    expect(panelC?.hasAttribute('hidden')).toBe(false)
    expect(panelC?.getAttribute(ARIA_HIDDEN)).toBe('false')

    await clickElement(rendered.getByTestId('assistant-session-card-session-a'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'session-a'
    ))

    const panelAAfterSwitch = rendered.container.querySelector('[data-keepalive-panel="session-a"]')
    const panelCAfterSwitch = rendered.container.querySelector('[data-keepalive-panel="session-c"]')

    expect(panelAAfterSwitch?.hasAttribute('hidden')).toBe(false)
    expect(panelAAfterSwitch?.getAttribute(ARIA_HIDDEN)).toBe('false')
    expect(panelCAfterSwitch?.hasAttribute('hidden')).toBe(true)
    expect(panelCAfterSwitch?.getAttribute(ARIA_HIDDEN)).toBe('true')

    rendered.unmount()
  })

  it('evicts the least-recently-used chat panel from DOM when keep-alive capacity (10) is exceeded', async () => {
    mockCopilotChatPanel.mockClear()

    const PANEL_CAPACITY = 10
    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]
    if (!selectedAgent) {
      throw new Error(ERROR_SEEDED_AGENT_DIRECTORY)
    }

    const sessionIds = Array.from({ length: PANEL_CAPACITY + 2 }, (_, i) => `keepalive-session-${i + 1}`)
    const createSession = vi.fn()
    for (const sessionId of sessionIds) {
      createSession.mockResolvedValueOnce(createSessionResponse({
        threadId: sessionId,
        createdAt: `2026-04-14T08:${String(sessionIds.indexOf(sessionId)).padStart(2, '0')}:00Z`,
        updatedAt: `2026-04-14T08:${String(sessionIds.indexOf(sessionId)).padStart(2, '0')}:00Z`,
      }))
    }
    const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({ sessionId }))
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        createSession={createSession}
        getCapabilities={getCapabilities}
        initialDirectoryState={directoryState}
      />,
    )

    for (const sessionId of sessionIds) {
      await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
      await waitForAssistantWorkspaceCondition(() => (
        getLastMockCopilotChatPanelProps().sessionShell?.sessionId === sessionId
      ))
    }

    const keepAlivePanels = rendered.container.querySelectorAll('[data-keepalive-panel]')
    expect(keepAlivePanels.length).toBe(PANEL_CAPACITY)

    const firstSessionId = sessionIds[0]
    expect(rendered.container.querySelector(`[data-keepalive-panel="${firstSessionId}"]`)).toBeNull()

    const lastSessionIds = sessionIds.slice(-PANEL_CAPACITY)
    for (const sessionId of lastSessionIds) {
      expect(rendered.container.querySelector(`[data-keepalive-panel="${sessionId}"]`)).not.toBeNull()
    }

    const secondSessionId = sessionIds[1]
    expect(rendered.container.querySelector(`[data-keepalive-panel="${secondSessionId}"]`)).toBeNull()

    rendered.unmount()
  })

  it('preserves inactive panel props with correct sessionShell and sessionHistory after switching away', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const secondFixture = {
      ...createPersistedHistoryFixture(),
      summary: {
        ...createPersistedHistoryFixture().summary,
        threadId: 'thread-2',
        title: '第二个历史线程',
      },
      detail: {
        ...createPersistedHistoryFixture().detail,
        thread: {
          ...createPersistedHistoryFixture().detail.thread,
          threadId: 'thread-2',
          title: '第二个历史线程',
        },
      },
    }
    secondFixture.replay = {
      ...secondFixture.replay,
      run: {
        ...secondFixture.replay.run,
        threadId: 'thread-2',
      },
    }

    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary, secondFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === 'thread-2' ? secondFixture.detail : historyFixture.detail
    ))
    const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === secondFixture.replay.run.runId) {
        return secondFixture.replay
      }
      return historyFixture.replay
    })

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_2))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    const panel1 = rendered.container.querySelector('[data-keepalive-panel="thread-1"]')
    expect(panel1).not.toBeNull()
    expect(panel1?.hasAttribute('hidden')).toBe(true)
    expect(panel1?.getAttribute(ARIA_HIDDEN)).toBe('true')

    const inactivePanelProps = findLast(
      mockCopilotChatPanel.mock.calls,
      ([props]) => (props as Record<string, unknown>).selectSessionHistoryRun === undefined
        && (props as Record<string, unknown>).sessionShell !== null
        && ((props as Record<string, unknown>).sessionShell as { sessionId?: string })?.sessionId === 'thread-1',
    )
    expect(inactivePanelProps).toBeDefined()
    const inactiveProps = inactivePanelProps![0] as Record<string, unknown>
    expect(inactiveProps.sessionShell).toBeDefined()
    expect((inactiveProps.sessionShell as { sessionId?: string }).sessionId).toBe('thread-1')
    expect(inactiveProps.sessionHistory).toBeDefined()
    expect((inactiveProps.sessionHistory as { detailStatus?: string }).detailStatus).toBe('ready')
    expect(inactiveProps.runtimeControllerBySessionId).toMatchObject({
      'thread-1': expect.objectContaining({
        composerDraft: expect.objectContaining({
          selectedModelId: MODEL_ID_GPT4_1,
          enabledTools: [TOOL_ID_REMOTE_SEARCH],
        }),
      }),
    })

    rendered.unmount()
  })

  it('restores persisted composer model thinking and tools after switching away and back across remount', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const secondFixture = {
      ...createPersistedHistoryFixture(),
      summary: {
        ...createPersistedHistoryFixture().summary,
        threadId: 'thread-2',
        title: '第二个历史线程',
      },
      detail: {
        ...createPersistedHistoryFixture().detail,
        thread: {
          ...createPersistedHistoryFixture().detail.thread,
          threadId: 'thread-2',
          title: '第二个历史线程',
        },
      },
    }
    secondFixture.replay = {
      ...secondFixture.replay,
      run: {
        ...secondFixture.replay.run,
        threadId: 'thread-2',
      },
    }

    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary, secondFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === 'thread-2' ? secondFixture.detail : historyFixture.detail
    ))
    const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === secondFixture.replay.run.runId) {
        return secondFixture.replay
      }
      return historyFixture.replay
    })

    const firstRender = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === historyFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    await waitForAssistantWorkspaceCondition(() => {
      const runtimeController = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId?.[historyFixture.summary.threadId]
      return runtimeController?.composerDraft?.selectedModelId === MODEL_ID_GPT4_1
        && runtimeController?.composerDraft?.thinkingSelection !== null
        && runtimeController?.composerDraft?.enabledTools?.includes(TOOL_ID_REMOTE_SEARCH) === true
    })

    await clickElement(firstRender.getByTestId(TEST_ID_SESSION_CARD_THREAD_2))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === secondFixture.summary.threadId
    ))

    const runtimeControllerBeforeRemount = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId?.[historyFixture.summary.threadId]
    expect(runtimeControllerBeforeRemount).toMatchObject({
      composerDraft: expect.objectContaining({
        selectedModelId: MODEL_ID_GPT4_1,
        thinkingSelection: expect.any(Object),
        enabledTools: [TOOL_ID_REMOTE_SEARCH],
      }),
    })

    firstRender.unmount()
    mockCopilotChatPanel.mockClear()

    const remounted = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === secondFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    await clickElement(remounted.getByTestId(TEST_ID_SESSION_CARD_THREAD_1))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === historyFixture.summary.threadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    await waitForAssistantWorkspaceCondition(() => {
      const runtimeController = getLastMockCopilotChatPanelProps().runtimeControllerBySessionId?.[historyFixture.summary.threadId]
      return runtimeController?.composerDraft?.selectedModelId === MODEL_ID_GPT4_1
        && runtimeController?.composerDraft?.thinkingSelection !== null
        && runtimeController?.composerDraft?.enabledTools?.includes(TOOL_ID_REMOTE_SEARCH) === true
    })

    remounted.unmount()
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

function createPersistedHistoryFixture() {
  const summary = {
    threadId: 'thread-1',
    boundAgentId: 'general',
    title: '历史线程',
    titleSource: 'deterministic',
    summary: '历史摘要',
    summarySource: 'deterministic',
    createdAt: '2026-04-13T15:00:00Z',
    updatedAt: '2026-04-13T15:05:00Z',
    lastActivityAt: '2026-04-13T15:05:00Z',
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
          updatedAt: '2026-04-13T15:05:00Z',
          startedAt: '2026-04-13T15:00:01Z',
          terminalAt: '2026-04-13T15:05:00Z',
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
        updatedAt: '2026-04-13T15:05:00Z',
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: '2026-04-13T15:05:00Z',
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

function createMultiRunPersistedHistoryFixture() {
  const summary = {
    threadId: 'thread-2',
    boundAgentId: 'general',
    title: '第二历史线程',
    titleSource: 'deterministic',
    summary: '第二线程摘要',
    summarySource: 'deterministic',
    createdAt: '2026-04-13T16:00:00Z',
    updatedAt: '2026-04-13T16:08:00Z',
    lastActivityAt: '2026-04-13T16:08:00Z',
    lastRunId: 'run-2b',
    lastRunStatus: 'completed',
    lastUserMessagePreview: '第二线程问题',
    lastAssistantMessagePreview: '第二线程新答案',
    driftSummary: {
      status: 'not_evaluated',
    },
  }

  const run2aReplay = {
    ok: true as const,
    version: CHAT_HISTORY_VERSION,
    run: {
      runId: 'run-2a',
      threadId: 'thread-2',
      status: 'completed',
      createdAt: '2026-04-13T16:00:00Z',
      updatedAt: '2026-04-13T16:03:00Z',
      startedAt: '2026-04-13T16:00:01Z',
      terminalAt: '2026-04-13T16:03:00Z',
      resolvedModelId: 'openai/gpt-4.1-mini',
      requestedMessageText: '旧问题',
      assistantText: '旧答案',
    },
    historicalSnapshot: {
      resolvedModelId: 'openai/gpt-4.1-mini',
      resolvedToolIds: [TOOL_ID_REMOTE_SEARCH],
    },
    orderedEvents: [],
    toolCallBlocks: [],
    diagnosticBlocks: [],
    terminalState: null,
    availabilityInterpretation: {
      status: 'not_evaluated',
    },
  }
  const run2bReplay = {
    ok: true as const,
    version: CHAT_HISTORY_VERSION,
    run: {
      runId: 'run-2b',
      threadId: 'thread-2',
      status: 'completed',
      createdAt: '2026-04-13T16:05:00Z',
      updatedAt: '2026-04-13T16:08:00Z',
      startedAt: '2026-04-13T16:05:01Z',
      terminalAt: '2026-04-13T16:08:00Z',
      resolvedModelId: MODEL_ID_GPT4_1,
      requestedMessageText: '第二线程问题',
      assistantText: '第二线程新答案',
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
          runId: 'run-2a',
          sequenceStart: 0,
          text: '旧问题',
        },
        {
          kind: 'assistant_message',
          runId: 'run-2a',
          sequenceStart: 1,
          text: '旧答案',
        },
        {
          kind: 'user_message',
          runId: 'run-2b',
          sequenceStart: 2,
          text: '第二线程问题',
        },
        {
          kind: 'assistant_message',
          runId: 'run-2b',
          sequenceStart: 3,
          text: '第二线程新答案',
        },
      ],
      runSummaries: [
        {
          runId: 'run-2a',
          threadId: 'thread-2',
          status: 'completed',
          createdAt: '2026-04-13T16:00:00Z',
          updatedAt: '2026-04-13T16:03:00Z',
          startedAt: '2026-04-13T16:00:01Z',
          terminalAt: '2026-04-13T16:03:00Z',
          resolvedModelId: 'openai/gpt-4.1-mini',
          requestedMessageText: '旧问题',
          assistantText: '旧答案',
        },
        {
          runId: 'run-2b',
          threadId: 'thread-2',
          status: 'completed',
          createdAt: '2026-04-13T16:05:00Z',
          updatedAt: '2026-04-13T16:08:00Z',
          startedAt: '2026-04-13T16:05:01Z',
          terminalAt: '2026-04-13T16:08:00Z',
          resolvedModelId: MODEL_ID_GPT4_1,
          requestedMessageText: '第二线程问题',
          assistantText: '第二线程新答案',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-2b',
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
    replay: run2bReplay,
    replaysByRunId: {
      'run-2a': run2aReplay,
      'run-2b': run2bReplay,
    },
  }
}

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
