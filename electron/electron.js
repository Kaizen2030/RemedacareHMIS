const { app, BrowserWindow } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, 'public/icon.png'), // optional
    title: 'RemedacareOS'
  })

  win.loadURL('http://localhost:5173') // your Vite dev port
  // For production build use:
  // win.loadFile(path.join(__dirname, 'dist/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })