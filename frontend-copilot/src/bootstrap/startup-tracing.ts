export function logCopilotRootStartupTrace(stage: string, data: Record<string, unknown> = {}) {
  console.info('[startup]', JSON.stringify({
    scope: 'CopilotAppRoot',
    stage,
    t: Math.round(performance.now()),
    ...data,
  }))
}

export function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
