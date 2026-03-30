import { afterEach, vi } from 'vitest'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const hasDomEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined'

if (hasDomEnvironment) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()

  if (!hasDomEnvironment) {
    return
  }

  delete (window as Partial<Window>).settingsWorkspaceState
  delete (window as Partial<Window>).settingsWorkspaceSecrets
})

export {}
