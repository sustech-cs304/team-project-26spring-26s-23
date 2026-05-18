import { describe, expect, it } from 'vitest'

import { enhanceRuntimeAgents } from '../config'
import { createAssistantSessionShell } from './assistant-workspace-controller'
import {
  appendAssistantSessionShell,
  clampAssistantSessionPreviewIndex,
  createAssistantSessionListState,
  filterDraggedSessionFromRender,
  moveAssistantSessionShellToIndex,
  removeAssistantSessionShell,
  renameAssistantSessionShell,
  reorderAssistantSessionShells,
  resolveActiveAssistantSessionShell,
  resolveAssistantSessionTitle,
} from './assistant-session-helpers'
import {
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
} from './assistant-workspace-test-fixtures'

function getSelectedAgent() {
  const selectedAgent = enhanceRuntimeAgents(createDirectoryResponse().agents)[0]

  if (!selectedAgent) {
    throw new Error('Expected seeded agent.')
  }

  return selectedAgent
}

function createSessionShellFixture(sessionId: string) {
  const selectedAgent = getSelectedAgent()

  return createAssistantSessionShell({
    response: createSessionResponse({ threadId: sessionId }),
    selectedAgent,
    capabilities: createCapabilitiesResponse({ sessionId }),
  })
}

describe('assistant-session-helpers', () => {
  it('appends newly created sessions to the session list and switches the active session to the newest entry', () => {
    const selectedAgent = getSelectedAgent()
    const firstSession = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent,
      capabilities: createCapabilitiesResponse(),
    })
    const nextSession = createAssistantSessionShell({
      response: createSessionResponse({
        threadId: 'session-2',
        createdAt: '2026-03-27T10:05:00Z',
        updatedAt: '2026-03-27T10:05:00Z',
      }),
      selectedAgent,
      capabilities: createCapabilitiesResponse({
        sessionId: 'session-2',
        capabilitiesVersion: 'cap-v13',
      }),
    })

    const nextState = appendAssistantSessionShell(
      createAssistantSessionListState(firstSession),
      nextSession,
    )

    expect(nextState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-2', 'session-1'])
    expect(nextState.activeSessionId).toBe('session-2')
    expect(resolveActiveAssistantSessionShell(nextState)?.sessionId).toBe('session-2')
  })

  it('reorders sessions when a dragged session moves onto another session slot', () => {
    const reordered = reorderAssistantSessionShells({
      sessions: [
        createSessionShellFixture('session-3'),
        createSessionShellFixture('session-2'),
        createSessionShellFixture('session-1'),
      ],
      activeSessionId: 'session-2',
    }, 'session-1', 'session-3')

    expect(reordered.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1', 'session-3', 'session-2'])
    expect(reordered.activeSessionId).toBe('session-2')
  })

  it('supports moving a dragged session to the top and bottom insertion indexes', () => {
    const initialState = {
      sessions: [
        createSessionShellFixture('session-3'),
        createSessionShellFixture('session-2'),
        createSessionShellFixture('session-1'),
      ],
      activeSessionId: 'session-2',
    }

    const movedToTop = moveAssistantSessionShellToIndex(initialState, 'session-1', 0)
    expect(movedToTop.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1', 'session-3', 'session-2'])

    const movedToBottom = moveAssistantSessionShellToIndex(initialState, 'session-3', 3)
    expect(movedToBottom.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-2', 'session-1', 'session-3'])
    expect(movedToBottom.activeSessionId).toBe('session-2')
  })

  it('filters the dragged session out of the rendered list and clamps preview indexes into valid bounds', () => {
    const sessions = [
      createSessionShellFixture('session-3'),
      createSessionShellFixture('session-2'),
      createSessionShellFixture('session-1'),
    ]

    expect(filterDraggedSessionFromRender(sessions, 'session-2').map((sessionItem) => sessionItem.sessionId)).toEqual([
      'session-3',
      'session-1',
    ])
    expect(clampAssistantSessionPreviewIndex(9, 2)).toBe(2)
    expect(clampAssistantSessionPreviewIndex(-1, 2)).toBe(0)
  })

  it('renames a session without disturbing the active session selection and resolves fallback titles', () => {
    const initialState = {
      sessions: [createSessionShellFixture('session-2'), createSessionShellFixture('session-1')],
      activeSessionId: 'session-1',
    }

    const renamedState = renameAssistantSessionShell(initialState, 'session-2', '  Blackboard 草稿  ')

    expect(resolveAssistantSessionTitle(renamedState.sessions[0]!)).toBe('Blackboard 草稿')
    expect(resolveAssistantSessionTitle(renamedState.sessions[1]!)).toBe('新话题')
    expect(renamedState.activeSessionId).toBe('session-1')
  })

  it('removes sessions and clears the active session instead of auto-selecting another entry', () => {
    const initialState = {
      sessions: [createSessionShellFixture('session-2'), createSessionShellFixture('session-1')],
      activeSessionId: 'session-2',
    }

    const nextState = removeAssistantSessionShell(initialState, 'session-2')

    expect(nextState.sessions.map((sessionItem) => sessionItem.sessionId)).toEqual(['session-1'])
    expect(nextState.activeSessionId).toBeNull()
  })
})
