import { describe, expect, it } from 'vitest'

import * as chatContractCompat from './chat-contract'
import * as threadRunContract from './thread-run-contract'

describe('chat contract compat shell', () => {
  it('re-exports the thread/run transport helpers without introducing a second implementation layer', () => {
    expect(chatContractCompat.createRuntimeSession).toBe(threadRunContract.createRuntimeSession)
    expect(chatContractCompat.getRuntimeCapabilities).toBe(threadRunContract.getRuntimeCapabilities)
    expect(chatContractCompat.sendRuntimeMessage).toBe(threadRunContract.sendRuntimeMessage)
    expect(chatContractCompat.startRuntimeRun).toBe(threadRunContract.startRuntimeRun)
    expect(chatContractCompat.streamRuntimeRun).toBe(threadRunContract.streamRuntimeRun)
    expect(chatContractCompat.cancelRuntimeRun).toBe(threadRunContract.cancelRuntimeRun)
  })
})
