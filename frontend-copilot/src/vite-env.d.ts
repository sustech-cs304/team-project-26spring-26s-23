/// <reference types="vite/client" />

interface Window {
  timelineDatabase: import('../../electron/preload/timeline-database.preload').TimelineDatabaseApi
}
