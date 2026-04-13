const STARTUP_TRACE_STORAGE_KEY = 'candue:debug:startup-trace'

type StartupTraceStorage = Pick<Storage, 'getItem'>

export interface CopilotStartupTraceOptions {
  isDevelopment?: boolean
  localStorage?: StartupTraceStorage | null
}

export function isCopilotStartupTraceEnabled(options: CopilotStartupTraceOptions = {}): boolean {
  if (options.isDevelopment ?? import.meta.env.DEV) {
    return true
  }

  const localStorage = options.localStorage ?? getStartupTraceLocalStorage()
  return localStorage?.getItem(STARTUP_TRACE_STORAGE_KEY) === '1'
}

export function logCopilotRootStartupTrace(
  stage: string,
  data: Record<string, unknown> = {},
  options: CopilotStartupTraceOptions = {},
) {
  if (!isCopilotStartupTraceEnabled(options)) {
    return
  }

  console.info('[startup]', JSON.stringify({
    scope: 'CopilotAppRoot',
    stage,
    t: Math.round(performance.now()),
    ...data,
  }))
}

function getStartupTraceLocalStorage(): StartupTraceStorage | null {
  try {
    return typeof globalThis === 'object' && 'localStorage' in globalThis
      ? globalThis.localStorage
      : null
  } catch {
    return null
  }
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
