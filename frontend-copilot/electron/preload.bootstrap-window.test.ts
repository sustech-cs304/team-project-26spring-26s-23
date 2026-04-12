import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from './bootstrap-window'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload bootstrap window bridge', () => {
  it('routes bootstrap ready notifications through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const bootstrapWindowApi = getExposedApi<BootstrapWindowApi>('bootstrapWindow')

    await bootstrapWindowApi.signalBootstrapScreenReady()

    expect(invokeMock.mock.calls).toEqual([
      [BOOTSTRAP_WINDOW_READY_CHANNEL],
    ])
  })
})
