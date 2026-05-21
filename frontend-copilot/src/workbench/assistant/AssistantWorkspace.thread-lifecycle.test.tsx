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
  inputText,
  keyDownElement,
  openContextMenu,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import { createAssistantAgentDirectoryState } from './assistant-workspace-controller'
import {
  createRuntimeModelRoute,
  createRuntimeThinkingSelection,
} from '../../features/copilot/thread-run-contract.test-support'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'
import type { McpRegistrySubscriptionEvent } from '../../../electron/mcp-registry/types'

const CHAT_HISTORY_VERSION = 'chat-history-v1'
const THREAD_ID_LIVE = 'thread-live'
const THREAD_ID_NEW = 'thread-new'
const RUN_ID_LIVE_1 = 'run-live-1'
const TOOL_ID_REMOTE_SEARCH = 'tool.remote-search'
const MODEL_ID_GPT4_1 = 'openai/gpt-4.1'
const CAP_VERSION_THREAD_LIVE_V1 = 'cap-thread-live-v1'
const TEST_ID_SESSION_CARD_THREAD_1 = 'assistant-session-card-thread-1'
const TEST_ID_SESSION_CARD_THREAD_2 = 'assistant-session-card-thread-2'
const TEST_ID_CREATE_SESSION_BUTTON = 'assistant-create-session-button'
const TS_2026_04_13T15_05_00Z = '2026-04-13T15:05:00Z'
const TS_2026_04_13T15_06_30Z = '2026-04-13T15:06:30Z'
const TS_2026_04_13T16_00_00Z = '2026-04-13T16:00:00Z'
const TS_2026_04_13T16_03_00Z = '2026-04-13T16:03:00Z'
const TS_2026_04_13T16_08_00Z = '2026-04-13T16:08:00Z'
const TS_2026_04_14T08_00_00Z = '2026-04-14T08:00:00Z'
const TS_2026_04_14T08_03_00Z = '2026-04-14T08:03:00Z'
const TS_2026_04_14T08_05_00Z = '2026-04-14T08:05:00Z'
const ERROR_SEEDED_AGENT_DIRECTORY = 'Expected seeded agent directory.'

const mockCopilotChatPanel = vi.fn((props: Record<string, unknown>) => (
  <div
    data-testid="mock-copilot-chat-panel"
    data-selected-agent={String(props.selectedAgent ? (props.selectedAgent as { id: string }).id : '')}
    data-session-id={String(props.sessionShell ? (props.sessionShell as { sessionId: string }).sessionId : '')}
  >
    chat-shell
  </div>
))

let activeMcpRegistryListener: ((event: McpRegistrySubscriptionEvent) => void) | null = null
let mcpRegistryUnsubscribeMock = vi.fn()

vi.mock('../../features/copilot/CopilotChatPanel', () => ({
  CopilotChatPanel: (props: Record<string, unknown>) => mockCopilotChatPanel(props),
}))

afterEach(() => {
  window.localStorage.removeItem(ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY)
  activeMcpRegistryListener = null
  mcpRegistryUnsubscribeMock = vi.fn()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('AssistantWorkspace thread lifecycle', () => {
  it('hides permanently deleted threads immediately and keeps them absent on remount', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let isDeleted = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: isDeleted ? [] : [historyFixture.summary],
    }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const deleteHistoryThread = vi.fn().mockImplementation(async () => {
      isDeleted = true
      return {
        ok: true as const,
        threadId: historyFixture.summary.threadId,
        deletedAt: TS_2026_04_13T15_06_30Z,
      }
    })

    const firstRender = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        deleteHistoryThread={deleteHistoryThread}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await openContextMenu(firstRender.getByTestId(TEST_ID_SESSION_CARD_THREAD_1), 220, 140)
    await clickElement(firstRender.getByTestId('assistant-session-context-action-delete'))
    await clickElement(firstRender.getByTestId('assistant-session-context-action-delete-confirm'))

    await waitForAssistantWorkspaceCondition(() => firstRender.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1) === null)

    expect(deleteHistoryThread).toHaveBeenCalledWith('thread-1')
    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
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
        deleteHistoryThread={deleteHistoryThread}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length > historyListCallCountBeforeRemount)
    await waitForAssistantWorkspaceCondition(() => (
      (remounted.getByTestId('mock-copilot-chat-panel') as HTMLDivElement).dataset.sessionId === ''
    ))

    expect(remounted.queryByTestId(TEST_ID_SESSION_CARD_THREAD_1)).toBeNull()

    remounted.unmount()
  })

  it('ignores array-shaped persisted shell records when restoring local storage state', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const malformedStoredState = {
      selectedThreadId: historyFixture.summary.threadId,
      selectedRunIdByThreadId: [],
      threadSummaries: [
        {
          ...historyFixture.summary,
          driftSummary: [],
        },
      ],
    }

    window.localStorage.setItem(
      ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY,
      JSON.stringify(malformedStoredState),
    )

    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

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
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === historyFixture.summary.threadId
    ))

    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: historyFixture.summary.threadId,
      selectedRunIdByThreadId: {},
      threadSummaries: [
        expect.objectContaining({
          threadId: historyFixture.summary.threadId,
          driftSummary: expect.objectContaining({
            status: 'not_evaluated',
          }),
        }),
      ],
    })

    rendered.unmount()
  })

  it('duplicates persisted threads into a new conversation with copied history ready for replay', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const duplicatedRunId = 'run-1-copy'
    const duplicatedThreadId = 'thread-1-copy'
    const duplicatedSummary = {
      ...historyFixture.summary,
      threadId: duplicatedThreadId,
      title: '历史线程（副本）',
      titleSource: 'manual',
      createdAt: TS_2026_04_13T15_06_30Z,
      updatedAt: TS_2026_04_13T15_06_30Z,
      lastActivityAt: TS_2026_04_13T15_06_30Z,
      lastRunId: duplicatedRunId,
    }
    const duplicatedRunSummary = {
      ...historyFixture.detail.runSummaries[0]!,
      runId: duplicatedRunId,
      threadId: duplicatedThreadId,
    }
    const duplicatedDetail = {
      ...historyFixture.detail,
      thread: {
        ...duplicatedSummary,
      },
      timelineItems: historyFixture.detail.timelineItems.map((item) => ({
        ...item,
        runId: duplicatedRunId,
      })),
      runSummaries: [duplicatedRunSummary],
      latestConfigurationSnapshot: {
        ...historyFixture.detail.latestConfigurationSnapshot!,
        runId: duplicatedRunId,
      },
    }
    const duplicatedReplay = {
      ...historyFixture.replay,
      run: {
        ...historyFixture.replay.run,
        runId: duplicatedRunId,
        threadId: duplicatedThreadId,
      },
    }
    let threadSummaries = [historyFixture.summary]
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({
      sessionId,
      capabilitiesVersion: `cap-${sessionId}`,
    }))
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: CHAT_HISTORY_VERSION,
      threads: threadSummaries,
    }))
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === duplicatedThreadId ? duplicatedDetail : historyFixture.detail
    ))
    const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => (
      runId === duplicatedRunId ? duplicatedReplay : historyFixture.replay
    ))
    const duplicateHistoryThread = vi.fn().mockImplementation(async () => {
      threadSummaries = [duplicatedSummary, ...threadSummaries]
      return {
        ok: true as const,
        version: CHAT_HISTORY_VERSION,
        thread: duplicatedSummary,
      }
    })

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getCapabilities={getCapabilities}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        duplicateHistoryThread={duplicateHistoryThread}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await openContextMenu(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1), 260, 160)
    await clickElement(rendered.getByTestId('assistant-session-context-action-copy-session'))

    await waitForAssistantWorkspaceCondition(() => duplicateHistoryThread.mock.calls.length === 1)
    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId(`assistant-session-card-${duplicatedThreadId}`) !== null)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === duplicatedThreadId
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(duplicateHistoryThread).toHaveBeenCalledWith('thread-1')
    expect(getCapabilities.mock.calls.some(([input]) => input.sessionId === duplicatedThreadId)).toBe(true)
    expect((rendered.getByTestId(`assistant-session-card-${duplicatedThreadId}`) as HTMLButtonElement).textContent).toContain(duplicatedSummary.title)
    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: duplicatedThreadId,
      threadSummaries: expect.arrayContaining([
        expect.objectContaining({
          threadId: duplicatedThreadId,
          title: duplicatedSummary.title,
        }),
      ]),
    })

    await act(async () => {
      getLastMockCopilotChatPanelProps().selectSessionHistoryRun?.(duplicatedRunId)
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === duplicatedRunId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === duplicatedRunId
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    rendered.unmount()
  })

  it('restores persisted thread shells on startup and lazily loads detail plus replay for the active thread', async () => {
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
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

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

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length === 1)
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === historyFixture.summary.threadId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(listHistoryThreads).toHaveBeenCalledOnce()
    expect(getHistoryThreadDetail).toHaveBeenCalledWith(historyFixture.summary.threadId)
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1).textContent).toContain('历史线程')

    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: 'thread-1',
        capabilities: expect.objectContaining({
          capabilitiesVersion: 'history-shell',
        }),
      }),
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'idle',
        selectedRunId: null,
      }),
    })

    rendered.unmount()
  })

  it('does not restart restored thread capability hydration when detail loading starts concurrently', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const pendingCapabilities = createDeferred<ReturnType<typeof createCapabilitiesResponse>>()
    const pendingDetail = createDeferred<typeof historyFixture.detail>()
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [historyFixture.summary],
    })
    const getCapabilities = vi.fn().mockImplementation(() => pendingCapabilities.promise)
    const getHistoryThreadDetail = vi.fn().mockImplementation(() => pendingDetail.promise)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

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
      getCapabilities.mock.calls.length >= 1
      && getHistoryThreadDetail.mock.calls.length >= 1
    ))
    await flushAssistantWorkspaceEffects()

    expect(getCapabilities).toHaveBeenCalledTimes(1)
    expect(getLastMockCopilotChatPanelProps().sessionHistory).toMatchObject({
      detailStatus: 'loading',
      capabilitiesStatus: 'loading',
    })

    rendered.unmount()
  })

  it('reloads live session capabilities after an MCP snapshot event and applies the same snapshot round tool update to chat picker state', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: THREAD_ID_LIVE,
      createdAt: TS_2026_04_14T08_00_00Z,
      updatedAt: TS_2026_04_14T08_00_00Z,
    }))
    const getCapabilities = vi.fn()
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: THREAD_ID_LIVE,
        capabilitiesVersion: CAP_VERSION_THREAD_LIVE_V1,
        tools: [
          { toolId: TOOL_ID_REMOTE_SEARCH, kind: 'builtin', availability: 'available', displayName: '联网搜索', description: '初始目录' },
        ],
      }))
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: THREAD_ID_LIVE,
        capabilitiesVersion: CAP_VERSION_THREAD_LIVE_V1,
        tools: [
          { toolId: 'mcp__filesystem__read_text_file', kind: 'external', availability: 'available', displayName: '读取文本文件', description: '同轮目录变化' },
        ],
      }))
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: THREAD_ID_LIVE,
        capabilitiesVersion: 'cap-thread-live-v2',
        tools: [
          { toolId: 'mcp__filesystem__read_text_file', kind: 'external', availability: 'available', displayName: '读取文本文件', description: '最新目录' },
        ],
      }))

    Object.defineProperty(window, 'mcpRegistrySubscription', {
      configurable: true,
      writable: true,
      value: {
        subscribe: (listener: (event: McpRegistrySubscriptionEvent) => void) => {
          activeMcpRegistryListener = listener
          return mcpRegistryUnsubscribeMock.mockImplementation(() => {
            if (activeMcpRegistryListener === listener) {
              activeMcpRegistryListener = null
            }
          })
        },
      },
    })

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
    await waitForAssistantWorkspaceCondition(() => {
      const sessionShell = getLastMockCopilotChatPanelProps().sessionShell as {
        sessionId?: string
        capabilities?: {
          capabilitiesVersion?: string
        }
      } | undefined

      return sessionShell?.sessionId === THREAD_ID_LIVE
        && sessionShell.capabilities?.capabilitiesVersion === CAP_VERSION_THREAD_LIVE_V1
    })

    await act(async () => {
      activeMcpRegistryListener?.({
        kind: 'snapshot',
        registryRevision: 8,
        snapshotRevision: 12,
        servers: [],
        states: [],
      })
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => getCapabilities.mock.calls.length >= 2)

    expect(getLastMockCopilotChatPanelProps().sessionShell as {
      capabilities?: {
        capabilitiesVersion?: string
        allAvailableTools?: Array<{ toolId?: string, description?: string }>
      }
    }).toMatchObject({
      capabilities: {
        capabilitiesVersion: CAP_VERSION_THREAD_LIVE_V1,
        allAvailableTools: [
          expect.objectContaining({ toolId: 'mcp__filesystem__read_text_file', description: '同轮目录变化' }),
        ],
      },
    })

    await act(async () => {
      activeMcpRegistryListener?.({
        kind: 'snapshot',
        registryRevision: 9,
        snapshotRevision: 13,
        servers: [],
        states: [],
      })
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => {
      const sessionShell = getLastMockCopilotChatPanelProps().sessionShell as {
        sessionId?: string
        capabilities?: {
          capabilitiesVersion?: string
          allAvailableTools?: Array<{ toolId?: string }>
        }
      } | undefined

      return sessionShell?.sessionId === THREAD_ID_LIVE
        && sessionShell.capabilities?.capabilitiesVersion === 'cap-thread-live-v2'
        && sessionShell.capabilities.allAvailableTools?.some((tool) => tool.toolId === 'mcp__filesystem__read_text_file') === true
    })

    expect(getCapabilities).toHaveBeenCalledTimes(3)
    expect(mcpRegistryUnsubscribeMock).not.toHaveBeenCalled()
    expect(getLastMockCopilotChatPanelProps().sessionShell as {
      capabilities?: {
        capabilitiesVersion?: string
        allAvailableTools?: unknown[]
      }
    }).toMatchObject({
      capabilities: {
        capabilitiesVersion: 'cap-thread-live-v2',
        allAvailableTools: [
          expect.objectContaining({ toolId: 'mcp__filesystem__read_text_file' }),
        ],
      },
    })

    rendered.unmount()
    expect(mcpRegistryUnsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a single MCP registry subscription while reading the latest session list for snapshot refreshes', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const createSession = vi.fn()
      .mockResolvedValueOnce(createSessionResponse({
        threadId: THREAD_ID_LIVE,
        createdAt: TS_2026_04_14T08_00_00Z,
        updatedAt: TS_2026_04_14T08_00_00Z,
      }))
      .mockResolvedValueOnce(createSessionResponse({
        threadId: THREAD_ID_NEW,
        createdAt: TS_2026_04_14T08_05_00Z,
        updatedAt: TS_2026_04_14T08_05_00Z,
      }))
    const getCapabilities = vi.fn()
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: THREAD_ID_LIVE,
        capabilitiesVersion: CAP_VERSION_THREAD_LIVE_V1,
      }))
      .mockResolvedValueOnce(createCapabilitiesResponse({
        sessionId: THREAD_ID_NEW,
        capabilitiesVersion: 'cap-thread-new-v1',
      }))
      .mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({
        sessionId,
        capabilitiesVersion: `cap-refresh-${sessionId}`,
        tools: [{
          toolId: `${sessionId}.tool`,
          kind: 'external',
          availability: 'available',
          displayName: `${sessionId} tool`,
          description: `${sessionId} tool from snapshot refresh`,
        }],
      }))
    const subscribe = vi.fn((listener: (event: McpRegistrySubscriptionEvent) => void) => {
      activeMcpRegistryListener = listener
      return mcpRegistryUnsubscribeMock.mockImplementation(() => {
        if (activeMcpRegistryListener === listener) {
          activeMcpRegistryListener = null
        }
      })
    })

    Object.defineProperty(window, 'mcpRegistrySubscription', {
      configurable: true,
      writable: true,
      value: { subscribe },
    })

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
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
    ))

    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_NEW
    ))

    await act(async () => {
      activeMcpRegistryListener?.({
        kind: 'snapshot',
        registryRevision: 10,
        snapshotRevision: 14,
        servers: [],
        states: [],
      })
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => getCapabilities.mock.calls.length >= 4)

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(mcpRegistryUnsubscribeMock).not.toHaveBeenCalled()
    expect(getCapabilities).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionId: THREAD_ID_LIVE,
    })
    expect(getCapabilities).toHaveBeenCalledWith({
      runtimeUrl: 'http://127.0.0.1:8765',
      sessionId: THREAD_ID_NEW,
    })
    expect(getLastMockCopilotChatPanelProps().sessionShell as {
      sessionId?: string
      capabilities?: {
        capabilitiesVersion?: string
        allAvailableTools?: Array<{ toolId?: string }>
      }
    }).toMatchObject({
      sessionId: THREAD_ID_NEW,
      capabilities: {
        capabilitiesVersion: 'cap-refresh-thread-new',
        allAvailableTools: [
          expect.objectContaining({ toolId: 'thread-new.tool' }),
        ],
      },
    })

    rendered.unmount()
    expect(mcpRegistryUnsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('keeps a late-settling run bound to its original session after switching to a newer live session', async () => {
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
    const createSession = vi.fn()
      .mockResolvedValueOnce(createSessionResponse({
        threadId: THREAD_ID_LIVE,
        createdAt: TS_2026_04_14T08_00_00Z,
        updatedAt: TS_2026_04_14T08_00_00Z,
      }))
      .mockResolvedValueOnce(createSessionResponse({
        threadId: THREAD_ID_NEW,
        createdAt: TS_2026_04_14T08_05_00Z,
        updatedAt: TS_2026_04_14T08_05_00Z,
      }))
    const getCapabilities = vi.fn().mockImplementation(async ({ sessionId }: { sessionId: string }) => createCapabilitiesResponse({
      sessionId,
      capabilitiesVersion: `cap-${sessionId}`,
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

    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_NEW
    ))

    expect(getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null).toBeNull()
    expect(getLastMockCopilotChatPanelProps().runtimeControllerBySessionId).toEqual(expect.objectContaining({
      [THREAD_ID_LIVE]: expect.any(Object),
      [THREAD_ID_NEW]: expect.any(Object),
    }))

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.(RUN_ID_LIVE_1, THREAD_ID_LIVE)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_NEW
    ))

    expect(getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null).toBeNull()
    expect(getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === THREAD_ID_LIVE)).toBe(false)
    expect(getHistoryRunReplay.mock.calls.some(([runId]) => runId === RUN_ID_LIVE_1)).toBe(false)
    expect(getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === THREAD_ID_NEW)).toBe(false)

    await clickElement(rendered.getByTestId('assistant-session-card-thread-live'))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === THREAD_ID_LIVE)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === RUN_ID_LIVE_1)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await clickElement(rendered.getByTestId('assistant-session-card-thread-new'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_NEW
    ))
    expect(getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null).toBeNull()

    rendered.unmount()
  })

  it('does not persist selectedRunIdByThreadId for a live thread before persisted detail is ready', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const liveFixture = createLivePersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const includePersistedLiveSession = false
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

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        createSession={createSession}
        getCapabilities={getCapabilities}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 1)
    await clickElement(rendered.getByTestId(TEST_ID_CREATE_SESSION_BUTTON))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === THREAD_ID_LIVE
    ))

    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.(RUN_ID_LIVE_1, THREAD_ID_LIVE)
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)

    expect(readPersistedAssistantWorkspaceShellState()).toEqual({
      selectedThreadId: THREAD_ID_LIVE,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })

    rendered.unmount()
  })

  it('keeps multiple restored threads visible and loads replay for the selected run of the active thread', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const firstFixture = createPersistedHistoryFixture()
    const secondFixture = createMultiRunPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [firstFixture.summary, secondFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === secondFixture.summary.threadId ? secondFixture.detail : firstFixture.detail
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
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === firstFixture.summary.threadId)
    ))

    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1).textContent).toContain('历史线程')
    expect(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_2).textContent).toContain('第二历史线程')

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_2))

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === secondFixture.summary.threadId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await act(async () => {
      getLastMockCopilotChatPanelProps().selectSessionHistoryRun?.('run-2a')
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === 'run-2a')
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === 'run-2a'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_1))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-1'
    ))

    rendered.unmount()
  })

  it('does not restore selectedRunIdByThreadId as the default view for a multi-run thread after remounting the workspace', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const firstFixture = createPersistedHistoryFixture()
    const secondFixture = createMultiRunPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [firstFixture.summary, secondFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === secondFixture.summary.threadId ? secondFixture.detail : firstFixture.detail
    ))
    const getHistoryRunReplay = vi.fn().mockImplementation(async (runId: string) => {
      if (runId === firstFixture.replay.run.runId) {
        return firstFixture.replay
      }

      return secondFixture.replaysByRunId[runId as keyof typeof secondFixture.replaysByRunId]
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
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === firstFixture.summary.threadId)
    ))

    expect(getHistoryRunReplay).not.toHaveBeenCalled()

    await clickElement(firstRender.getByTestId(TEST_ID_SESSION_CARD_THREAD_2))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === secondFixture.summary.threadId)
    ))

    await act(async () => {
      getLastMockCopilotChatPanelProps().selectSessionHistoryRun?.('run-2a')
    })

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === 'run-2a'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: 'thread-2',
      selectedRunIdByThreadId: {
        'thread-2': 'run-2a',
      },
      threadSummaries: expect.arrayContaining([
        expect.objectContaining({
          threadId: 'thread-1',
        }),
        expect.objectContaining({
          threadId: 'thread-2',
        }),
      ]),
    })

    const historyListCallCountBeforeRemount = listHistoryThreads.mock.calls.length
    const replayCallCountBeforeRemount = getHistoryRunReplay.mock.calls.length
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

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length > historyListCallCountBeforeRemount)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'idle'
    ))

    expect(getHistoryRunReplay.mock.calls.slice(replayCallCountBeforeRemount).some(([runId]) => runId === 'run-2a')).toBe(false)
    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: 'thread-2',
      selectedRunIdByThreadId: {},
    })

    remounted.unmount()
  })

  it('clears a restored active thread back to the default thread view when history restore reapplies summaries', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const firstFixture = createPersistedHistoryFixture()
    const secondFixture = createMultiRunPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    const listHistoryThreads = vi.fn().mockResolvedValue({
      ok: true,
      version: CHAT_HISTORY_VERSION,
      threads: [firstFixture.summary, secondFixture.summary],
    })
    const getHistoryThreadDetail = vi.fn().mockImplementation(async (threadId: string) => (
      threadId === secondFixture.summary.threadId ? secondFixture.detail : firstFixture.detail
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
        listAgents={listAgents}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === firstFixture.summary.threadId)
    ))

    await clickElement(rendered.getByTestId(TEST_ID_SESSION_CARD_THREAD_2))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === secondFixture.summary.threadId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await act(async () => {
      getLastMockCopilotChatPanelProps().selectSessionHistoryRun?.('run-2a')
    })

    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId === 'run-2a'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    const replayCallCountBeforeRestore = getHistoryRunReplay.mock.calls.length
    const detailCallCountBeforeRestore = getHistoryThreadDetail.mock.calls.length

    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-2a', 'thread-2')
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => (
      listHistoryThreads.mock.calls.length >= 2
      && getHistoryThreadDetail.mock.calls.length > detailCallCountBeforeRestore
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'idle'
    ))

    expect(getHistoryRunReplay.mock.calls.length).toBe(replayCallCountBeforeRestore)
    expect(readPersistedAssistantWorkspaceShellState()).toMatchObject({
      selectedThreadId: 'thread-2',
      selectedRunIdByThreadId: {},
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

function createMultiRunPersistedHistoryFixture() {
  const summary = {
    threadId: 'thread-2',
    boundAgentId: 'general',
    title: '第二历史线程',
    titleSource: 'deterministic',
    summary: '第二线程摘要',
    summarySource: 'deterministic',
    createdAt: TS_2026_04_13T16_00_00Z,
    updatedAt: TS_2026_04_13T16_08_00Z,
    lastActivityAt: TS_2026_04_13T16_08_00Z,
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
      createdAt: TS_2026_04_13T16_00_00Z,
      updatedAt: TS_2026_04_13T16_03_00Z,
      startedAt: '2026-04-13T16:00:01Z',
      terminalAt: TS_2026_04_13T16_03_00Z,
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
      updatedAt: TS_2026_04_13T16_08_00Z,
      startedAt: '2026-04-13T16:05:01Z',
      terminalAt: TS_2026_04_13T16_08_00Z,
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
          createdAt: TS_2026_04_13T16_00_00Z,
          updatedAt: TS_2026_04_13T16_03_00Z,
          startedAt: '2026-04-13T16:00:01Z',
          terminalAt: TS_2026_04_13T16_03_00Z,
          resolvedModelId: 'openai/gpt-4.1-mini',
          requestedMessageText: '旧问题',
          assistantText: '旧答案',
        },
        {
          runId: 'run-2b',
          threadId: 'thread-2',
          status: 'completed',
          createdAt: '2026-04-13T16:05:00Z',
          updatedAt: TS_2026_04_13T16_08_00Z,
          startedAt: '2026-04-13T16:05:01Z',
          terminalAt: TS_2026_04_13T16_08_00Z,
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
