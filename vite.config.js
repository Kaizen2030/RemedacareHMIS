import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/dist-electron/**', '**/dist/**']
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
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'react-vendor'
            if (id.includes('node_modules/@supabase')) return 'supabase-vendor'
            if (id.includes('node_modules/pdfjs-dist')) return 'pdfjs'
            if (id.includes('node_modules/tesseract.js')) return 'tesseract'
            if (id.includes('node_modules/xlsx')) return 'xlsx'
            return 'vendor'
          }
        }
      }
    }
  }
})
