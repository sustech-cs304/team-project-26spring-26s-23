/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it } from 'vitest'

import type { ManagedRuntimeApi } from '../../../electron/managed-runtime/ipc'
import type { ManagedRuntimeSnapshot } from '../../../electron/managed-runtime/types'
import { clickElement, renderWithRoot, waitForNextFrame } from '../settings/test-support/SettingsWorkspaceTestSupport'
import { useManagedRuntime } from './use-managed-runtime'

const OUTDATED_SNAPSHOT: ManagedRuntimeSnapshot = {
  manifestVersion: 1,
  overallStatus: 'outdated',
  target: { platform: 'win32', arch: 'x64' },
  rootDir: 'managed-root',
  hostedRuntimeRootDir: 'hosted-runtime-root',
  families: {
    node: {
      family: 'node',
      status: 'ready',
      pinnedVersion: '22.15.0',
      activeVersion: '22.15.0',
      installRootDir: 'node/install',
      stagingDir: 'node/staging',
      activeDir: 'node/active',
      selectedComponents: [],
      launcherPaths: { npx: 'node/active/npx.cmd' },
      lastInstalledAt: '2026-04-23T00:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: null,
    },
    uv: {
      family: 'uv',
      status: 'outdated',
      pinnedVersion: 'python-3.12.13_uv-0.11.7',
      activeVersion: 'python-3.12.10_uv-0.11.7',
      installRootDir: 'uv/install',
      stagingDir: 'uv/staging',
      activeDir: 'uv/active',
      selectedComponents: [],
      launcherPaths: { uvx: 'uv/active/uvx.exe' },
      lastInstalledAt: '2026-04-22T00:00:00.000Z',
      lastRepairedAt: null,
      lastVerification: null,
      lastErrorSummary: {
        code: 'version_mismatch',
        message: 'Managed runtime is outdated.',
        at: '2026-04-23T00:00:00.000Z',
      },
    },
  },
}

const READY_SNAPSHOT: ManagedRuntimeSnapshot = {
  ...OUTDATED_SNAPSHOT,
  overallStatus: 'ready',
  families: {
    ...OUTDATED_SNAPSHOT.families,
    uv: {
      ...OUTDATED_SNAPSHOT.families.uv,
      status: 'ready',
      activeVersion: 'python-3.12.13_uv-0.11.7',
      lastRepairedAt: '2026-04-23T01:00:00.000Z',
      lastErrorSummary: null,
    },
  },
}

function ManagedRuntimeProbe({ enabled }: { enabled: boolean }) {
  const state = useManagedRuntime(enabled)

  return (
    <div>
      <span data-testid="managed-runtime-error">{state.error ?? ''}</span>
      <span data-testid="managed-runtime-loading">{String(state.loading)}</span>
      <span data-testid="managed-runtime-busy">{String(state.busy)}</span>
      <span data-testid="managed-runtime-has-snapshot">{String(state.snapshot !== null)}</span>
      <span data-testid="managed-runtime-overall-status">{state.snapshot?.overallStatus ?? ''}</span>
      <span data-testid="managed-runtime-uv-status">{state.snapshot?.families.uv.status ?? ''}</span>
      <span data-testid="managed-runtime-uv-version">{state.snapshot?.families.uv.activeVersion ?? ''}</span>
      <button type="button" onClick={() => void state.refresh()}>refresh</button>
      <button type="button" onClick={() => void state.installOrRepair()}>install-or-repair</button>
    </div>
  )
}

function createManagedRuntimeApi(overrides: Partial<ManagedRuntimeApi>): ManagedRuntimeApi {
  return {
    load: async () => ({ ok: true, snapshot: OUTDATED_SNAPSHOT }),
    installOrRepair: async () => ({ ok: true, snapshot: READY_SNAPSHOT }),
    ...overrides,
  }
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

  it('replaces an outdated snapshot when install or repair succeeds with a new snapshot', async () => {
    window.managedRuntime = createManagedRuntimeApi({})

    const rendered = renderWithRoot(<ManagedRuntimeProbe enabled />)

    await act(async () => {
      await waitForNextFrame()
      await Promise.resolve()
    })

    expect(rendered.getByTestId('managed-runtime-overall-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-version').textContent).toBe('python-3.12.10_uv-0.11.7')

    await act(async () => {
      await clickElement(rendered.getByText('install-or-repair'))
      await waitForNextFrame()
      await Promise.resolve()
    })

    expect(rendered.getByTestId('managed-runtime-error').textContent).toBe('')
    expect(rendered.getByTestId('managed-runtime-overall-status').textContent).toBe('ready')
    expect(rendered.getByTestId('managed-runtime-uv-status').textContent).toBe('ready')
    expect(rendered.getByTestId('managed-runtime-uv-version').textContent).toBe('python-3.12.13_uv-0.11.7')

    rendered.unmount()
  })

  it('keeps the previous snapshot and exposes an error when install or repair fails', async () => {
    window.managedRuntime = createManagedRuntimeApi({
      installOrRepair: async () => ({
        ok: false,
        error: 'repair failed',
        code: 'repair_failed',
      }),
    })

    const rendered = renderWithRoot(<ManagedRuntimeProbe enabled />)

    await act(async () => {
      await waitForNextFrame()
      await Promise.resolve()
    })

    expect(rendered.getByTestId('managed-runtime-overall-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-version').textContent).toBe('python-3.12.10_uv-0.11.7')

    await act(async () => {
      await clickElement(rendered.getByText('install-or-repair'))
      await waitForNextFrame()
      await Promise.resolve()
    })

    expect(rendered.getByTestId('managed-runtime-error').textContent).toBe('repair failed')
    expect(rendered.getByTestId('managed-runtime-overall-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-status').textContent).toBe('outdated')
    expect(rendered.getByTestId('managed-runtime-uv-version').textContent).toBe('python-3.12.10_uv-0.11.7')

    rendered.unmount()
  })
})
