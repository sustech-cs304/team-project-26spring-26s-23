/** @vitest-environment jsdom */

import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { createBootstrapController } from './workbench/settings/test-support/settings-workspace-test-fixtures'
import type { WorkspaceView } from './workbench/types'

vi.mock('./workbench/animation-config', () => ({
  loadAnimationsEnabledPreference: vi.fn(async () => ({ ok: true, animationsEnabled: true })),
  subscribeToAnimationsEnabledPreferenceUpdates: vi.fn(() => () => undefined),
}))

vi.mock('./workbench/theme-config', () => ({
  loadThemeModePreference: vi.fn(async () => ({ ok: false, error: 'theme preference unavailable in test' })),
  persistThemeModePreference: vi.fn(async () => ({ ok: true })),
  subscribeToThemeModePreferenceUpdates: vi.fn(() => () => undefined),
}))

vi.mock('./workbench/settings/workspace-state', () => ({
  loadSettingsWorkspaceState: vi.fn(async () => ({ ok: false, error: 'settings state unavailable in test' })),
}))

vi.mock('./workbench/assistant/AssistantWorkspace', async () => {
  const React = await import('react')

  return {
    AssistantWorkspace: () => React.createElement(
      'section',
      {
        className: 'workspace-stage conversation-workspace',
        'data-testid': 'assistant-workspace',
      },
      'Assistant workspace',
    ),
  }
})

vi.mock('./workbench/capabilities/CapabilitiesWorkspace', async () => {
  const React = await import('react')

  return {
    CapabilitiesWorkspace: () => React.createElement(
      'section',
      {
        className: 'workspace-stage capabilities-workspace',
        'data-testid': 'capabilities-workspace',
      },
      'Capabilities workspace',
    ),
  }
})

vi.mock('./workbench/files/FilesWorkspace', async () => {
  const React = await import('react')

  return {
    FilesWorkspace: () => React.createElement(
      'section',
      {
        className: 'workspace-stage file-workspace',
        'data-testid': 'files-workspace',
      },
      'Files workspace',
    ),
  }
})

vi.mock('./workbench/hub/HubWorkspace', async () => {
  const React = await import('react')

  return {
    HubWorkspace: () => React.createElement(
      'section',
      {
        className: 'workspace-stage hub-workspace',
        'data-testid': 'developer-workspace',
      },
      'Developer workspace',
    ),
  }
})

vi.mock('./workbench/settings/SettingsWorkspace', async () => {
  const React = await import('react')

  return {
    SettingsWorkspace: () => React.createElement(
      'section',
      {
        className: 'workspace-stage settings-workspace',
        'data-testid': 'settings-workspace',
      },
      'Settings workspace',
    ),
  }
})

describe('App workspace transitions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  it('cross-fades top-level workspace switches while preserving visited workspace keep-alive DOM', async () => {
    const rendered = renderWithRoot(<App bootstrap={createBootstrapController()} />)
    await flushLazyWorkspaces()

    expect(getWorkspaceFrame(rendered.container, 'assistant').className).toContain('workbench-view--active')

    await clickRailButton(rendered.container, '能力')

    const assistantFrame = getWorkspaceFrame(rendered.container, 'assistant')
    const capabilitiesFrame = getWorkspaceFrame(rendered.container, 'capabilities')

    expect(assistantFrame.hidden).toBe(false)
    expect(assistantFrame.className).toContain('workbench-view--exiting')
    expect(assistantFrame.getAttribute('aria-hidden')).toBe('true')
    expect(capabilitiesFrame.hidden).toBe(false)
    expect(capabilitiesFrame.className).toContain('workbench-view--active')
    expect(capabilitiesFrame.getAttribute('aria-hidden')).toBe('false')

    await advanceTimersByTime(180)

    expect(assistantFrame.hidden).toBe(true)
    expect(rendered.container.querySelector('[data-testid="assistant-workspace"]')).not.toBeNull()
    expect(capabilitiesFrame.hidden).toBe(false)

    rendered.unmount()
  })
})

function renderWithRoot(element: ReactElement) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let root: Root | null = null

  act(() => {
    root = createRoot(container)
    root.render(element)
  })

  return {
    container,
    unmount() {
      if (root === null) {
        return
      }

      act(() => {
        root?.unmount()
      })
      root = null
      container.remove()
    },
  }
}

async function flushLazyWorkspaces() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

async function clickRailButton(container: HTMLElement, label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing rail button: ${label}`)
  }

  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

async function advanceTimersByTime(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
  })
}

function getWorkspaceFrame(container: HTMLElement, view: WorkspaceView): HTMLDivElement {
  const frame = container.querySelector(`[data-workspace-view="${view}"]`)

  if (!(frame instanceof HTMLDivElement)) {
    throw new Error(`Missing workspace frame: ${view}`)
  }

  return frame
}
