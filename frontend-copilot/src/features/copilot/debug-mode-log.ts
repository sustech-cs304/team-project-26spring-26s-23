import type { CopilotBootstrapState } from './types'

export function isCopilotDebugModeEnabled(state: CopilotBootstrapState): boolean {
  return 'bootstrapFields' in state && state.bootstrapFields.debugModeEnabled === true
}

export function appendCopilotDebugLog(
  enabled: boolean,
  scope: string,
  event: string,
  context: Record<string, unknown> = {},
): void {
  if (!enabled) {
    return
  }

  console.debug('[copilot-debug]', {
    scope,
    event,
    ...context,
  })
}
