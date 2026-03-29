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
})

export {
  createBootstrapController,
  createCapabilitiesResponse,
  createDirectoryResponse,
  createSessionResponse,
} from './assistant-workspace-test-fixtures'
export { renderWithRoot, type RenderedAssistantWorkspace } from './assistant-workspace-test-dom'
export { clickElement, hoverElement, openContextMenu } from './assistant-workspace-test-interactions'
export { createDeferred, type Deferred } from './assistant-workspace-test-async'
