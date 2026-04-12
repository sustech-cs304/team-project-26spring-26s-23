import type { HostedBackendFailure } from './runtime-diagnostics'
import { createHostedBackendFailure } from './runtime-diagnostics'
import { ensureHostedRuntimeDirectories, type HostedRuntimePaths } from './runtime-paths'

export async function prepareRuntimePaths(paths: HostedRuntimePaths): Promise<void> {
  await ensureHostedRuntimeDirectories(paths)
}

export function createPrepareRuntimePathsFailure(error: unknown): HostedBackendFailure {
  return createHostedBackendFailure({
    code: 'runtime_resolution_failed',
    phase: 'configure',
    message: 'Failed to prepare runtime directories for the desktop backend.',
    cause: error,
    retryable: false,
  })
}
