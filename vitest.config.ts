import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    // `server/` had no tests at all until the NovelAI tokenizer — worth real coverage since it's
    // the one piece of that whole integration verifiable without a live NovelAI account.
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
  },
})
