/** @vitest-environment jsdom */

import { afterAll, afterEach, beforeAll, vi } from 'vitest'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  delete (window as Partial<Window>).settingsWorkspaceState
  delete (window as Partial<Window>).settingsWorkspaceSecrets
})

export {
  installSettingsWorkspaceBridge,
} from './settings-workspace-test-bridge'
export {
  blurElement,
  clickElement,
  contextMenuElement,
  flushAsyncEffects,
  focusElement,
  mockButtonRect,
  mockClipboardWriteText,
  mockListItemRect,
  renderSettingsWorkspace,
  renderWithRoot,
  setFormControlValue,
  waitForNextFrame,
} from './settings-workspace-test-dom'
export {
  createBootstrapController,
  createPersistedSecretStatesResult,
  createPersistedWorkspaceState,
  createProviderProfile,
  createSingleProviderWorkspaceState,
} from './settings-workspace-test-fixtures'
