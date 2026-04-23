/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { renderWithRoot, waitForNextFrame } from '../settings/test-support/SettingsWorkspaceTestSupport'
import { useManagedRuntime } from './use-managed-runtime'

function ManagedRuntimeProbe({ enabled }: { enabled: boolean }) {
  const state = useManagedRuntime(enabled)

  return (
    <div>
      <span data-testid="managed-runtime-error">{state.error ?? ''}</span>
      <span data-testid="managed-runtime-loading">{String(state.loading)}</span>
      <span data-testid="managed-runtime-busy">{String(state.busy)}</span>
      <span data-testid="managed-runtime-has-snapshot">{String(state.snapshot !== null)}</span>
      <button type="button" onClick={() => void state.refresh()}>refresh</button>
    </div>
  )
}

describe('useManagedRuntime', () => {
  it('returns a structured failure when preload is unavailable instead of throwing', async () => {
    Reflect.deleteProperty(window, 'managedRuntime')

    const rendered = renderWithRoot(<ManagedRuntimeProbe enabled />)

    await act(async () => {
      await waitForNextFrame()
      await Promise.resolve()
    })

    expect(rendered.getByTestId('managed-runtime-error').textContent).toBe(
      'window.managedRuntime is unavailable in the renderer process.',
    )
    expect(rendered.getByTestId('managed-runtime-loading').textContent).toBe('false')
    expect(rendered.getByTestId('managed-runtime-busy').textContent).toBe('false')
    expect(rendered.getByTestId('managed-runtime-has-snapshot').textContent).toBe('false')

    rendered.unmount()
  })
})
