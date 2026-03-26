/// <reference types="vite-plugin-electron/electron-env" />

import type { ConfigCenterPublicSnapshotApi } from './config-center/public-snapshot'
import type { CopilotRuntimeApi } from './copilot-runtime'
import type { CopilotSettingsApi } from './copilot-settings'

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
    copilotSettings: CopilotSettingsApi
    copilotRuntime: CopilotRuntimeApi
    configCenterPublicSnapshot: ConfigCenterPublicSnapshotApi
  }
}

export {}
