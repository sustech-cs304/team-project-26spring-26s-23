/// <reference types="vite/client" />

interface Window {
  timelineDatabase: import('../electron/renderer-ipc/timeline-database.ipc').TimelineDatabaseApi
}
