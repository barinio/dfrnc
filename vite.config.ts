import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Swap the debug controls module by mode: real leva in dev, zero-dependency
// stubs in production so leva is fully dropped from the prod bundle.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@debug/controls': fileURLToPath(
        new URL(
          mode === 'production'
            ? './src/debug/controls.prod.ts'
            : './src/debug/controls.dev.ts',
          import.meta.url,
        ),
      ),
    },
  },
}))
