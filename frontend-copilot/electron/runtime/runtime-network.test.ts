import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { allocateLoopbackPort, DEFAULT_RUNTIME_HOST } from './runtime-config'

describe('allocateLoopbackPort', () => {
  it('returns a loopback port that can be rebound by the hosted runtime', async () => {
    const port = await allocateLoopbackPort()
    const server = createServer()

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, DEFAULT_RUNTIME_HOST, () => {
          resolve()
        })
      })

      const address = server.address()
      expect(address).not.toBeNull()
      expect(typeof address).toBe('object')
      if (address !== null && typeof address !== 'string') {
        expect(address.port).toBe(port)
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    }
  })
})
