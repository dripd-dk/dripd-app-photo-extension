import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // happy-dom, not jsdom: the bridge test needs a REAL window whose
    // postMessage echoes back to its own listeners. A hand-rolled fake window
    // that does not echo is exactly what hid the `dir` bug on the page side.
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
})
