import { describe, expect, it } from 'vitest'

import { getExposedBridgeKeys, loadPreloadModule } from './preload.test-support'

describe('preload renderer bridge', () => {
  it('exposes runtime, config center, settings workspace, and bootstrap APIs without the legacy settings bridge', async () => {
    await loadPreloadModule()

    const exposedKeys = getExposedBridgeKeys()

    expect(exposedKeys).toEqual([
      'copilotRuntime',
      'configCenterPublicSnapshot',
      'configCenterPublicSnapshotSubscription',
      'configCenterPublicPatch',
      'settingsWorkspaceState',
      'settingsWorkspaceSecrets',
      'bootstrapWindow',
    ])
    expect(exposedKeys).not.toContain('copilotSettings')
  })
})
