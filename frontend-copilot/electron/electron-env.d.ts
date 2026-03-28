/// <reference types="vite-plugin-electron/electron-env" />

import type { ConfigCenterPublicPatchApi } from './config-center/public-patch'
import type {
  ConfigCenterPublicSnapshotApi,
  ConfigCenterPublicSnapshotSubscriptionApi,
} from './config-center/public-snapshot'
import type { BootstrapWindowApi } from './bootstrap-window'
import type { CopilotRuntimeApi } from './copilot-runtime'

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
    configCenterPublicSnapshot: ConfigCenterPublicSnapshotApi
    configCenterPublicSnapshotSubscription: ConfigCenterPublicSnapshotSubscriptionApi
    configCenterPublicPatch: ConfigCenterPublicPatchApi
    bootstrapWindow: BootstrapWindowApi
  }
}

export {}
