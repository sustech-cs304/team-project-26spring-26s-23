import { afterEach, vi } from 'vitest'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const hasDomEnvironment = typeof window !== 'undefined' && typeof document !== 'undefined'

if (hasDomEnvironment) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
}

const registerVitestCleanup = () => {
  try {
    afterEach(() => {
      vi.useRealTimers()
      vi.restoreAllMocks()

      if (!hasDomEnvironment) {
        return
      }

      delete (window as Partial<Window>).configCenterPublicSnapshot
      delete (window as Partial<Window>).configCenterPublicSnapshotSubscription
      delete (window as Partial<Window>).configCenterPublicPatch
      delete (window as Partial<Window>).settingsWorkspaceState
      delete (window as Partial<Window>).settingsWorkspaceSecrets
    })
  } catch {
    // Ignore contexts where Vitest has not attached a current suite yet.
  }
}

registerVitestCleanup()

export {}
