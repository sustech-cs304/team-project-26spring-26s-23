/** @vitest-environment jsdom */

import { StrictMode, act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDeferred,
  createDirectoryResponse,
  createSessionResponse,
  hoverElement,
  inputText,
  keyDownElement,
  openContextMenu,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionShell,
} from './assistant-workspace-controller'
import { runCreateSessionPendingScenario } from './test-support/assistant-workspace-creation-scenarios'
import { ASSISTANT_WORKSPACE_SHELL_STATE_STORAGE_KEY } from './assistant-workspace-shell-state'
import { COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY } from './useAssistantWorkspaceState'
import {
  runSessionContextMenuScenario,
  runSessionDeletionScenario,
  runSessionRenameScenario,
} from './test-support/assistant-workspace-session-scenarios'

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
      throw new Error('Expected seeded agent directory.')
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
          recommendedToolsForAgent: ['tool.file-convert'],
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

  it('opens a session context menu with secondary submenus for copy and export on right click', async () => {
    await runSessionContextMenuScenario()
  })

  it('renames sessions in place through Enter, Escape, and blur interactions', async () => {
    await runSessionRenameScenario()
  })

  it('requires delete confirmation and returns the active session to the selected-agent empty state after deletion', async () => {
    await runSessionDeletionScenario()
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
      version: 'chat-history-v1',
      threads: [currentSummary],
    }))
    const getHistoryThreadDetail = vi.fn().mockImplementation(async () => currentDetail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const renameHistoryThread = vi.fn().mockImplementation(async () => {
      currentSummary = renamedSummary
      currentDetail = renamedDetail
      return {
        ok: true as const,
        version: 'chat-history-v1',
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

    await openContextMenu(firstRender.getByTestId('assistant-session-card-thread-1'), 180, 120)
    await clickElement(firstRender.getByTestId('assistant-session-context-action-rename'))

    const renameInput = firstRender.getByTestId('assistant-session-rename-input-thread-1') as HTMLInputElement
    await inputText(renameInput, renamedSummary.title)
    await keyDownElement(renameInput, 'Enter')

    await waitForAssistantWorkspaceCondition(() => (
      (firstRender.getByTestId('assistant-session-card-thread-1').textContent ?? '').includes(renamedSummary.title)
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
      (remounted.getByTestId('assistant-session-card-thread-1').textContent ?? '').includes(renamedSummary.title)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-1'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
    ))

    remounted.unmount()
  })

  it('hides permanently deleted threads immediately and keeps them absent on remount', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let isDeleted = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: 'chat-history-v1',
      threads: isDeleted ? [] : [historyFixture.summary],
    }))
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)
    const deleteHistoryThread = vi.fn().mockImplementation(async () => {
      isDeleted = true
      return {
        ok: true as const,
        threadId: historyFixture.summary.threadId,
        deletedAt: '2026-04-13T15:06:30Z',
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

    await openContextMenu(firstRender.getByTestId('assistant-session-card-thread-1'), 220, 140)
    await clickElement(firstRender.getByTestId('assistant-session-context-action-delete'))
    await clickElement(firstRender.getByTestId('assistant-session-context-action-delete-confirm'))

    await waitForAssistantWorkspaceCondition(() => firstRender.queryByTestId('assistant-session-card-thread-1') === null)

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

    expect(remounted.queryByTestId('assistant-session-card-thread-1')).toBeNull()

    remounted.unmount()
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
      createdAt: '2026-04-13T15:06:30Z',
      updatedAt: '2026-04-13T15:06:30Z',
      lastActivityAt: '2026-04-13T15:06:30Z',
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
      version: 'chat-history-v1',
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
        version: 'chat-history-v1',
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

    await openContextMenu(rendered.getByTestId('assistant-session-card-thread-1'), 260, 160)
    await hoverElement(rendered.getByTestId('assistant-session-context-submenu-copy'))
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
      version: 'chat-history-v1',
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
    expect(rendered.getByTestId('assistant-session-card-thread-1').textContent).toContain('历史线程')

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

  it('creates history state for a new live session and refreshes persisted detail after run settlement', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const liveFixture = createLivePersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let includePersistedLiveSession = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: 'chat-history-v1',
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: 'thread-live',
      createdAt: '2026-04-14T08:00:00Z',
      updatedAt: '2026-04-14T08:00:00Z',
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: 'thread-live',
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
    await clickElement(rendered.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
    ))

    expect(getHistoryThreadDetail).not.toHaveBeenCalled()
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: 'thread-live',
      }),
      sessionHistory: expect.objectContaining({
        isPersistedThread: false,
      }),
      runtimeControllerBySessionId: expect.objectContaining({
        'thread-live': expect.objectContaining({
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
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-live-1', 'thread-live')
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === 'thread-live')
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === 'run-live-1')
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledWith('thread-live')
    expect(getHistoryRunReplay).toHaveBeenCalledWith('run-live-1')
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'idle',
        selectedRunId: null,
      }),
    })

    rendered.unmount()
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
      version: 'chat-history-v1',
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn()
      .mockResolvedValueOnce(createSessionResponse({
        threadId: 'thread-live',
        createdAt: '2026-04-14T08:00:00Z',
        updatedAt: '2026-04-14T08:00:00Z',
      }))
      .mockResolvedValueOnce(createSessionResponse({
        threadId: 'thread-new',
        createdAt: '2026-04-14T08:05:00Z',
        updatedAt: '2026-04-14T08:05:00Z',
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
    await clickElement(rendered.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
    ))

    await clickElement(rendered.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-new'
    ))

    expect(getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null).toBeNull()
    expect(getLastMockCopilotChatPanelProps().runtimeControllerBySessionId).toEqual(expect.objectContaining({
      'thread-live': expect.any(Object),
      'thread-new': expect.any(Object),
    }))

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-live-1', 'thread-live')
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-new'
    ))

    expect(getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null).toBeNull()
    expect(getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === 'thread-live')).toBe(false)
    expect(getHistoryRunReplay.mock.calls.some(([runId]) => runId === 'run-live-1')).toBe(false)
    expect(getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === 'thread-new')).toBe(false)

    await clickElement(rendered.getByTestId('assistant-session-card-thread-live'))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === 'thread-live')
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === 'run-live-1')
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
      && getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    await clickElement(rendered.getByTestId('assistant-session-card-thread-new'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-new'
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
    let includePersistedLiveSession = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: 'chat-history-v1',
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: 'thread-live',
      createdAt: '2026-04-14T08:00:00Z',
      updatedAt: '2026-04-14T08:00:00Z',
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: 'thread-live',
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
    await clickElement(rendered.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
    ))

    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-live-1', 'thread-live')
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)

    expect(readPersistedAssistantWorkspaceShellState()).toEqual({
      selectedThreadId: 'thread-live',
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })

    rendered.unmount()
  })

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
      throw new Error('Expected protected and evictable LRU fixtures.')
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
      throw new Error('Expected protected and evictable LRU fixtures.')
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

  it('restores a newly persisted live thread after remounting the workspace', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const liveFixture = createLivePersistedHistoryFixture()
    const listAgents = vi.fn().mockResolvedValue(directoryResponse)
    let includePersistedLiveSession = false
    const listHistoryThreads = vi.fn().mockImplementation(async () => ({
      ok: true as const,
      version: 'chat-history-v1',
      threads: includePersistedLiveSession ? [liveFixture.summary] : [],
    }))
    const createSession = vi.fn().mockResolvedValue(createSessionResponse({
      threadId: 'thread-live',
      createdAt: '2026-04-14T08:00:00Z',
      updatedAt: '2026-04-14T08:00:00Z',
    }))
    const getCapabilities = vi.fn().mockResolvedValue(createCapabilitiesResponse({
      sessionId: 'thread-live',
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
    await clickElement(firstRender.getByTestId('assistant-create-session-button'))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
    ))

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-live-1', 'thread-live')
    })

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === 'thread-live')
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === 'run-live-1')
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
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-live'
    ))
    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length > detailCallCountBeforeRemount)

    expect(remounted.getByTestId('assistant-session-card-thread-live').textContent).toContain('新建后落库线程')
    expect(getHistoryRunReplay.mock.calls.length).toBe(replayCallCountBeforeRemount)
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: 'thread-live',
      }),
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'idle',
        selectedRunId: null,
      }),
    })

    remounted.unmount()
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
      version: 'chat-history-v1',
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
    expect(rendered.getByTestId('assistant-session-card-thread-1').textContent).toContain('历史线程')
    expect(rendered.getByTestId('assistant-session-card-thread-2').textContent).toContain('第二历史线程')

    await clickElement(rendered.getByTestId('assistant-session-card-thread-2'))

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

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))
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
      version: 'chat-history-v1',
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

    await clickElement(firstRender.getByTestId('assistant-session-card-thread-2'))
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
      version: 'chat-history-v1',
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

    await clickElement(rendered.getByTestId('assistant-session-card-thread-2'))
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
      version: 'chat-history-v1',
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
    expect(rendered.queryByTestId('assistant-session-card-thread-1')).toBeNull()
    expect(getHistoryThreadDetail).not.toHaveBeenCalled()
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(scheduledRetries).toHaveLength(1)
    expect(scheduledRetries[0]?.delay).toBe(1_000)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === '[copilot-debug]'
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === 'assistant-workspace'
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
    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId('assistant-session-card-thread-1') !== null)
    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length >= 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && (getLastMockCopilotChatPanelProps().sessionHistory?.selectedRunId ?? null) === null
    ))

    expect(rendered.getByTestId('assistant-session-card-thread-1').textContent).toContain('历史线程')
    expect(getHistoryRunReplay).not.toHaveBeenCalled()
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === '[copilot-debug]'
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === 'assistant-workspace'
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
        version: 'chat-history-v1',
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
    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId('assistant-session-card-thread-1') !== null)

    rendered.unmount()
  })

  it('keeps a non-empty restore visible under StrictMode when startup agent hydration overlaps the restore request', async () => {
    mockCopilotChatPanel.mockClear()

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const directoryResponse = createDirectoryResponse()
    const historyFixture = createPersistedHistoryFixture()
    const secondMountRestore = createDeferred<{
      ok: true
      version: 'chat-history-v1'
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
        version: 'chat-history-v1'
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
        version: 'chat-history-v1',
        threads: [historyFixture.summary],
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitForAssistantWorkspaceCondition(() => rendered.queryByTestId('assistant-session-card-thread-1') !== null)
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
      call[0] === '[copilot-debug]'
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === 'assistant-workspace'
      && 'event' in call[1]
      && call[1].event === 'history-restore-request-succeeded'
      && 'threadCount' in call[1]
      && call[1].threadCount === 1
      && 'restoredSessionCount' in call[1]
      && call[1].restoredSessionCount === 1
    ))).toBe(true)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === '[copilot-debug]'
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === 'assistant-workspace'
      && 'event' in call[1]
      && call[1].event === 'workspace-shell-state-persisted'
      && 'threadSummaryCount' in call[1]
      && call[1].threadSummaryCount === 1
      && 'threadSummarySource' in call[1]
      && call[1].threadSummarySource === 'session-list'
    ))).toBe(true)
    expect(debugSpy.mock.calls.some((call) => (
      call[0] === '[copilot-debug]'
      && typeof call[1] === 'object'
      && call[1] !== null
      && 'scope' in call[1]
      && call[1].scope === 'assistant-workspace'
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
      version: 'chat-history-v1',
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

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))

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

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))

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
      version: 'chat-history-v1',
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

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))

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
      version: 'chat-history-v1',
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
      version: 'chat-history-v1',
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
          resolvedModelId: 'openai/gpt-4.1',
          requestedMessageText: '你好',
          assistantText: '历史摘要',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-1',
        modelSnapshot: {
          resolvedModelId: 'openai/gpt-4.1',
        },
        toolsSnapshot: {
          resolvedToolIds: ['tool.file-convert'],
        },
      },
      availabilityDrift: {
        status: 'not_evaluated',
      },
    },
    replay: {
      ok: true as const,
      version: 'chat-history-v1',
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T15:00:00Z',
        updatedAt: '2026-04-13T15:05:00Z',
        startedAt: '2026-04-13T15:00:01Z',
        terminalAt: '2026-04-13T15:05:00Z',
        resolvedModelId: 'openai/gpt-4.1',
        requestedMessageText: '你好',
        assistantText: '历史摘要',
      },
      historicalSnapshot: {
        resolvedModelId: 'openai/gpt-4.1',
        resolvedModelRoute: {
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'provider-openai',
            modelId: 'openai/gpt-4.1',
          },
        },
        resolvedToolIds: ['tool.file-convert'],
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
    threadId: 'thread-live',
    boundAgentId: 'general',
    title: '新建后落库线程',
    titleSource: 'deterministic',
    summary: '最新成功摘要',
    summarySource: 'deterministic',
    createdAt: '2026-04-14T08:00:00Z',
    updatedAt: '2026-04-14T08:03:00Z',
    lastActivityAt: '2026-04-14T08:03:00Z',
    lastRunId: 'run-live-1',
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
      version: 'chat-history-v1',
      thread: {
        ...summary,
      },
      timelineItems: [
        {
          kind: 'user_message',
          runId: 'run-live-1',
          sequenceStart: 0,
          text: '最新问题',
        },
        {
          kind: 'assistant_message',
          runId: 'run-live-1',
          sequenceStart: 1,
          text: '最新成功摘要',
        },
      ],
      runSummaries: [
        {
          runId: 'run-live-1',
          threadId: 'thread-live',
          status: 'completed',
          createdAt: '2026-04-14T08:00:00Z',
          updatedAt: '2026-04-14T08:03:00Z',
          startedAt: '2026-04-14T08:00:01Z',
          terminalAt: '2026-04-14T08:03:00Z',
          resolvedModelId: 'openai/gpt-4.1',
          requestedMessageText: '最新问题',
          assistantText: '最新成功摘要',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-live-1',
        modelSnapshot: {
          resolvedModelId: 'openai/gpt-4.1',
        },
        toolsSnapshot: {
          resolvedToolIds: ['tool.file-convert'],
        },
      },
      availabilityDrift: {
        status: 'not_evaluated',
      },
    },
    replay: {
      ok: true as const,
      version: 'chat-history-v1',
      run: {
        runId: 'run-live-1',
        threadId: 'thread-live',
        status: 'completed',
        createdAt: '2026-04-14T08:00:00Z',
        updatedAt: '2026-04-14T08:03:00Z',
        startedAt: '2026-04-14T08:00:01Z',
        terminalAt: '2026-04-14T08:03:00Z',
        resolvedModelId: 'openai/gpt-4.1',
        requestedMessageText: '最新问题',
        assistantText: '最新成功摘要',
      },
      historicalSnapshot: {
        resolvedModelId: 'openai/gpt-4.1',
        resolvedToolIds: ['tool.file-convert'],
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
    version: 'chat-history-v1',
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
      resolvedToolIds: ['tool.file-convert'],
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
    version: 'chat-history-v1',
    run: {
      runId: 'run-2b',
      threadId: 'thread-2',
      status: 'completed',
      createdAt: '2026-04-13T16:05:00Z',
      updatedAt: '2026-04-13T16:08:00Z',
      startedAt: '2026-04-13T16:05:01Z',
      terminalAt: '2026-04-13T16:08:00Z',
      resolvedModelId: 'openai/gpt-4.1',
      requestedMessageText: '第二线程问题',
      assistantText: '第二线程新答案',
    },
    historicalSnapshot: {
      resolvedModelId: 'openai/gpt-4.1',
      resolvedToolIds: ['tool.file-convert'],
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
      version: 'chat-history-v1',
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
          resolvedModelId: 'openai/gpt-4.1',
          requestedMessageText: '第二线程问题',
          assistantText: '第二线程新答案',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-2b',
        modelSnapshot: {
          resolvedModelId: 'openai/gpt-4.1',
        },
        toolsSnapshot: {
          resolvedToolIds: ['tool.file-convert'],
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

type MockRuntimeControllerRecord = Record<string, {
  composerDraft?: {
    messageText?: string
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
    resolvedModelId: 'openai/gpt-4.1',
    requestedMessageText: userText,
    assistantText,
  }

  return {
    summary,
    detail: {
      ok: true as const,
      version: 'chat-history-v1',
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
          resolvedModelId: 'openai/gpt-4.1',
        },
        toolsSnapshot: {
          resolvedToolIds: ['tool.file-convert'],
        },
      },
      availabilityDrift: {
        status: 'not_evaluated',
      },
    },
    replay: {
      ok: true as const,
      version: 'chat-history-v1',
      run: {
        ...runSummary,
      },
      historicalSnapshot: {
        resolvedModelId: 'openai/gpt-4.1',
        resolvedToolIds: ['tool.file-convert'],
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
        version: 'chat-history-v1',
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
  const props = mockCopilotChatPanel.mock.calls[mockCopilotChatPanel.mock.calls.length - 1]?.[0]
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
