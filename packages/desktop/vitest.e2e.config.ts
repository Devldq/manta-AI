import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/** E2E files are deliberately separate from fast unit tests. */
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '../frontend/src') } },
  test: {
    include: ['e2e/**/*.e2e.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.package-staging/**', '**/release/**', '**/coverage/**'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
