import type { PreloadBridgeApis } from './preload-bridge-apis'

interface ContextBridgeLike {
  exposeInMainWorld: (apiKey: string, api: unknown) => void
}

const PRELOAD_BRIDGE_KEYS = [
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
  'desktopNotification',
  'bootstrapWindow',
] as const satisfies ReadonlyArray<keyof PreloadBridgeApis>

export function exposePreloadBridgeApis(
  contextBridge: ContextBridgeLike,
  preloadBridgeApis: PreloadBridgeApis,
): void {
  for (const key of PRELOAD_BRIDGE_KEYS) {
    contextBridge.exposeInMainWorld(key, preloadBridgeApis[key])
  }
}
