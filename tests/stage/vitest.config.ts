import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/stage/**/*.test.ts'],
    globals: true,
  },
})
