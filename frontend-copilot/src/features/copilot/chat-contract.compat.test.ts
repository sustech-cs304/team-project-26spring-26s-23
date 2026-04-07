import { describe, expect, it } from 'vitest'

import * as chatContractCompat from './chat-contract'
import * as threadRunContract from './thread-run-contract'

describe('chat contract exports', () => {
  it('re-exports the canonical thread/run transport helpers without a second implementation layer', () => {
    expect(chatContractCompat.listRuntimeAgents).toBe(threadRunContract.listRuntimeAgents)
    expect(chatContractCompat.createRuntimeThread).toBe(threadRunContract.createRuntimeThread)
    expect(chatContractCompat.getRuntimeThread).toBe(threadRunContract.getRuntimeThread)
    expect(chatContractCompat.getRuntimeCapabilities).toBe(threadRunContract.getRuntimeCapabilities)
    expect(chatContractCompat.getRuntimeThinkingCapability).toBe(threadRunContract.getRuntimeThinkingCapability)
    expect(chatContractCompat.startRuntimeRun).toBe(threadRunContract.startRuntimeRun)
    expect(chatContractCompat.streamRuntimeRun).toBe(threadRunContract.streamRuntimeRun)
    expect(chatContractCompat.cancelRuntimeRun).toBe(threadRunContract.cancelRuntimeRun)
  })
})
