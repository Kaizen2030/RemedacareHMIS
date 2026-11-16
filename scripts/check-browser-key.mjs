import { loadEnv } from 'vite'

const mode = process.argv[2] || 'production'
const env = loadEnv(mode, process.cwd(), 'VITE_')
const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''

function fail(message) {
  console.error(`Supabase browser-key check failed: ${message}`)
  process.exit(1)
}

if (!key) fail('set VITE_SUPABASE_ANON_KEY to the public anon or publishable key before starting the app.')
if (key.startsWith('sb_secret_')) fail('a Supabase secret key must never be bundled into a browser or desktop app.')

const parts = key.split('.')
if (parts.length === 3) {
  let payload
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    fail('the configured JWT is not a valid public API key.')
  }
  if (payload.role !== 'anon') fail('the configured JWT is not the public anon key; service-role keys bypass database row security.')
} else if (!key.startsWith('sb_publishable_')) {
  fail('use a Supabase anon JWT or sb_publishable_ key for the browser app.')
}
