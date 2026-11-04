import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // http-proxy@1.x calls the deprecated util._extend (DEP0060); keep test output clean.
    execArgv: ['--disable-warning=DEP0060'],
  },
})
