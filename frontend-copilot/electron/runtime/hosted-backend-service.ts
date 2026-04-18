import type { HostedBackendFailure } from './runtime-diagnostics'
import { createPythonRuntimeManager, type PythonRuntimeManagerOptions } from './python-runtime-manager'
import type { HostedBackendState } from './runtime-state'

export interface HostedBackendService {
  start(): Promise<HostedBackendState>
  stop(): Promise<void>
  getState(): HostedBackendState
  getLastFailure(): HostedBackendFailure | null
  getRuntimeBaseUrl(): string | null
  getLocalToken(): string | null
}

export function createHostedBackendService(options: PythonRuntimeManagerOptions): HostedBackendService {
  const manager = createPythonRuntimeManager(options)

  return {
    start() {
      return manager.start()
    },
    stop() {
      return manager.stop()
    },
    getState() {
      return manager.getState()
    },
    getLastFailure() {
      return manager.getLastFailure()
    },
    getRuntimeBaseUrl() {
      return manager.getRuntimeBaseUrl()
    },
    getLocalToken() {
      return manager.getLocalToken()
    },
  }
}
