import { defineConfig } from 'vitest/config'

/** E2E files are deliberately separate from fast unit tests. */
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.package-staging/**', '**/release/**', '**/coverage/**'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
