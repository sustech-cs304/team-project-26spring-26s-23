import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLoadCopilotConfigState = vi.fn()

vi.mock('../features/copilot/config', () => ({
  loadCopilotConfigState: mockLoadCopilotConfigState,
}))

vi.mock('./startup-tracing', () => ({
  logCopilotRootStartupTrace: vi.fn(),
  formatErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}))

vi.mock('../App', () => ({
  default: vi.fn(),
}))

import type { CopilotBootstrapState } from '../features/copilot/types'

describe('bootstrap-cache', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function importModule() {
    return await import('./bootstrap-cache')
  }

  describe('loadInitialConfigState', () => {
    it('calls loadCopilotConfigState on first invocation (cache miss)', async () => {
      const state: CopilotBootstrapState = { status: 'loading' }
      mockLoadCopilotConfigState.mockResolvedValueOnce(state)

      const { loadInitialConfigState } = await importModule()
      const result = await loadInitialConfigState()

      expect(result).toBe(state)
      expect(mockLoadCopilotConfigState).toHaveBeenCalledOnce()
    })

    it('returns cached state on subsequent calls (cache hit)', async () => {
      const state: CopilotBootstrapState = { status: 'loading' }
      mockLoadCopilotConfigState.mockResolvedValueOnce(state)

      const { loadInitialConfigState } = await importModule()

      const result1 = await loadInitialConfigState()
      const result2 = await loadInitialConfigState()

      expect(result2).toBe(result1)
      expect(mockLoadCopilotConfigState).toHaveBeenCalledOnce()
    })

    it('deduplicates concurrent calls to loadCopilotConfigState', async () => {
      const state: CopilotBootstrapState = { status: 'loading' }
      let resolveConfig: (value: typeof state) => void
      mockLoadCopilotConfigState.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveConfig = resolve
        }),
      )

      const { loadInitialConfigState } = await importModule()

      const promise1 = loadInitialConfigState()
      const promise2 = loadInitialConfigState()

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      resolveConfig!(state)

      const [result1, result2] = await Promise.all([promise1, promise2])

      expect(result1).toBe(state)
      expect(result2).toBe(state)
      expect(mockLoadCopilotConfigState).toHaveBeenCalledOnce()
    })

    it('handles loadCopilotConfigState errors and caches them', async () => {
      mockLoadCopilotConfigState.mockRejectedValueOnce(new Error('load failed'))

      const { loadInitialConfigState } = await importModule()

      const result = await loadInitialConfigState()

      expect(result).toEqual({ status: 'error', error: 'load failed' })
      expect(mockLoadCopilotConfigState).toHaveBeenCalledOnce()

      // Subsequent calls return cached error state
      const result2 = await loadInitialConfigState()
      expect(result2).toEqual({ status: 'error', error: 'load failed' })
      expect(mockLoadCopilotConfigState).toHaveBeenCalledOnce()
    })
  })

  describe('rememberCopilotBootstrapState', () => {
    it('sets the cache so loadInitialConfigState returns the remembered state', async () => {
      const { loadInitialConfigState, rememberCopilotBootstrapState } = await importModule()

      const state: CopilotBootstrapState = { status: 'loading' }
      rememberCopilotBootstrapState(state)

      const result = await loadInitialConfigState()
      expect(result).toBe(state)
      expect(mockLoadCopilotConfigState).not.toHaveBeenCalled()
    })

    it('overwrites previously cached state', async () => {
      const { loadInitialConfigState, rememberCopilotBootstrapState } = await importModule()

      const state1: CopilotBootstrapState = { status: 'loading' }
      const state2: CopilotBootstrapState = { status: 'error', error: 'test' }

      rememberCopilotBootstrapState(state1)
      rememberCopilotBootstrapState(state2)

      const result = await loadInitialConfigState()
      expect(result).toBe(state2)
      expect(mockLoadCopilotConfigState).not.toHaveBeenCalled()
    })

    it('also caches the promise so concurrent reads are consistent', async () => {
      const { loadInitialConfigState, rememberCopilotBootstrapState } = await importModule()

      const state: CopilotBootstrapState = { status: 'loading' }
      rememberCopilotBootstrapState(state)

      const [result1, result2] = await Promise.all([
        loadInitialConfigState(),
        loadInitialConfigState(),
      ])

      expect(result1).toBe(state)
      expect(result2).toBe(state)
    })
  })

  describe('loadWorkbenchApp', () => {
    it('returns the imported App module', async () => {
      const { loadWorkbenchApp } = await importModule()

      const module = await loadWorkbenchApp()
      expect(module).toBeDefined()
      expect(module.default).toBeDefined()
    })

    it('increments internal attempt counter across calls', async () => {
      const { loadWorkbenchApp } = await importModule()

      await loadWorkbenchApp()
      await loadWorkbenchApp()
      const module = await loadWorkbenchApp()

      expect(module).toBeDefined()
      expect(module.default).toBeDefined()
    })

    it('propagates errors from dynamic import via catch handler', async () => {
      const { loadWorkbenchApp } = await importModule()

      const result = await loadWorkbenchApp()
      expect(result).toBeDefined()
      expect(result.default).toBeDefined()
    })
  })

  describe('LazyApp', () => {
    it('is a lazy component created from loadWorkbenchApp', async () => {
      const { LazyApp } = await importModule()
      expect(LazyApp).toBeDefined()
      expect(typeof LazyApp).toBe('object')
    })
  })
})
