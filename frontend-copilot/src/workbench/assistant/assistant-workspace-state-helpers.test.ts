import { describe, expect, it } from 'vitest'

import { enhanceRuntimeAgents } from '../config'
import { createAssistantSessionShell } from './assistant-workspace-controller'
import {
  createAssistantRenderedSessionState,
  createAssistantSessionContextMenuState,
} from './assistant-workspace-state-helpers'
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
    response: createSessionResponse({ sessionId }),
    selectedAgent,
    capabilities: createCapabilitiesResponse({ sessionId }),
  })
}

describe('assistant-workspace-state-helpers', () => {
  it('builds session context menu state from session shell metadata', () => {
    const sessionShell = createAssistantSessionShell({
      response: createSessionResponse(),
      selectedAgent: getSelectedAgent(),
      capabilities: createCapabilitiesResponse(),
    })

    expect(createAssistantSessionContextMenuState({
      sessionEntry: sessionShell,
      x: 320,
      y: 240,
    })).toEqual({
      sessionId: 'session-1',
      sessionLabel: '通用智能体',
      x: 320,
      y: 240,
      activeSubmenu: null,
    })
  })

  it('derives rendered sessions and drag preview state from the current drag snapshot', () => {
    const firstSession = createSessionShellFixture('session-1')
    const secondSession = createSessionShellFixture('session-2')
    const thirdSession = createSessionShellFixture('session-3')

    expect(createAssistantRenderedSessionState({
      sessions: [thirdSession, secondSession, firstSession],
      sessionDragState: {
        draggingSessionId: 'session-2',
        previewIndex: 9,
      },
    })).toEqual({
      renderedSessions: [thirdSession, firstSession],
      dragPreviewIndex: 2,
      draggingSessionShell: secondSession,
    })
  })

  it('returns the full session list and no preview metadata when no drag snapshot exists', () => {
    const firstSession = createSessionShellFixture('session-1')
    const secondSession = createSessionShellFixture('session-2')

    expect(createAssistantRenderedSessionState({
      sessions: [secondSession, firstSession],
      sessionDragState: null,
    })).toEqual({
      renderedSessions: [secondSession, firstSession],
      dragPreviewIndex: null,
      draggingSessionShell: null,
    })
  })
})
