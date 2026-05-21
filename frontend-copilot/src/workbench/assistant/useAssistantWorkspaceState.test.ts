/** @vitest-environment jsdom */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderHook, waitFor } from '@testing-library/react'

import {
  COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY,
} from './useAssistantWorkspaceState'

const mockBootstrapController = {
  retrying: false,
  retry: vi.fn(),
  state: {
    status: 'ready',
    bootstrapFields: {
      runtimeUrl: 'http://127.0.0.1:8765',
      agentName: null,
      debugModeEnabled: false,
    },
    storageState: 'stored',
    runtime: {
      status: 'ready',
      expectedMode: 'development',
      resolvedMode: 'development',
      runtimeUrl: 'http://127.0.0.1:8765',
      isPackaged: false,
      failure: null,
    },
    runtimeUrl: 'http://127.0.0.1:8765',
    runtimeSource: 'hosted',
    agentName: null,
    agentNameSource: 'missing',
    diagnostics: {
      hostedStatus: 'ready',
      failure: null,
      mode: 'development',
      modeSource: 'resolved',
      runtimeSource: 'hosted',
    },
    devOverrideAllowed: true,
    devOverrideConfigured: false,
  },
} as any

function createAgent(id: string, label = id): any {
  return {
    id,
    agentId: id,
    status: 'active' as const,
    recommendedTools: [],
    displayName: label,
    description: `Agent ${label}`,
    label,
    shortLabel: label,
    hint: null,
    iconKey: 'sparkles',
    icon: null as any,
    disabled: false,
  }
}

function createSessionShell(sessionId: string, agentLabel = 'general'): import('../types').AssistantSessionShell {
  return {
    sessionId,
    title: `Session ${sessionId}`,
    boundAgent: createAgent('general', agentLabel) as any,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    capabilities: {
      capabilitiesVersion: 'live-cap-v1',
      allAvailableTools: [],
      recommendedToolsForAgent: [],
      defaultEnabledTools: [],
      toolSelectionMode: 'recommendation-only',
    },
  }
}

const mockUseAssistantDirectoryState = vi.fn()
const mockUseAssistantSessionCreation = vi.fn()
const mockUseAssistantSessionInteractionState = vi.fn()
const mockUseAssistantSessionManagementState = vi.fn()

vi.mock('./useAssistantDirectoryState', () => ({
  useAssistantDirectoryState: (...args: unknown[]) => mockUseAssistantDirectoryState(...args),
}))

vi.mock('./useAssistantSessionCreation', () => ({
  useAssistantSessionCreation: (...args: unknown[]) => mockUseAssistantSessionCreation(...args),
}))

vi.mock('./useAssistantSessionInteractionState', () => ({
  useAssistantSessionInteractionState: (...args: unknown[]) => mockUseAssistantSessionInteractionState(...args),
}))

vi.mock('./state/useAssistantSessionManagementState', () => ({
  useAssistantSessionManagementState: (...args: unknown[]) => mockUseAssistantSessionManagementState(...args),
}))

const mockListAgents = vi.fn()
const mockCreateSession = vi.fn()
const mockGetCapabilities = vi.fn()
const mockListHistoryThreads = vi.fn()
const mockGetHistoryThreadDetail = vi.fn()
const mockGetHistoryRunReplay = vi.fn()
const mockRenameHistoryThread = vi.fn()
const mockDuplicateHistoryThread = vi.fn()
const mockDeleteHistoryThread = vi.fn()
const mockLoadShellState = vi.fn()
const mockPersistShellState = vi.fn()

function defaultDirectoryState() {
  return {
    status: 'ready' as const,
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [createAgent('general', 'General')],
    error: null,
  }
}

function defaultSessionCreationResult(overrides: Record<string, unknown> = {}) {
  const sessions: import('../types').AssistantSessionShell[] = []
  const activeSessionId = null
  return {
    sessionListState: { sessions, activeSessionId },
    setSessionListState: vi.fn(),
    sessionShell: null,
    sessionStatus: 'idle' as const,
    sessionError: null,
    createSessionLabel: 'Create session',
    createSessionButtonDisabled: false,
    activateSession: vi.fn(),
    handleCreateSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function defaultInteractionState() {
  return {
    renderedSessions: [],
    dragPreviewIndex: null,
    draggingSessionShell: null,
    sessionContextMenu: null,
    sessionDragState: null,
    sessionListRef: { current: null },
    sessionDragGhostRef: { current: null },
    handleSessionPointerDown: vi.fn(),
    handleSessionClick: vi.fn(),
    handleSessionContextMenu: vi.fn(),
    dismissSessionContextMenu: vi.fn(),
    selectSessionContextSubmenu: vi.fn(),
  }
}

function defaultManagementState() {
  return {
    renamingSessionId: null,
    renamingValue: '',
    deleteConfirmationSessionId: null,
    sessionContextMenu: null,
    handleSessionContextMenu: vi.fn(),
    dismissSessionContextMenu: vi.fn(),
    requestSessionRename: vi.fn(),
    updateSessionRenameValue: vi.fn(),
    commitSessionRename: vi.fn(),
    cancelSessionRename: vi.fn(),
    duplicateSession: vi.fn(),
    requestSessionDelete: vi.fn(),
    confirmSessionDelete: vi.fn(),
    cancelSessionDelete: vi.fn(),
  }
}

function setupDefaultMocks() {
  mockUseAssistantDirectoryState.mockReturnValue({
    directoryState: defaultDirectoryState(),
    selectedAgent: createAgent('general', 'General'),
    selectAgent: vi.fn(),
    setSelectedAgentId: vi.fn(),
  })
  mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
  mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
  mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
  mockLoadShellState.mockReturnValue({
    selectedThreadId: null,
    selectedRunIdByThreadId: {},
    threadSummaries: [],
  })
  mockPersistShellState.mockReturnValue(undefined)
  mockListAgents.mockResolvedValue({
    ok: true,
    directoryVersion: 'agents-v1',
    defaultAgentId: 'general',
    agents: [],
  })
  mockListHistoryThreads.mockResolvedValue({
    ok: true as const,
    version: 'chat-history-v1',
    threads: [],
  })
}

describe('COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY', () => {
  it('is 10', () => {
    expect(COPILOT_THREAD_RUNTIME_CONTROLLER_LRU_CAPACITY).toBe(10)
  })
})

describe('useAssistantWorkspaceState - basic rendering', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing with all sub-hooks mocked', () => {
    setupDefaultMocks()

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listAgents: mockListAgents,
        createSession: mockCreateSession,
        getCapabilities: mockGetCapabilities,
        listHistoryThreads: mockListHistoryThreads,
        getHistoryThreadDetail: mockGetHistoryThreadDetail,
        getHistoryRunReplay: mockGetHistoryRunReplay,
        renameHistoryThread: mockRenameHistoryThread,
        duplicateHistoryThread: mockDuplicateHistoryThread,
        deleteHistoryThread: mockDeleteHistoryThread,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current).toBeDefined()
    expect(result.current.sessionListState).toBeDefined()
    expect(result.current.sessionHistoryById).toBeDefined()
    expect(result.current.runtimeControllerBySessionId).toBeDefined()
    expect(typeof result.current.handleCreateSession).toBe('function')
    expect(typeof result.current.selectAgent).toBe('function')
    expect(typeof result.current.duplicateSession).toBe('function')
    expect(typeof result.current.requestSessionRename).toBe('function')
    expect(typeof result.current.confirmSessionDelete).toBe('function')
    expect(result.current.historyRestoreError).toBeNull()
    expect(result.current.sessionError).toBeNull()
  })

  it('returns empty runtime controllers initially', () => {
    setupDefaultMocks()

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listAgents: mockListAgents,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.runtimeControllerBySessionId).toEqual({})
  })

  it('returns empty sessionHistoryById initially', () => {
    setupDefaultMocks()

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listAgents: mockListAgents,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.sessionHistoryById).toEqual({})
  })
})

describe('useAssistantWorkspaceState - session list management', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('exposes handleCreateSession from the creation sub-hook', async () => {
    const handleCreateSession = vi.fn().mockResolvedValue(undefined)
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({ handleCreateSession }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        createSession: mockCreateSession,
        getCapabilities: mockGetCapabilities,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await act(async () => {
      await result.current.handleCreateSession()
    })

    expect(handleCreateSession).toHaveBeenCalled()
  })

  it('exposes duplicateSession from management sub-hook', () => {
    const duplicateSession = vi.fn()
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue({
      ...defaultManagementState(),
      duplicateSession,
    })
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    result.current.duplicateSession('session-1')
    expect(duplicateSession).toHaveBeenCalledWith('session-1')
  })

  it('exposes requestSessionRename from management sub-hook', () => {
    const requestSessionRename = vi.fn()
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue({
      ...defaultManagementState(),
      requestSessionRename,
    })
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    result.current.requestSessionRename('session-2')
    expect(requestSessionRename).toHaveBeenCalledWith('session-2')
  })

  it('exposes confirmSessionDelete from management sub-hook', () => {
    const confirmSessionDelete = vi.fn()
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue({
      ...defaultManagementState(),
      confirmSessionDelete,
    })
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    result.current.confirmSessionDelete('session-3')
    expect(confirmSessionDelete).toHaveBeenCalledWith('session-3')
  })

  it('exposes cancelSessionDelete / cancelSessionRename', () => {
    const cancelSessionDelete = vi.fn()
    const cancelSessionRename = vi.fn()
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue({
      ...defaultManagementState(),
      cancelSessionDelete,
      cancelSessionRename,
    })
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    result.current.cancelSessionDelete()
    result.current.cancelSessionRename()
    expect(cancelSessionDelete).toHaveBeenCalled()
    expect(cancelSessionRename).toHaveBeenCalled()
  })
})

describe('useAssistantWorkspaceState - session shell propagation', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns sessionShell from creation sub-hook', () => {
    const shell = createSessionShell('live-1')
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({
        sessionListState: { sessions: [shell], activeSessionId: 'live-1' },
        sessionShell: shell,
      }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.sessionShell).not.toBeNull()
    expect(result.current.sessionShell?.sessionId).toBe('live-1')
  })

  it('returns activeSessionHistory as a history state entry when sessionShell is present', async () => {
    const shell = createSessionShell('live-1')
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({
        sessionListState: { sessions: [shell], activeSessionId: 'live-1' },
        sessionShell: shell,
      }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(result.current.activeSessionHistory).not.toBeNull()
      expect(result.current.activeSessionHistory?.summary.threadId).toBe('live-1')
    })
  })

  it('returns sessionHistoryById synchronised with session list', async () => {
    const shell = createSessionShell('live-1')
    const initialSessions = { sessions: [shell], activeSessionId: 'live-1' }

    let setSessionListStateFn: (updater: unknown) => void = () => {}
    void setSessionListStateFn
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({
        sessionListState: initialSessions,
        sessionShell: shell,
        setSessionListState: (updater: unknown) => {
          setSessionListStateFn = updater as (u: unknown) => void
        },
      }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(result.current.sessionHistoryById['live-1']).toBeDefined()
    })

    const historyEntry = result.current.sessionHistoryById['live-1']
    expect(historyEntry).toBeDefined()
    expect(historyEntry.summary.threadId).toBe('live-1')
    expect(historyEntry.isPersistedThread).toBe(false)
    expect(historyEntry.detailStatus).toBe('idle')
  })

  it('marks live session shells as not persisted', async () => {
    const liveShell = createSessionShell('live-session')
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({
        sessionListState: { sessions: [liveShell], activeSessionId: 'live-session' },
        sessionShell: liveShell,
      }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      const entry = result.current.sessionHistoryById['live-session']
      expect(entry).toBeDefined()
      expect(entry.isPersistedThread).toBe(false)
    })
  })
})

describe('useAssistantWorkspaceState - history restore wiring', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls listHistoryThreads on mount when bootstrap is connectable', async () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    const listThreads = vi.fn().mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: listThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(listThreads).toHaveBeenCalled()
    })
  })

  it('sets historyRestoreError when listHistoryThreads fails', async () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    const listThreads = vi.fn().mockResolvedValue({ ok: false as const, error: 'Network error' })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: listThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(listThreads).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.historyRestoreError).toBe('Network error')
    })
  })

  it('sets historyRestoreError when listHistoryThreads throws', async () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    const listThreads = vi.fn().mockRejectedValue(new Error('Crash'))

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: listThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(listThreads).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(result.current.historyRestoreError).toBeTruthy()
    })
  })

  it('restores sessions from history list into sessionListState', async () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    const setSessionListState = vi.fn()

    mockUseAssistantSessionCreation.mockReturnValue({
      ...defaultSessionCreationResult(),
      setSessionListState,
    })
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)

    const historySummary = {
      threadId: 'hist-1',
      boundAgentId: 'general',
      title: 'History Thread 1',
      titleSource: 'deterministic' as const,
      summary: 'Summary text',
      summarySource: 'deterministic' as const,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      lastActivityAt: '2026-01-01T00:00:00Z',
      lastRunId: 'run-1',
      lastRunStatus: 'completed' as const,
      lastUserMessagePreview: 'Hello',
      lastAssistantMessagePreview: 'Hi',
      driftSummary: { status: 'not_evaluated' as const },
    }
    const listThreads = vi.fn().mockResolvedValue({
      ok: true as const,
      version: 'v1',
      threads: [historySummary],
    })

    renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: listThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    await waitFor(() => {
      expect(setSessionListState).toHaveBeenCalled()
    })
  })
})

describe('useAssistantWorkspaceState - directory state wiring', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes through directoryState from directory sub-hook', () => {
    const directoryState = {
      status: 'ready' as const,
      directoryVersion: 'agents-v2',
      defaultAgentId: 'custom',
      agents: [createAgent('custom', 'CustomAgent')],
      error: null,
    }
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState,
      selectedAgent: createAgent('custom', 'CustomAgent'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.directoryState).toEqual(directoryState)
  })

  it('exposes selectAgent from directory sub-hook', () => {
    const selectAgent = vi.fn()
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent,
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    result.current.selectAgent('general')
    expect(selectAgent).toHaveBeenCalledWith('general')
  })
})

describe('useAssistantWorkspaceState - history callbacks', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('retryActiveSessionHistoryLoad is a no-op when sessionShell is null', () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({ sessionShell: null }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(() => result.current.retryActiveSessionHistoryLoad()).not.toThrow()
  })

  it('selectActiveSessionHistoryRun is a no-op when sessionShell is null', () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({ sessionShell: null }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(() => result.current.selectActiveSessionHistoryRun('run-1')).not.toThrow()
  })

  it('has handleActiveSessionRunSettled as a callable function', () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(typeof result.current.handleActiveSessionRunSettled).toBe('function')
  })
})

describe('useAssistantWorkspaceState - interaction state wiring', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('passes through renderedSessions from interaction sub-hook', () => {
    const sessions = [createSessionShell('s1'), createSessionShell('s2')]
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(
      defaultSessionCreationResult({
        sessionListState: { sessions, activeSessionId: 's1' },
        sessionShell: sessions[0],
      }),
    )
    mockUseAssistantSessionInteractionState.mockReturnValue({
      ...defaultInteractionState(),
      renderedSessions: sessions,
    })
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.renderedSessions).toHaveLength(2)
  })

  it('passes through sessionContextMenu from interaction sub-hook', () => {
    const ctxMenu = { sessionId: 's1', sessionLabel: 'Test', x: 100, y: 200, activeSubmenu: null }
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue({
      ...defaultInteractionState(),
      sessionContextMenu: ctxMenu,
    })
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(result.current.sessionContextMenu).toEqual(ctxMenu)
  })
})

describe('useAssistantWorkspaceState - runtime controller state', () => {
  let useAssistantWorkspaceState: typeof import('./useAssistantWorkspaceState').useAssistantWorkspaceState

  beforeAll(async () => {
    const mod = await import('./useAssistantWorkspaceState')
    useAssistantWorkspaceState = mod.useAssistantWorkspaceState
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('provides setRuntimeControllerBySessionId callback', () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(typeof result.current.setRuntimeControllerBySessionId).toBe('function')
    expect(result.current.runtimeControllerBySessionId).toEqual({})
  })

  it('runtimeControllerBySessionId starts empty', () => {
    mockUseAssistantDirectoryState.mockReturnValue({
      directoryState: defaultDirectoryState(),
      selectedAgent: createAgent('general'),
      selectAgent: vi.fn(),
      setSelectedAgentId: vi.fn(),
    })
    mockUseAssistantSessionCreation.mockReturnValue(defaultSessionCreationResult())
    mockUseAssistantSessionInteractionState.mockReturnValue(defaultInteractionState())
    mockUseAssistantSessionManagementState.mockReturnValue(defaultManagementState())
    mockLoadShellState.mockReturnValue({
      selectedThreadId: null,
      selectedRunIdByThreadId: {},
      threadSummaries: [],
    })
    mockPersistShellState.mockReturnValue(undefined)
    mockListHistoryThreads.mockResolvedValue({ ok: true as const, version: 'v1', threads: [] })

    const { result } = renderHook(() =>
      useAssistantWorkspaceState({
        bootstrap: mockBootstrapController,
        listHistoryThreads: mockListHistoryThreads,
        loadShellState: mockLoadShellState,
        persistShellState: mockPersistShellState,
      }),
    )

    expect(Object.keys(result.current.runtimeControllerBySessionId)).toHaveLength(0)
  })
})
