/** @vitest-environment jsdom */

import { act, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  retryCopilotConfigState: vi.fn(),
  loadCopilotConfigStateFromPublicSnapshot: vi.fn(),
  subscribeToConfigCenterPublicSnapshotUpdates: vi.fn(),
  loadInitialConfigState: vi.fn(),
  loadWorkbenchApp: vi.fn(),
  rememberCopilotBootstrapState: vi.fn(),
  logCopilotRootStartupTrace: vi.fn(),
  formatErrorMessage: vi.fn(
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  ),
}))

vi.mock('../features/copilot/config', () => ({
  loadCopilotConfigStateFromPublicSnapshot: mocks.loadCopilotConfigStateFromPublicSnapshot,
  retryCopilotConfigState: mocks.retryCopilotConfigState,
}))

vi.mock('../features/copilot/config-center', () => ({
  subscribeToConfigCenterPublicSnapshotUpdates: mocks.subscribeToConfigCenterPublicSnapshotUpdates,
}))

vi.mock('./bootstrap-cache', () => ({
  loadInitialConfigState: mocks.loadInitialConfigState,
  loadWorkbenchApp: mocks.loadWorkbenchApp,
  rememberCopilotBootstrapState: mocks.rememberCopilotBootstrapState,
}))

vi.mock('./startup-tracing', () => ({
  logCopilotRootStartupTrace: mocks.logCopilotRootStartupTrace,
  formatErrorMessage: mocks.formatErrorMessage,
}))

import { useCopilotBootstrapState } from './bootstrap-state'
import type { CopilotBootstrapState } from '../features/copilot/types'
import { createReadyBootstrapState } from './bootstrap-test-support'

const LABEL_HTTP_LOCALHOST_4400 = 'http://localhost:4400'

describe('useCopilotBootstrapState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.subscribeToConfigCenterPublicSnapshotUpdates.mockReturnValue(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function render() {
    return renderHook(() => useCopilotBootstrapState())
  }

  describe('initial load', () => {
    it('starts with loading state', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))

      const { result, unmount } = render()

      expect(result.current.configState).toEqual({ status: 'loading' })
      expect(result.current.bootstrap.state).toEqual({ status: 'loading' })
      expect(result.current.retrying).toBe(false)

      unmount()
    })

    it('calls loadWorkbenchApp and loadInitialConfigState on mount', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { unmount } = render()

      expect(mocks.loadWorkbenchApp).toHaveBeenCalledOnce()
      expect(mocks.loadInitialConfigState).toHaveBeenCalledOnce()
      expect(mocks.logCopilotRootStartupTrace).toHaveBeenCalledWith('root-mounted')

      unmount()
    })

    it('logs root-unmounted on unmount', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { unmount } = render()
      unmount()

      expect(mocks.logCopilotRootStartupTrace).toHaveBeenCalledWith('root-unmounted')
    })
  })

  describe('loading → ready transition', () => {
    it('transitions to ready state when initial config load succeeds', async () => {
      const readyState = createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      })
      mocks.loadInitialConfigState.mockResolvedValueOnce(readyState)
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('ready')
      })

      expect(result.current.configState).toEqual(readyState)
      expect(result.current.bootstrap.state).toEqual(readyState)
      expect(mocks.rememberCopilotBootstrapState).toHaveBeenCalledWith(readyState)

      unmount()
    })
  })

  describe('loading → error transition', () => {
    it('transitions to error state when initial config load fails', async () => {
      mocks.loadInitialConfigState.mockRejectedValueOnce(new Error('config load failed'))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('error')
      })

      expect(result.current.configState).toEqual({
        status: 'error',
        error: 'config load failed',
      })
      expect(mocks.rememberCopilotBootstrapState).toHaveBeenCalled()

      unmount()
    })

    it('returns bootstrap.controller with retry callback', async () => {
      mocks.loadInitialConfigState.mockRejectedValueOnce(new Error('config load failed'))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('error')
      })

      expect(result.current.bootstrap.retry).toBe(result.current.handleRetryConfig)
      expect(result.current.handleRetryConfig).toBeTypeOf('function')

      unmount()
    })
  })

  describe('retry', () => {
    it('sets retrying flag and calls retryCopilotConfigState', async () => {
      mocks.loadInitialConfigState.mockRejectedValueOnce(new Error('first fail'))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('error')
      })

      const readyState = createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      })
      mocks.retryCopilotConfigState.mockResolvedValueOnce(readyState)

      await act(async () => {
        result.current.handleRetryConfig()
      })

      expect(mocks.retryCopilotConfigState).toHaveBeenCalledOnce()
      expect(result.current.retrying).toBe(false)
      expect(result.current.configState).toEqual(readyState)

      unmount()
    })

    it('handles retry failure and sets retrying back to false', async () => {
      mocks.loadInitialConfigState.mockRejectedValueOnce(new Error('first fail'))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('error')
      })

      mocks.retryCopilotConfigState.mockRejectedValueOnce(new Error('retry failed'))

      await act(async () => {
        result.current.handleRetryConfig()
      })

      expect(result.current.retrying).toBe(false)
      expect(result.current.configState).toEqual({
        status: 'error',
        error: 'retry failed',
      })

      unmount()
    })

    it('disables retry button via retrying flag during retry', async () => {
      mocks.loadInitialConfigState.mockRejectedValueOnce(new Error('first fail'))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      await waitFor(() => {
        expect(result.current.configState.status).toBe('error')
      })

      expect(result.current.retrying).toBe(false)

      let resolveRetry: (value: CopilotBootstrapState) => void
      mocks.retryCopilotConfigState.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRetry = resolve
        }),
      )

      act(() => {
        result.current.handleRetryConfig()
      })

      expect(result.current.retrying).toBe(true)
      expect(result.current.bootstrap.retrying).toBe(true)

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await act(async () => resolveRetry!(createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      })))

      expect(result.current.retrying).toBe(false)

      unmount()
    })
  })

  describe('config update subscription', () => {
    it('subscribes to public snapshot updates on mount', () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { unmount } = render()

      expect(mocks.subscribeToConfigCenterPublicSnapshotUpdates).toHaveBeenCalledOnce()
      expect(mocks.subscribeToConfigCenterPublicSnapshotUpdates).toHaveBeenCalledWith(expect.any(Function))

      unmount()
    })

    it('unsubscribes on unmount', () => {
      const unsubscribe = vi.fn()
      mocks.subscribeToConfigCenterPublicSnapshotUpdates.mockReturnValue(unsubscribe)
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { unmount } = render()
      unmount()

      expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('applies state from snapshot updates', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      const listener = mocks.subscribeToConfigCenterPublicSnapshotUpdates.mock.calls[0]?.[0] as
        | ((snapshot: unknown) => void)
        | undefined

      expect(listener).toBeDefined()

      const updatedState = createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        agentName: 'planner',
      })
      mocks.loadCopilotConfigStateFromPublicSnapshot.mockResolvedValueOnce(updatedState)

      const snapshot = {
        version: 1,
        domains: {
          frontendPreferences: { theme: 'dark' as const, animationsEnabled: true },
          assistantBehavior: { agentName: 'planner', debugModeEnabled: false },
          hostConfig: { runtimeUrl: LABEL_HTTP_LOCALHOST_4400 },
          backendExposed: { model: 'gpt-4' },
          general: { language: 'zh-CN' },
        },
      }

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await listener!(snapshot)
      })

      expect(mocks.loadCopilotConfigStateFromPublicSnapshot).toHaveBeenCalledWith(snapshot)
      expect(result.current.configState).toEqual(updatedState)
      expect(mocks.rememberCopilotBootstrapState).toHaveBeenCalledWith(updatedState)

      unmount()
    })

    it('handles snapshot update errors gracefully', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      const listener = mocks.subscribeToConfigCenterPublicSnapshotUpdates.mock.calls[0]?.[0] as
        | ((snapshot: unknown) => void)
        | undefined

      expect(listener).toBeDefined()

      mocks.loadCopilotConfigStateFromPublicSnapshot.mockRejectedValueOnce(new Error('snapshot error'))

      const snapshot = {
        version: 1,
        domains: {
          frontendPreferences: { theme: 'dark' as const, animationsEnabled: true },
          assistantBehavior: { agentName: null, debugModeEnabled: false },
          hostConfig: { runtimeUrl: null },
          backendExposed: { model: null },
          general: { language: 'zh-CN' },
        },
      }

      await act(async () => {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        await listener!(snapshot)
      })

      expect(result.current.configState).toEqual({
        status: 'error',
        error: 'snapshot error',
      })

      unmount()
    })

    it('ignores snapshot updates after unmount', async () => {
      let disposedDuringApply = false
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { unmount } = render()

      const listener = mocks.subscribeToConfigCenterPublicSnapshotUpdates.mock.calls[0]?.[0] as
        | ((snapshot: unknown) => void)
        | undefined

      expect(listener).toBeDefined()

      const updatedState = createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      })
      mocks.loadCopilotConfigStateFromPublicSnapshot.mockImplementation(async () => {
        disposedDuringApply = true
        return updatedState
      })

      unmount()

      const snapshot = {
        version: 1,
        domains: {
          frontendPreferences: { theme: 'dark' as const, animationsEnabled: true },
          assistantBehavior: { agentName: null, debugModeEnabled: false },
          hostConfig: { runtimeUrl: LABEL_HTTP_LOCALHOST_4400 },
          backendExposed: { model: null },
          general: { language: 'zh-CN' },
        },
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await listener!(snapshot)

      expect(disposedDuringApply).toBe(true)
    })
  })

  describe('bootstrap controller', () => {
    it('exposes state, retrying flag, and retry method', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { result, unmount } = render()

      expect(result.current.bootstrap.state).toBe(result.current.configState)
      expect(result.current.bootstrap.retrying).toBe(result.current.retrying)
      expect(result.current.bootstrap.retry).toBe(result.current.handleRetryConfig)

      unmount()
    })

    it('controller updates when config state changes', async () => {
      mocks.loadInitialConfigState.mockReturnValue(new Promise(() => {}))
      mocks.loadWorkbenchApp.mockResolvedValue({ default: vi.fn() })

      const { rerender, unmount } = render()

      const readyState = createReadyBootstrapState({
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      })
      mocks.loadInitialConfigState.mockResolvedValueOnce(readyState)

      await act(async () => {
        rerender()
      })

      unmount()
    })
  })
})
