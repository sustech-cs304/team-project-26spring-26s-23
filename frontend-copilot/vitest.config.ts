import path from 'node:path'
import { defineConfig } from 'vitest/config'

const windowsPoolOverride = process.platform === 'win32'
  ? { pool: 'vmThreads' as const }
  : {}

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  test: {
    ...windowsPoolOverride,
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/vitest.setup.ts'],
  },
})
