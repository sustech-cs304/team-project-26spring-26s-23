import type { ConfigCenterPublicSnapshotSubscriptionApi } from './public-snapshot'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL } from './public-snapshot'

interface ConfigCenterPublicSnapshotSubscriptionEventSource {
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

export function createConfigCenterPublicSnapshotSubscriptionApi(
  eventSource: ConfigCenterPublicSnapshotSubscriptionEventSource,
): ConfigCenterPublicSnapshotSubscriptionApi {
  return {
    subscribe(listener) {
      const wrappedListener = (_event: unknown, snapshot: unknown) => {
        listener(snapshot as Parameters<typeof listener>[0])
      }

      eventSource.on(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, wrappedListener)

      return () => {
        eventSource.off(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, wrappedListener)
      }
    },
  }
}
