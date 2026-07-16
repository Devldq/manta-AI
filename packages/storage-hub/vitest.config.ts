import { defineConfig } from 'vitest/config'

/** Real Git and filesystem integration tests need headroom under parallel I/O. */
export default defineConfig({
  test: {
    testTimeout: 15_000,
  },
})
