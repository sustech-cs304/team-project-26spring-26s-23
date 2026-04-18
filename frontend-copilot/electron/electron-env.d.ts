/// <reference types="vite-plugin-electron/electron-env" />

import type { ConfigCenterPublicPatchApi } from './config-center/public-patch'
import type {
  ConfigCenterPublicSnapshotApi,
  ConfigCenterPublicSnapshotSubscriptionApi,
} from './config-center/public-snapshot'
import type { CopilotHistoryApi } from './copilot-history'
import type { BootstrapWindowApi } from './bootstrap-window'
import type { CopilotRuntimeApi } from './copilot-runtime'
import type { DesktopNotificationApi } from './desktop-notification'
import type { SettingsWorkspaceSecretsApi, SettingsWorkspaceStateApi } from './settings-workspace/ipc'
import type { ToolCatalogApi } from './tool-catalog/ipc'

declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * The built directory structure
     *
     * ```tree
     * ├─┬─┬ dist
     * │ │ └── index.html
     * │ │
     * │ ├─┬ dist-electron
     * │ │ ├── main.js
     * │ │ └── preload.js
     * │
     * ```
     */
    APP_ROOT: string
    /** /dist/ or /public/ */
    VITE_PUBLIC: string
  }
}

declare global {
  // Used in Renderer process, expose in `preload.ts`
  interface Window {
    copilotRuntime: CopilotRuntimeApi
    copilotHistory: CopilotHistoryApi
    configCenterPublicSnapshot: ConfigCenterPublicSnapshotApi
    configCenterPublicSnapshotSubscription: ConfigCenterPublicSnapshotSubscriptionApi
    configCenterPublicPatch: ConfigCenterPublicPatchApi
    settingsWorkspaceState: SettingsWorkspaceStateApi
    settingsWorkspaceSecrets: SettingsWorkspaceSecretsApi
    toolCatalog: ToolCatalogApi
    desktopNotification: DesktopNotificationApi
    bootstrapWindow: BootstrapWindowApi
  }
}

export {}
