import { describe, expect, it } from 'vitest'
import {
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
  type ManagedRuntimeApi,
} from './managed-runtime/ipc'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload managed runtime bridge', () => {
  it('routes managed runtime snapshot loading through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const managedRuntimeApi = getExposedApi<ManagedRuntimeApi>('managedRuntime')
    await managedRuntimeApi.load()

    expect(invokeMock.mock.calls).toEqual([
      [MANAGED_RUNTIME_LOAD_CHANNEL],
    ])
  })

  it('routes managed runtime install or repair through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const managedRuntimeApi = getExposedApi<ManagedRuntimeApi>('managedRuntime')
    await managedRuntimeApi.installOrRepair('repair')

    expect(invokeMock.mock.calls).toEqual([
      [MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL, 'repair'],
    ])
  })
})
