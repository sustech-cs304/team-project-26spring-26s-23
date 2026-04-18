import type { ConfigCenterPublicSnapshot } from '../public-snapshot'

export type ConfigCenterPublicSnapshotPublisher = (
  snapshot: ConfigCenterPublicSnapshot,
) => void | Promise<void>

export interface ConfigCenterSnapshotSubscription {
  publishPublicSnapshotUpdate: (snapshot: ConfigCenterPublicSnapshot) => Promise<void>
}

export function createConfigCenterSnapshotSubscription(
  publishPublicSnapshotUpdate?: ConfigCenterPublicSnapshotPublisher,
): ConfigCenterSnapshotSubscription {
  return {
    async publishPublicSnapshotUpdate(snapshot: ConfigCenterPublicSnapshot): Promise<void> {
      await publishPublicSnapshotUpdate?.(snapshot)
    },
  }
}
