const { spawn } = require('child_process')
const http = require('http')

const PORT = 5174
const electronBin = require('electron') // points to the actual binary

function waitForVite(retries = 30) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(`http://localhost:${PORT}`, (res) => {
        resolve()
      }).on('error', () => {
        if (retries-- > 0) {
          console.log(`Waiting for Vite on port ${PORT}... (${retries} retries left)`)
          setTimeout(attempt, 1000)
        } else {
          reject(new Error('Vite never started. Check that port ' + PORT + ' is free.'))
        }
      })
    }
    setTimeout(attempt, 1000)
  })
}

console.log('Starting Vite...')
const vite = spawn('npx', ['vite', '--port', String(PORT)], {
  stdio: 'inherit',
  shell: true
})

vite.on('error', (err) => {
  console.error('Failed to start Vite:', err)
  process.exit(1)
})

waitForVite()
  .then(() => {
    console.log('Vite is ready! Launching Electron...')

    // Use the electron binary directly instead of npx
    const electron = spawn(electronBin, ['.'], {
      stdio: 'inherit',
      shell: false
    })

    electron.on('error', (err) => {
      console.error('Failed to start Electron:', err)
    })

    electron.on('close', (code) => {
      console.log('Electron closed. Shutting down Vite...')
      vite.kill()
      process.exit(code)
    })
  })
  .catch((err) => {
    console.error(err.message)
    vite.kill()
    process.exit(1)
  })

process.on('SIGINT', () => {
  console.log('\nShutting down...')
  vite.kill()
  process.exit(0)
})

process.on('exit', () => {
  vite.kill()
})