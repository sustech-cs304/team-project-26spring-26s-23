import type { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export interface ChildExitResult {
  code: number | null
  signal: NodeJS.Signals | null
}

type SpawnedRuntimeChild = ReturnType<typeof spawn>

const MAX_CAPTURED_OUTPUT_LENGTH = 8_000
export const FAILED_START_CLEANUP_TIMEOUT_MS = 1_500

export function requestRuntimeChildTermination(
  child: SpawnedRuntimeChild,
  signal: 'SIGTERM' | 'SIGKILL',
): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    if (process.platform === 'win32') {
      child.kill()
      return
    }

    child.kill(signal)
  } catch {
    // Ignore termination races when the child exits between the liveness check and kill request.
  }
}

export async function waitForChildExit(
  exitPromise: Promise<ChildExitResult>,
  timeoutMs: number,
): Promise<ChildExitResult> {
  return await Promise.race([
    exitPromise,
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out after ${timeoutMs}ms while waiting for the child process to exit.`)
    }),
  ])
}

export function appendCapturedText(current: string, chunk: string | Buffer): string {
  const nextChunk = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
  const combined = `${current}${nextChunk}`

  if (combined.length <= MAX_CAPTURED_OUTPUT_LENGTH) {
    return combined
  }

  return combined.slice(-MAX_CAPTURED_OUTPUT_LENGTH)
}

export function buildCapturedOutputSummary(stdoutOutput: string, stderrOutput: string): string | null {
  const sections: string[] = []

  if (stdoutOutput.trim() !== '') {
    sections.push(`stdout:\n${stdoutOutput.trim()}`)
  }

  if (stderrOutput.trim() !== '') {
    sections.push(`stderr:\n${stderrOutput.trim()}`)
  }

  return sections.length === 0 ? null : sections.join('\n\n')
}
