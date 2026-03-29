import { createServer } from 'node:net'
import { DEFAULT_RUNTIME_HOST } from './runtime-config-flags'

export async function allocateLoopbackPort(host = DEFAULT_RUNTIME_HOST): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()

    server.once('error', (error) => {
      reject(error)
    })

    server.listen(0, host, () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a loopback port for the desktop runtime.'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}
