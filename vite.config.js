import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // supabase/tests/db runs on node:test + PGlite (npm run test:db), not vitest
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'dist-electron/**', 'supabase/tests/db/**'],
    // Edge functions import supabase-js from esm.sh (Deno); unit tests swap in a stub.
    alias: {
      'https://esm.sh/@supabase/supabase-js@2.45.4': fileURLToPath(new URL('./supabase/tests/stubs/supabase-js.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/dist-electron/**', '**/dist/**', '**/*.zip', '**/supabase/tests/db/**']
    }
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'EVAL' && warning.id && warning.id.includes('pdfjs-dist')) {
          return
        }
        warn(warning)
      }
    }
  }
})
