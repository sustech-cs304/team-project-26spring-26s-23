import { describe, expect, it } from 'vitest'

import { getExposedBridgeKeys, loadPreloadModule } from './preload.test-support'

describe('preload renderer bridge', () => {
  it('exposes runtime, history, config center, settings workspace, mcp registry, and bootstrap APIs without the legacy settings bridge', async () => {
    await loadPreloadModule()

    const exposedKeys = getExposedBridgeKeys()

    expect(exposedKeys).toEqual([
      'copilotRuntime',
      'copilotHistory',
      'configCenterPublicSnapshot',
      'configCenterPublicSnapshotSubscription',
      'configCenterPublicPatch',
      'settingsWorkspaceState',
      'settingsWorkspaceSecrets',
      'managedRuntime',
      'mcpRegistry',
      'mcpRegistrySubscription',
      'skillRegistry',
      'skillRegistrySubscription',
      'toolCatalog',
      'attachmentManager',
      'desktopNotification',
      'windowControls',
      'bootstrapWindow',
      'fileManager',
    ])
    expect(exposedKeys).not.toContain('copilotSettings')
  })
})
