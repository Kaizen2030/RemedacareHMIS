const { spawn } = require('child_process')
const http = require('http')
const path = require('path')

const PORT = 5174
const electronBin = require('electron')
const vitePackageJson = require.resolve('vite/package.json')
const viteBin = path.join(path.dirname(vitePackageJson), 'bin', 'vite.js')

let viteProcess = null
let startedVite = false

function createChildEnv() {
  const nextEnv = { ...process.env }
  delete nextEnv.ELECTRON_RUN_AS_NODE
  return nextEnv
}

function isViteReady() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${PORT}`, () => {
      resolve(true)
    })

    req.on('error', () => {
      resolve(false)
    })

    req.setTimeout(1000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function waitForVite(retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      if (await isViteReady()) {
        resolve()
        return
      }

      if (retries-- > 0) {
        console.log(`Waiting for Vite on port ${PORT}... (${retries} retries left)`)
        setTimeout(attempt, 1000)
        return
      }

      reject(new Error(`Vite never started on port ${PORT}.`))
    }

    setTimeout(attempt, 1000)
  })
}

function cleanupVite() {
  if (startedVite && viteProcess && !viteProcess.killed) {
    viteProcess.kill()
  }
}

async function ensureVite() {
  if (await isViteReady()) {
    console.log(`Vite is already running on port ${PORT}. Reusing it.`)
    return
  }

  console.log('Starting Vite...')
  startedVite = true
  viteProcess = spawn(process.execPath, [viteBin, '--port', String(PORT)], {
    stdio: 'inherit',
    env: createChildEnv()
  })

  viteProcess.on('error', (err) => {
    console.error('Failed to start Vite:', err)
    process.exit(1)
  })

  await waitForVite()
}

async function main() {
  try {
    await ensureVite()
    console.log('Vite is ready! Launching Electron...')

    const electron = spawn(electronBin, ['.'], {
      stdio: 'inherit',
      env: createChildEnv()
    })

    electron.on('error', (err) => {
      console.error('Failed to start Electron:', err)
    })

    electron.on('close', (code) => {
      console.log('Electron closed. Shutting down Vite...')
      cleanupVite()
      process.exit(code)
    })
  } catch (err) {
    console.error(err.message)
    cleanupVite()
    process.exit(1)
  }
}

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  cleanupVite()
  process.exit(0)
})

process.on('exit', () => {
  cleanupVite()
})

main()
