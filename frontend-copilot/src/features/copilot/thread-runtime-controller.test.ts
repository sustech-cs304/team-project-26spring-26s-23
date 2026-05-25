import { describe, expect, it } from 'vitest'

import type { AssistantSessionShell } from '../../workbench/types'
import {
  createCopilotThreadRuntimeControllerState,
  hasCopilotThreadRuntimeControllerActiveRun,
  isCopilotThreadRuntimeControllerHandoffPending,
  isCopilotThreadRuntimeControllerLruCandidate,
  resolveCopilotThreadRuntimeControllerState,
  syncCopilotThreadRuntimeControllerStateRecord,
  touchCopilotThreadRuntimeControllerState,
  updateCopilotThreadRuntimeControllerStateRecord,
  type CopilotThreadRuntimeControllerState,
} from './thread-runtime-controller'

function createSessionShell(overrides?: Partial<AssistantSessionShell>): AssistantSessionShell {
  return {
    sessionId: 'session-1',
    capabilities: {
      capabilitiesVersion: 'cap-v12',
      allAvailableTools: [],
      recommendedToolsForAgent: [],
      defaultEnabledTools: [],
      toolSelectionMode: 'recommendation-only',
    },
    ...overrides,
  } as AssistantSessionShell
}

describe('createCopilotThreadRuntimeControllerState', () => {
  it('creates default idle state', () => {
    const createdAt = 1000
    const state = createCopilotThreadRuntimeControllerState(null, createdAt)

    expect(state.sessionId).toBe('')
    expect(state.conversation).toEqual([])
    expect(state.runState.phase).toBe('idle')
    expect(state.sendError).toBeNull()
    expect(state.thinkingCapability).toBeNull()
    expect(state.historyRebindAcknowledged).toBe(false)
    expect(state.activeAbortController).toBeNull()
    expect(state.pendingHistorySyncRunId).toBeNull()
    expect(state.lastSettledRunId).toBeNull()
    expect(state.pendingHistorySyncLogKey).toBeNull()
    expect(state.lastAccessedAt).toBe(createdAt)
    expect(state.composerAttachments).toBeDefined()
    expect(state.composerDraft).toBeDefined()
  })

  it('derives sessionId and default enabled tools from sessionShell', () => {
    const state = createCopilotThreadRuntimeControllerState(createSessionShell({
      capabilities: {
        capabilitiesVersion: 'cap-v12',
        allAvailableTools: [],
        recommendedToolsForAgent: ['tool.fs.read'],
        defaultEnabledTools: ['tool.fs.read', 'tool.remote-search'],
        toolSelectionMode: 'recommendation-only',
      },
    }))

    expect(state.sessionId).toBe('session-1')
    expect(state.composerDraft.enabledTools).toEqual(['tool.fs.read', 'tool.remote-search'])
  })

  it('uses empty sessionId when sessionShell is null', () => {
    const state = createCopilotThreadRuntimeControllerState(null)

    expect(state.sessionId).toBe('')
  })

  it('uses empty sessionId when sessionShell has no sessionId', () => {
    const state = createCopilotThreadRuntimeControllerState({} as AssistantSessionShell)

    expect(state.sessionId).toBe('')
  })

  it('defaults createdAt to Date.now()', () => {
    const before = Date.now()
    const state = createCopilotThreadRuntimeControllerState()
    const after = Date.now()

    expect(state.lastAccessedAt).toBeGreaterThanOrEqual(before)
    expect(state.lastAccessedAt).toBeLessThanOrEqual(after)
  })

  it('produces structurally independent states', () => {
    const s1 = createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' }))
    const s2 = createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's2' }))

    expect(s1.sessionId).not.toBe(s2.sessionId)
    expect(s1.conversation).not.toBe(s2.conversation)
  })
})

describe('touchCopilotThreadRuntimeControllerState', () => {
  it('updates lastAccessedAt when different', () => {
    const state = createCopilotThreadRuntimeControllerState(null, 1000)
    const touched = touchCopilotThreadRuntimeControllerState(state, 2000)

    expect(touched.lastAccessedAt).toBe(2000)
    expect(touched).not.toBe(state)
  })

  it('returns same reference when timestamp is unchanged', () => {
    const state = createCopilotThreadRuntimeControllerState(null, 1000)
    const touched = touchCopilotThreadRuntimeControllerState(state, 1000)

    expect(touched).toBe(state)
  })

  it('preserves all other state fields', () => {
    const state = createCopilotThreadRuntimeControllerState(createSessionShell(), 500)

    const touched = touchCopilotThreadRuntimeControllerState(state, 999)

    expect(touched.sessionId).toBe('session-1')
    expect(touched.runState.phase).toBe('idle')
    expect(touched.lastAccessedAt).toBe(999)
  })
})

describe('isCopilotThreadRuntimeControllerHandoffPending', () => {
  it('returns true when pendingHistorySyncRunId is set', () => {
    const state = createCopilotThreadRuntimeControllerState()
    state.pendingHistorySyncRunId = 'run-1'

    expect(isCopilotThreadRuntimeControllerHandoffPending(state)).toBe(true)
  })

  it('returns false when pendingHistorySyncRunId is null', () => {
    const state = createCopilotThreadRuntimeControllerState()

    expect(isCopilotThreadRuntimeControllerHandoffPending(state)).toBe(false)
  })
})

describe('hasCopilotThreadRuntimeControllerActiveRun', () => {
  it('returns true when phase is starting', () => {
    const state = createCopilotThreadRuntimeControllerState()
    state.runState.phase = 'starting'

    expect(hasCopilotThreadRuntimeControllerActiveRun(state)).toBe(true)
  })

  it('returns true when phase is streaming', () => {
    const state = createCopilotThreadRuntimeControllerState()
    state.runState.phase = 'streaming'

    expect(hasCopilotThreadRuntimeControllerActiveRun(state)).toBe(true)
  })

  it('returns true when activeAbortController is set', () => {
    const state = createCopilotThreadRuntimeControllerState()
    state.activeAbortController = new AbortController()

    expect(hasCopilotThreadRuntimeControllerActiveRun(state)).toBe(true)
  })

  it('returns false for idle phase with no abort controller', () => {
    const state = createCopilotThreadRuntimeControllerState()

    expect(hasCopilotThreadRuntimeControllerActiveRun(state)).toBe(false)
  })

  it('returns false for completed phase with no abort controller', () => {
    const state = createCopilotThreadRuntimeControllerState()
    state.runState.phase = 'completed'

    expect(hasCopilotThreadRuntimeControllerActiveRun(state)).toBe(false)
  })
})

describe('isCopilotThreadRuntimeControllerLruCandidate', () => {
  function stateWithPhase(phase: string): CopilotThreadRuntimeControllerState {
    const s = createCopilotThreadRuntimeControllerState()
    s.runState.phase = phase as CopilotThreadRuntimeControllerState['runState']['phase']
    return s
  }

  it('returns true for idle with no active run or handoff', () => {
    const state = stateWithPhase('idle')
    expect(isCopilotThreadRuntimeControllerLruCandidate(state)).toBe(true)
  })

  it('returns true for completed', () => {
    expect(isCopilotThreadRuntimeControllerLruCandidate(stateWithPhase('completed'))).toBe(true)
  })

  it('returns true for failed', () => {
    expect(isCopilotThreadRuntimeControllerLruCandidate(stateWithPhase('failed'))).toBe(true)
  })

  it('returns true for cancelled', () => {
    expect(isCopilotThreadRuntimeControllerLruCandidate(stateWithPhase('cancelled'))).toBe(true)
  })

  it('returns false for starting (active run)', () => {
    const s = stateWithPhase('starting')
    s.activeAbortController = null
    expect(isCopilotThreadRuntimeControllerLruCandidate(s)).toBe(false)
  })

  it('returns false for streaming (active run)', () => {
    expect(isCopilotThreadRuntimeControllerLruCandidate(stateWithPhase('streaming'))).toBe(false)
  })

  it('returns false when handoff is pending', () => {
    const s = stateWithPhase('idle')
    s.pendingHistorySyncRunId = 'run-1'
    expect(isCopilotThreadRuntimeControllerLruCandidate(s)).toBe(false)
  })

  it('returns false when activeAbortController is set regardless of phase', () => {
    const s = stateWithPhase('idle')
    s.activeAbortController = new AbortController()
    expect(isCopilotThreadRuntimeControllerLruCandidate(s)).toBe(false)
  })
})

describe('resolveCopilotThreadRuntimeControllerState', () => {
  it('returns existing state by sessionId', () => {
    const existing = createCopilotThreadRuntimeControllerState(
      createSessionShell({ sessionId: 'abc' }),
    )
    const record = { abc: existing }

    const result = resolveCopilotThreadRuntimeControllerState(record, 'abc')

    expect(result).toBe(existing)
  })

  it('creates new state when not found', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const result = resolveCopilotThreadRuntimeControllerState(record, 'new-session')

    expect(result.sessionId).toBe('new-session')
    expect(result.runState.phase).toBe('idle')
  })

  it('returns default state for null sessionId', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const result = resolveCopilotThreadRuntimeControllerState(record, null)

    expect(result.sessionId).toBe('')
  })

  it('returns default state for undefined sessionId', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const result = resolveCopilotThreadRuntimeControllerState(record, undefined)

    expect(result.sessionId).toBe('')
  })

  it('returns default state for empty sessionId', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const result = resolveCopilotThreadRuntimeControllerState(record, '')

    expect(result.sessionId).toBe('')
  })

  it('trims whitespace from sessionId', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      'my-session': createCopilotThreadRuntimeControllerState(
        createSessionShell({ sessionId: 'my-session' }),
      ),
    }

    const result = resolveCopilotThreadRuntimeControllerState(record, '  my-session  ')

    expect(result.sessionId).toBe('my-session')
  })
})

describe('updateCopilotThreadRuntimeControllerStateRecord', () => {
  it('applies updater and returns new record', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' }), 1000),
    }

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 's1',
      (state) => ({ ...state, sendError: { message: 'err', errorDetail: null } }),
    )

    expect(updated['s1'].sendError).toEqual({ message: 'err', errorDetail: null })
    expect(updated['s1'].lastAccessedAt).not.toBe(1000)
  })

  it('touches by default', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' }), 500),
    }

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 's1',
      (state) => state,
      { touchedAt: 2000 },
    )

    expect(updated['s1'].lastAccessedAt).toBe(2000)
  })

  it('does not touch when touch option is false', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' }), 500),
    }

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 's1',
      (state) => ({ ...state, sendError: { message: 'err', errorDetail: null } }),
      { touch: false },
    )

    expect(updated['s1'].lastAccessedAt).toBe(500)
  })

  it('returns same record when state is unchanged', () => {
    const state = createCopilotThreadRuntimeControllerState(
      createSessionShell({ sessionId: 's1' }),
      1000,
    )
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': touchCopilotThreadRuntimeControllerState(state, 2000),
    }

    // Update with identity function but we must not produce a new reference
    // The equality check is nextState === currentState after touch
    // We mock: no real update, and the touch returns same ref if same timestamp
    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 's1',
      (s) => s,
      { touch: false },
    )

    expect(updated).toBe(record)
  })

  it('creates state for missing session', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 'new-session',
      (state) => ({ ...state, historyRebindAcknowledged: true }),
    )

    expect(updated['new-session'].sessionId).toBe('new-session')
    expect(updated['new-session'].historyRebindAcknowledged).toBe(true)
  })

  it('uses provided capabilities when creating state for missing session', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, 'new-session',
      (state) => state,
      {
        capabilities: {
          capabilitiesVersion: 'cap-v12',
          allAvailableTools: [],
          recommendedToolsForAgent: ['tool.fs.read'],
          defaultEnabledTools: ['tool.fs.read', 'tool.remote-search'],
          toolSelectionMode: 'recommendation-only',
        },
      },
    )

    expect(updated['new-session'].composerDraft.enabledTools).toEqual(['tool.fs.read', 'tool.remote-search'])
  })

  it('ignores empty sessionId', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const updated = updateCopilotThreadRuntimeControllerStateRecord(
      record, '',
      () => {
        throw new Error('should not be called')
      },
    )

    expect(updated).toBe(record)
  })
})

describe('syncCopilotThreadRuntimeControllerStateRecord', () => {
  it('adds new sessions from sessionShells', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}

    const shells = [
      createSessionShell({ sessionId: 's1' }),
      createSessionShell({ sessionId: 's2' }),
    ]

    const synced = syncCopilotThreadRuntimeControllerStateRecord(record, shells)

    expect(Object.keys(synced)).toHaveLength(2)
    expect(synced['s1'].sessionId).toBe('s1')
    expect(synced['s2'].sessionId).toBe('s2')
  })

  it('removes sessions not in sessionShells', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' })),
      's2': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's2' })),
    }

    const shells = [createSessionShell({ sessionId: 's1' })]

    const synced = syncCopilotThreadRuntimeControllerStateRecord(record, shells)

    expect(Object.keys(synced)).toEqual(['s1'])
  })

  it('preserves existing sessions', () => {
    const existing = createCopilotThreadRuntimeControllerState(
      createSessionShell({ sessionId: 's1' }),
    )
    existing.historyRebindAcknowledged = true
    const record: Record<string, CopilotThreadRuntimeControllerState> = { 's1': existing }

    const synced = syncCopilotThreadRuntimeControllerStateRecord(record, [
      createSessionShell({ sessionId: 's1' }),
    ])

    expect(synced['s1'].historyRebindAcknowledged).toBe(true)
  })

  it('returns same reference when nothing changes', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' })),
    }

    const synced = syncCopilotThreadRuntimeControllerStateRecord(record, [
      createSessionShell({ sessionId: 's1' }),
    ])

    expect(synced).toBe(record)
  })

  it('handles empty sessionShells', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {
      's1': createCopilotThreadRuntimeControllerState(createSessionShell({ sessionId: 's1' })),
    }

    const synced = syncCopilotThreadRuntimeControllerStateRecord(record, [])

    expect(Object.keys(synced)).toEqual([])
  })

  it('uses provided createdAt for new sessions', () => {
    const record: Record<string, CopilotThreadRuntimeControllerState> = {}
    const createdAt = 5000

    const synced = syncCopilotThreadRuntimeControllerStateRecord(
      record,
      [createSessionShell({ sessionId: 'ns' })],
      { createdAt },
    )

    expect(synced['ns'].lastAccessedAt).toBe(5000)
  })
})
