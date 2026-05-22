/// <reference types="vite/client" />

interface Window {
  desktopRuntime: import('../electron/desktop-runtime').DesktopRuntimeApi
  timelineDatabase: import('../electron/renderer-ipc/timeline-database.ipc').TimelineDatabaseApi
}
