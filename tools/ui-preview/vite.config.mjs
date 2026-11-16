// Vite config for the UI preview (tools/ui-preview): same React setup as the app, with src/supabase.js swapped for a mock.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = fileURLToPath(new URL('.', import.meta.url))
const mock = fileURLToPath(new URL('./mockSupabase.js', import.meta.url))

export default defineConfig({
  root: here,
  plugins: [
    react(),
    {
      name: 'preview-mock-supabase',
      enforce: 'pre',
      async resolveId(source, importer, options) {
        if (!/(^|\/)supabase(\.js)?$/.test(source) || !importer || importer === mock) return null
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
        return resolved && /[\\/]src[\\/]supabase\.js$/.test(resolved.id) ? mock : null
      },
    },
  ],
  server: { port: 5199, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] } },
})
