import { createWriteStream, type WriteStream } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import type { SanitizedHostedRuntimeLaunchConfig } from './runtime-config'
import type { HostedBackendFailure } from './runtime-diagnostics'
import { redactSensitiveText, redactSensitiveValue } from './runtime-redaction'
import { sanitizeHostedRuntimePaths, type HostedRuntimePaths } from './runtime-paths'
import type { HostedBackendState } from './runtime-state'

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error'
export type RuntimeLogSource = 'electron-main' | 'python-runtime-manager'

export interface RuntimeLogEntryInput {
  source: RuntimeLogSource
  level: RuntimeLogLevel
  message: string
  context?: unknown
}

export interface HostedRuntimeSnapshot {
  generatedAt: string
  status: HostedBackendState['status']
  paths: ReturnType<typeof sanitizeHostedRuntimePaths>
  launchConfig: SanitizedHostedRuntimeLaunchConfig | null
  state: HostedBackendState
  lastFailure: HostedBackendFailure | null
}

export interface LastFailureRecord {
  updatedAt: string
  status: HostedBackendState['status']
  failure: HostedBackendFailure | null
}

export async function appendRuntimeLog(
  logFilePath: string,
  entry: RuntimeLogEntryInput,
  sensitiveValues: string[] = [],
): Promise<void> {
  const payload = redactSensitiveValue({
    timestamp: new Date().toISOString(),
    source: entry.source,
    level: entry.level,
    message: entry.message,
    context: entry.context,
  }, sensitiveValues)

  await appendFile(logFilePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

export async function writeHostedRuntimeSnapshot(
  snapshotFilePath: string,
  snapshot: HostedRuntimeSnapshot,
  sensitiveValues: string[] = [],
): Promise<void> {
  await writeJsonFile(snapshotFilePath, snapshot, sensitiveValues)
}

export async function writeLastFailureRecord(
  lastFailureFilePath: string,
  record: LastFailureRecord,
  sensitiveValues: string[] = [],
): Promise<void> {
  await writeJsonFile(lastFailureFilePath, record, sensitiveValues)
}

export class RuntimeTextFileSink {
  private readonly stream: WriteStream

  constructor(
    filePath: string,
    private readonly sensitiveValues: string[] = [],
  ) {
    this.stream = createWriteStream(filePath, { flags: 'a' })
  }

  write(chunk: string | Buffer): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    this.stream.write(redactSensitiveText(text, this.sensitiveValues))
  }

  async close(): Promise<void> {
    if (this.stream.closed || this.stream.destroyed) {
      return
    }

    await new Promise<void>((resolve, reject) => {
      const handleFinish = () => {
        cleanup()
        resolve()
      }
      const handleError = (error: Error) => {
        cleanup()
        reject(error)
      }
      const cleanup = () => {
        this.stream.off('finish', handleFinish)
        this.stream.off('error', handleError)
      }

      this.stream.once('finish', handleFinish)
      this.stream.once('error', handleError)
      this.stream.end()
    })
  }
}

async function writeJsonFile(filePath: string, value: unknown, sensitiveValues: string[]): Promise<void> {
  const payload = redactSensitiveValue(value, sensitiveValues)
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

export function buildHostedRuntimeSnapshot(input: {
  paths: HostedRuntimePaths
  launchConfig: SanitizedHostedRuntimeLaunchConfig | null
  state: HostedBackendState
  lastFailure: HostedBackendFailure | null
}): HostedRuntimeSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    status: input.state.status,
    paths: sanitizeHostedRuntimePaths(input.paths),
    launchConfig: input.launchConfig,
    state: input.state,
    lastFailure: input.lastFailure,
  }
}
