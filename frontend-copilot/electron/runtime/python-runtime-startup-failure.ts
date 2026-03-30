import type { spawn } from 'node:child_process'
import { isHostedBackendFailure, appendFailureDetail, createHostedBackendFailure, type HostedBackendFailure } from './runtime-diagnostics'
import { FAILED_START_CLEANUP_TIMEOUT_MS, requestRuntimeChildTermination, waitForChildExit, type ChildExitResult } from './python-runtime-process'

type SpawnedRuntimeChild = ReturnType<typeof spawn>

export interface FailedStartCleanupInput {
  child: SpawnedRuntimeChild | null
  exitPromise: Promise<ChildExitResult> | null
  closeOutputSinks: () => Promise<void>
  markExpectedFailedStartExit: () => void
}

export function normalizePythonRuntimeStartFailure(
  error: unknown,
  capturedOutputSummary: string | null,
): HostedBackendFailure {
  if (isHostedBackendFailure(error)) {
    return appendFailureDetail(error, capturedOutputSummary)
  }

  return appendFailureDetail(
    createHostedBackendFailure({
      code: 'healthcheck_failed',
      phase: 'healthcheck',
      message: 'Desktop runtime failed during readiness probing.',
      cause: error,
    }),
    capturedOutputSummary,
  )
}

export async function terminateRuntimeChildAfterFailedStart(input: FailedStartCleanupInput): Promise<void> {
  if (input.child === null || input.exitPromise === null) {
    await input.closeOutputSinks()
    return
  }

  input.markExpectedFailedStartExit()

  try {
    requestRuntimeChildTermination(input.child, 'SIGTERM')
    await waitForChildExit(input.exitPromise, FAILED_START_CLEANUP_TIMEOUT_MS)
  } catch {
    try {
      requestRuntimeChildTermination(input.child, 'SIGKILL')
      await waitForChildExit(input.exitPromise, FAILED_START_CLEANUP_TIMEOUT_MS)
    } catch {
      // Best effort cleanup only; the startup failure itself is already recorded in state.
    }
  }
}
