const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 650,
    title: 'RemedacareOS',
    icon: path.join(__dirname, '..', 'icon.ico'),
    backgroundColor: '#f7f8f7',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.setMenu(null);

  const isDev = !app.isPackaged;

  if (isDev) {
    let retries = 0;
    const maxRetries = 20;

    const tryLoad = () => {
      mainWindow.loadURL('http://localhost:5174')
        .then(() => {
          mainWindow.show();
        })
        .catch(() => {
          retries++;
          if (retries < maxRetries) {
            setTimeout(tryLoad, 1500);
          } else {
            console.error('Could not connect to Vite after multiple attempts');
            app.quit();
          }
        });
    };

    // Wait 3 seconds before first attempt to give Vite time to start
    setTimeout(tryLoad, 3000);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
    mainWindow.show();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!mainWindow) createWindow(); });
