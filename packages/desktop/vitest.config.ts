import { defineConfig } from 'vitest/config'

/** Package output can contain transpiled test files and stale source maps. */
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.package-staging/**',
      '**/release/**',
      '**/release-*/**',
      '**/coverage/**',
    ],
    coverage: {
      exclude: [
        '**/*.test.ts',
        '**/dist/**',
        '**/.package-staging/**',
        '**/release/**',
        '**/release-*/**',
        '**/coverage/**',
      ],
    },
  },
})
