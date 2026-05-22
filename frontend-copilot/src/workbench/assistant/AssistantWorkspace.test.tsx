/** @vitest-environment jsdom */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
  inputText,
  keyDownElement,
  openContextMenu,
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
import { runCreateSessionPendingScenario } from './test-support/assistant-workspace-creation-scenarios'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'
import { runSessionContextMenuScenario } from './test-support/assistant-workspace-session-scenarios'
// ── Test fixture constants (extracted for sonarjs/no-duplicate-string) ──

const CHAT_HISTORY_VERSION = 'chat-history-v1'

// Thread / run IDs
const THREAD_ID_LIVE = 'thread-live'
const RUN_ID_LIVE_1 = 'run-live-1'

// Tool and model identifiers
const TOOL_ID_REMOTE_SEARCH = 'tool.remote-search'
const MODEL_ID_GPT4_1 = 'openai/gpt-4.1'

// Test IDs (data-testid values)
const TEST_ID_SESSION_CARD_THREAD_1 = 'assistant-session-card-thread-1'
const TEST_ID_CREATE_SESSION_BUTTON = 'assistant-create-session-button'

// Error messages
const ERROR_SEEDED_AGENT_DIRECTORY = 'Expected seeded agent directory.'

// Timestamps
const TS_2026_04_13T15_05_00Z = '2026-04-13T15:05:00Z'
const TS_2026_04_14T08_00_00Z = '2026-04-14T08:00:00Z'
const TS_2026_04_14T08_03_00Z = '2026-04-14T08:03:00Z'


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

describe('AssistantWorkspace render + interactions', () => {
  it('renders backend directory agents and passes capability-backed session shell state into CopilotChatPanel', () => {
    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const selectedAgent = directoryState.agents[0]

    if (!selectedAgent) {
      throw new Error(ERROR_SEEDED_AGENT_DIRECTORY)
    }

    const sessionShell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })

    const html = renderToStaticMarkup(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        initialDirectoryState={directoryState}
        initialSessionShell={sessionShell}
      />,
    )

    expect(html).toContain('后端智能体目录')
    expect(html).toContain('通用智能体')
    expect(html).not.toContain('默认使用所有工具')
    expect(html).not.toContain('Minimal default agent exposed by the Copilot runtime run bridge.')
    expect(html).toContain('Blackboard')
    expect(html).not.toContain('当前会话')
    expect(html).not.toContain('已创建')
    expect(html).not.toContain('<span>session-1</span>')
    expect(html).not.toContain('当前入口语义')
    expect(html).not.toContain('当前会话绑定')
    expect(html).toContain('data-testid="assistant-chat-workspace"')
    expect(html).toContain('workspace-main workspace-main--chat')
    expect(html).not.toContain('workspace-chat-shell')
    expect(mockCopilotChatPanel).toHaveBeenCalled()
    expect(mockCopilotChatPanel.mock.calls[0]?.[0]).toMatchObject({
      selectedAgent: expect.objectContaining({ id: 'general' }),
      sessionShell: expect.objectContaining({
        sessionId: 'session-1',
        capabilities: expect.objectContaining({
          capabilitiesVersion: 'cap-v12',
          recommendedToolsForAgent: ['tool.fs.read'],
        }),
      }),
      directoryState: expect.objectContaining({
        directoryVersion: 'agents-v1',
      }),
    })
  })

  it('keeps the create-session button label stable while creation is pending', async () => {
    await runCreateSessionPendingScenario()
  })

  it('opens a session context menu with only implemented session actions on right click', async () => {
    await runSessionContextMenuScenario()
  })

  it('persists renamed thread titles across remount for restored history threads', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const renamedSummary = {
      ...historyFixture.summary,
      title: '重命名后的历史线程',
      titleSource: 'manual',
      updatedAt: '2026-04-13T15:06:00Z',
      lastActivityAt: '2026-04-13T15:06:00Z',
    }
    const renamedDetail = {
      ...historyFixture.detail,
      thread: {
        ...renamedSummary,
      },
    }
    let currentSummary = historyFixture.summary
    let currentDetail = historyFixture.detail
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [currentSummary],
    }))
    const getHistoryThreadDetail = vi.fn().mockImplementation(async () => currentDetail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const renameHistoryThread = vi.fn().mockImplementation(async () => {
      currentSummary = renamedSummary
      currentDetail = renamedDetail
      return {
        ok: true as const,
        version: CHAT_HISTORY_VERSION,
        thread: renamedSummary,
      }
    })

    const firstRender = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        renameHistoryThread={renameHistoryThread}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await openContextMenu(firstRender.getByTestId(TEST_ID_SESSION_CARD_THREAD_1), 180, 120)
    await clickElement(firstRender.getByTestId('assistant-session-context-action-rename'))

    const renameInput = firstRender.getByTestId('assistant-session-rename-input-thread-1') as HTMLInputElement
    await inputText(renameInput, renamedSummary.title)
    await keyDownElement(renameInput, 'Enter')

    await waitForAssistantWorkspaceCondition(() => (
      (firstRender.getByTestId(TEST_ID_SESSION_CARD_THREAD_1).textContent ?? '').includes(renamedSummary.title)
    ))

    expect(renameHistoryThread).toHaveBeenCalledWith('thread-1', { title: renamedSummary.title })
    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: 'thread-1',
      threadSummaries: expect.arrayContaining([
        expect.objectContaining({
          threadId: 'thread-1',
          title: renamedSummary.title,
        }),
      ]),
    })

    const historyListCallCountBeforeRemount = listHistoryThreads.mock.calls.length
    firstRender.unmount()
    mockCopilotChatPanel.mockClear()

    const remounted = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        renameHistoryThread={renameHistoryThread}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length > historyListCallCountBeforeRemount)
    await waitForAssistantWorkspaceCondition(() => (
      (remounted.getByTestId(TEST_ID_SESSION_CARD_THREAD_1).textContent ?? '').includes(renamedSummary.title)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    remounted.unmount()
  })

  it('creates history state for a new live session and refreshes persisted detail after run settlement', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const liveFixture = createLivePersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let includePersistedLiveSession = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: THREAD_ID_LIVE,
      createdAt: TS_2026_04_14T08_00_00Z,
      updatedAt: TS_2026_04_14T08_00_00Z,
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: THREAD_ID_LIVE,
    }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(liveFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(liveFixture.replay)

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

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 1)
    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
    ))

    expect(getHistoryThreadDetail).not.toHaveBeenCalled()
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: THREAD_ID_LIVE,
      }),
      sessionHistory: expect.objectContaining({
        isPersistedThread: false,
      }),
      runtimeControllerBySessionId: expect.objectContaining({
        [THREAD_ID_LIVE]: expect.objectContaining({
          runState: expect.objectContaining({
            phase: 'idle',
          }),
          composerDraft: expect.objectContaining({
            messageText: '',
          }),
        }),
      }),
    })

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.(RUN_ID_LIVE_1, THREAD_ID_LIVE)
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === THREAD_ID_LIVE)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === RUN_ID_LIVE_1)
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledWith(THREAD_ID_LIVE)
    expect(getHistoryRunReplay).toHaveBeenCalledWith(RUN_ID_LIVE_1)
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'idle',
        selectedRunId: null,
      }),
    })

    rendered.unmount()
  })

  it('restores a newly persisted live thread after remounting the workspace', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const liveFixture = createLivePersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let includePersistedLiveSession = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: THREAD_ID_LIVE,
      createdAt: TS_2026_04_14T08_00_00Z,
      updatedAt: TS_2026_04_14T08_00_00Z,
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: THREAD_ID_LIVE,
      capabilitiesVersion: 'cap-thread-live',
    }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(liveFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(liveFixture.replay)

    const firstRender = renderWithRoot(
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

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 1)
    await clickElement(firstRender.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
    ))

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.(RUN_ID_LIVE_1, THREAD_ID_LIVE)
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === THREAD_ID_LIVE)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === RUN_ID_LIVE_1)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    const historyListCallCountBeforeRemount = listHistoryThreads.mock.calls.length
    const detailCallCountBeforeRemount = getHistoryThreadDetail.mock.calls.length
    const replayCallCountBeforeRemount = getHistoryRunReplay.mock.calls.length
    firstRender.unmount()

    mockCopilotChatPanel.mockClear()

    const remounted = renderWithRoot(
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

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length > historyListCallCountBeforeRemount)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
    ))
    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length > detailCallCountBeforeRemount)

    expect(remounted.getByTestId('assistant-session-card-thread-live').textContent).toContain('新建后落库线程')
    expect(getHistoryRunReplay.mock.calls.length).toBe(replayCallCountBeforeRemount)
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: THREAD_ID_LIVE,
      }),
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'idle',
        selectedRunId: null,
      }),
    })

    remounted.unmount()
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

function createLivePersistedHistoryFixture() {
  const summary = {
    threadId: THREAD_ID_LIVE,
    boundAgentId: 'general',
    title: '新建后落库线程',
    titleSource: 'deterministic',
    summary: '最新成功摘要',
    summarySource: 'deterministic',
    createdAt: TS_2026_04_14T08_00_00Z,
    updatedAt: TS_2026_04_14T08_03_00Z,
    lastActivityAt: TS_2026_04_14T08_03_00Z,
    lastRunId: RUN_ID_LIVE_1,
    lastRunStatus: 'completed',
    lastUserMessagePreview: '最新问题',
    lastAssistantMessagePreview: '最新成功摘要',
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
          runId: RUN_ID_LIVE_1,
          sequenceStart: 0,
          text: '最新问题',
        },
        {
          kind: 'assistant_message',
          runId: RUN_ID_LIVE_1,
          sequenceStart: 1,
          text: '最新成功摘要',
        },
      ],
      runSummaries: [
        {
          runId: RUN_ID_LIVE_1,
          threadId: THREAD_ID_LIVE,
          status: 'completed',
          createdAt: TS_2026_04_14T08_00_00Z,
          updatedAt: TS_2026_04_14T08_03_00Z,
          startedAt: '2026-04-14T08:00:01Z',
          terminalAt: TS_2026_04_14T08_03_00Z,
          resolvedModelId: MODEL_ID_GPT4_1,
          requestedMessageText: '最新问题',
          assistantText: '最新成功摘要',
        },
      ],
      latestConfigurationSnapshot: {
        runId: RUN_ID_LIVE_1,
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
        runId: RUN_ID_LIVE_1,
        threadId: THREAD_ID_LIVE,
        status: 'completed',
        createdAt: TS_2026_04_14T08_00_00Z,
        updatedAt: TS_2026_04_14T08_03_00Z,
        startedAt: '2026-04-14T08:00:01Z',
        terminalAt: TS_2026_04_14T08_03_00Z,
        resolvedModelId: MODEL_ID_GPT4_1,
        requestedMessageText: '最新问题',
        assistantText: '最新成功摘要',
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
  }
  pendingHistorySyncRunId?: string | null
  activeAbortController?: AbortController | null
  lastAccessedAt?: number
  [key: string]: unknown
}>

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

async function waitForAssistantWorkspaceCondition(predicate: () => boolean, attempts = 16) {
  for (let index = 0; index < attempts; index += 1) {
    await flushAssistantWorkspaceEffects()
    if (predicate()) {
      return
    }
  }

  expect(predicate()).toBe(true)
}
