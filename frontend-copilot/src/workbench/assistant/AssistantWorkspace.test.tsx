/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { AssistantWorkspace } from './AssistantWorkspace'
import {
  clickElement,
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
  renderWithRoot,
} from './AssistantWorkspace.test-support'
import {
  createAssistantAgentDirectoryState,
  createAssistantSessionShell,
} from './assistant-workspace-controller'
import { runCreateSessionPendingScenario } from './test-support/assistant-workspace-creation-scenarios'
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
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === historyFixture.replay.run.runId)
    ))

    expect(listHistoryThreads).toHaveBeenCalledOnce()
    expect(getHistoryThreadDetail).toHaveBeenCalledWith(historyFixture.summary.threadId)
    expect(getHistoryRunReplay).toHaveBeenCalledWith(historyFixture.replay.run.runId)
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
        replayStatus: 'ready',
        selectedRunId: 'run-1',
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

    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionShell: expect.objectContaining({
        sessionId: 'thread-live',
      }),
      sessionHistory: expect.objectContaining({
        selectedRunId: expect.anything(),
      }),
    })

    includePersistedLiveSession = true
    await act(async () => {
      getLastMockCopilotChatPanelProps().onSessionRunSettled?.('run-live-1')
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
        replayStatus: 'ready',
        selectedRunId: 'run-live-1',
      }),
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

      return secondFixture.replaysByRunId[runId]
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
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === firstFixture.replay.run.runId)
    ))

    expect(rendered.getByTestId('assistant-session-card-thread-1').textContent).toContain('历史线程')
    expect(rendered.getByTestId('assistant-session-card-thread-2').textContent).toContain('第二历史线程')

    await clickElement(rendered.getByTestId('assistant-session-card-thread-2'))

    await waitForAssistantWorkspaceCondition(() => (
      getHistoryThreadDetail.mock.calls.some(([threadId]) => threadId === secondFixture.summary.threadId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getHistoryRunReplay.mock.calls.some(([runId]) => runId === secondFixture.replay.run.runId)
    ))
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionShell?.sessionId === 'thread-2'
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

  it('retries persisted list restore after the first failure and eventually hydrates the thread', async () => {
    mockCopilotChatPanel.mockClear()

    const directoryResponse = createDirectoryResponse()
    const directoryState = createAssistantAgentDirectoryState(directoryResponse)
    const historyFixture = createPersistedHistoryFixture()
    const listHistoryThreads = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'history list unavailable',
      })
      .mockResolvedValueOnce({
        ok: true,
        version: 'chat-history-v1',
        threads: [historyFixture.summary],
      })
    const getHistoryThreadDetail = vi.fn().mockResolvedValue(historyFixture.detail)
    const getHistoryRunReplay = vi.fn().mockResolvedValue(historyFixture.replay)

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => listHistoryThreads.mock.calls.length >= 2)
    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length === 1)
    await waitForAssistantWorkspaceCondition(() => getHistoryRunReplay.mock.calls.length === 1)

    expect(listHistoryThreads).toHaveBeenCalledTimes(2)
    expect(getHistoryThreadDetail).toHaveBeenCalledWith(historyFixture.summary.threadId)
    expect(getHistoryRunReplay).toHaveBeenCalledWith(historyFixture.replay.run.runId)
    expect(getLastMockCopilotChatPanelProps()).toMatchObject({
      sessionHistory: expect.objectContaining({
        detailStatus: 'ready',
        replayStatus: 'ready',
      }),
    })

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

    const rendered = renderWithRoot(
      <AssistantWorkspace
        bootstrap={createBootstrapController()}
        listHistoryThreads={listHistoryThreads}
        getHistoryThreadDetail={getHistoryThreadDetail}
        getHistoryRunReplay={getHistoryRunReplay}
        initialDirectoryState={directoryState}
      />,
    )

    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length === 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'error'
    ))

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))

    await waitForAssistantWorkspaceCondition(() => getHistoryThreadDetail.mock.calls.length === 2)
    await waitForAssistantWorkspaceCondition(() => getHistoryRunReplay.mock.calls.length === 1)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'error'
    ))

    await clickElement(rendered.getByTestId('assistant-session-card-thread-1'))

    await waitForAssistantWorkspaceCondition(() => getHistoryRunReplay.mock.calls.length === 2)
    await waitForAssistantWorkspaceCondition(() => (
      getLastMockCopilotChatPanelProps().sessionHistory?.detailStatus === 'ready'
      && getLastMockCopilotChatPanelProps().sessionHistory?.replayStatus === 'ready'
    ))

    expect(getHistoryThreadDetail).toHaveBeenCalledTimes(2)
    expect(getHistoryRunReplay).toHaveBeenCalledTimes(2)

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

function getLastMockCopilotChatPanelProps(): {
  sessionShell?: {
    sessionId?: string
  }
  sessionHistory?: {
    detailStatus?: string
    replayStatus?: string
    selectedRunId?: string | null
  }
  selectSessionHistoryRun?: (runId: string | null) => void
  onSessionRunSettled?: (runId: string | null) => void
} {
  const props = mockCopilotChatPanel.mock.calls[mockCopilotChatPanel.mock.calls.length - 1]?.[0]
  if (props === undefined) {
    throw new Error('Expected CopilotChatPanel to receive props.')
  }

  return props as {
    sessionShell?: {
      sessionId?: string
    }
    sessionHistory?: {
      detailStatus?: string
      replayStatus?: string
      selectedRunId?: string | null
    }
    selectSessionHistoryRun?: (runId: string | null) => void
    onSessionRunSettled?: (runId: string | null) => void
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
