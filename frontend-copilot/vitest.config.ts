import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
      ['src/bootstrap-window.test.ts', 'jsdom'],
    ],
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/vitest.setup.ts'],
  },
})
