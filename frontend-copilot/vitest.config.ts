import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.ts', '.js', '.mts', '.tsx', '.jsx', '.json'],
  },
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./src/test/vitest.setup.ts'],
  },
})
