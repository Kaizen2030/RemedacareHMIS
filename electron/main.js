const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');

const PROTOCOL = 'remedacarehms';
const DEFAULT_ZOOM_FACTOR = 1;
const MIN_ZOOM_FACTOR = 0.75;
const MAX_ZOOM_FACTOR = 1.5;
const ZOOM_STEP = 0.1;
let mainWindow;
let deepLinkUrl = null;
let isReady = false;
let productionServer = null;
let productionServerUrl = null;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function clampZoomFactor(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_ZOOM_FACTOR;
  const rounded = Math.round(numericValue * 100) / 100;
  return Math.min(MAX_ZOOM_FACTOR, Math.max(MIN_ZOOM_FACTOR, rounded));
}

function getCurrentZoomFactor() {
  if (!mainWindow || mainWindow.isDestroyed()) return DEFAULT_ZOOM_FACTOR;
  return mainWindow.webContents.getZoomFactor();
}

function emitZoomChanged(factor) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('zoom-changed', factor);
}

function applyZoomFactor(nextFactor) {
  const factor = clampZoomFactor(nextFactor);
  if (!mainWindow || mainWindow.isDestroyed()) return factor;
  mainWindow.webContents.setZoomFactor(factor);
  emitZoomChanged(factor);
  return factor;
}

function changeZoom(delta) {
  return applyZoomFactor(getCurrentZoomFactor() + delta);
}

function resetZoom() {
  return applyZoomFactor(DEFAULT_ZOOM_FACTOR);
}

function handleZoomShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  if (!input.control && !input.meta) return;

  const key = String(input.key || '').toLowerCase();
  const code = String(input.code || '');

  if (code === 'Equal' || code === 'NumpadAdd' || key === '+' || key === '=') {
    event.preventDefault();
    changeZoom(ZOOM_STEP);
    return;
  }

  if (code === 'Minus' || code === 'NumpadSubtract' || key === '-' || key === '_') {
    event.preventDefault();
    changeZoom(-ZOOM_STEP);
    return;
  }

  if (code === 'Digit0' || code === 'Numpad0' || key === '0') {
    event.preventDefault();
    resetZoom();
  }
}

// Register the custom protocol BEFORE app is ready.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// Single instance lock - prevents multiple app instances
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  console.log('[warn] Another instance is already running. Quitting...');
  app.quit();
} else {
  // Handle second instance (Windows)
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[app] Second instance detected');
    
    // Find deep link in command line arguments
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    
    if (url) {
      console.log('[deep-link] Deep link from second instance:', url);
      handleDeepLink(url);
    } else if (mainWindow) {
      // Just focus the existing window
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// Handle deep link function
function handleDeepLink(url) {
  if (!url?.startsWith(`${PROTOCOL}://`)) {
    console.log('[error] Not a valid deep link:', url);
    return;
  }
  
  console.log('[deep-link] Processing deep link:', url);
  deepLinkUrl = url;

  if (mainWindow && isReady) {
    console.log('[deep-link] Sending deep link to renderer');
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('deep-link', url);
  } else {
    console.log('[window] Not ready yet, storing deep link');
  }
}

function closeProductionServer() {
  if (productionServer) {
    productionServer.close();
    productionServer = null;
    productionServerUrl = null;
  }
}

function createStaticServer() {
  if (productionServer && productionServerUrl) {
    return Promise.resolve(productionServerUrl);
  }

  const distRoot = path.join(__dirname, '..', 'dist');

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const normalizedPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname);
        const requestedFile = path.normalize(path.join(distRoot, normalizedPath));
        const safeFile = requestedFile.startsWith(distRoot) ? requestedFile : path.join(distRoot, 'index.html');
        const fallbackFile = path.join(distRoot, 'index.html');
        const finalFile = fs.existsSync(safeFile) && fs.statSync(safeFile).isFile() ? safeFile : fallbackFile;
        const extension = path.extname(finalFile).toLowerCase();
        const contentType = MIME_TYPES[extension] || 'application/octet-stream';

        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
        });
        fs.createReadStream(finalFile).pipe(res);
      } catch (error) {
        console.error('[error] Production server failed to serve asset:', error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal server error');
      }
    });

    server.on('error', (error) => {
      console.error('[error] Failed to start production server:', error);
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine production server address.'));
        return;
      }

      productionServer = server;
      productionServerUrl = `http://127.0.0.1:${address.port}`;
      console.log(`[app] Production server started at ${productionServerUrl}`);
      resolve(productionServerUrl);
    });
  });
}

function createWindow() {
  console.log('[window] Creating main window...');
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 650,
    title: 'Brightpath Travel Scholars',
    icon: path.join(__dirname, '..', 'icon.ico'),
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Remove menu bar
  mainWindow.setMenu(null);
  mainWindow.webContents.on('before-input-event', handleZoomShortcut);

  const isDev = !app.isPackaged;
  console.log(`[app] Running in ${isDev ? 'development' : 'production'} mode`);

  if (isDev) {
    let retries = 0;
    const maxRetries = 30;
    const devUrl = 'http://localhost:5174';

    const tryLoad = () => {
      console.log(`[dev] Attempt ${retries + 1}/${maxRetries} to load ${devUrl}`);
      
      mainWindow.loadURL(devUrl)
        .then(() => {
          console.log('[dev] Dev server loaded successfully');
          emitZoomChanged(getCurrentZoomFactor());
          mainWindow.show();
          isReady = true;
          
          if (deepLinkUrl) {
            console.log('[deep-link] Sending stored deep link');
            handleDeepLink(deepLinkUrl);
            deepLinkUrl = null;
          }
        })
        .catch((err) => {
          console.error(`[error] Failed to load dev server (attempt ${retries + 1}):`, err.message);
          retries++;
          if (retries < maxRetries) {
            setTimeout(tryLoad, 1500);
          } else {
            console.error('[error] Could not connect to Vite after multiple attempts');
            app.quit();
          }
        });
    };

    // Wait 2 seconds before first attempt to give Vite time to start
    setTimeout(tryLoad, 2000);
  } else {
    createStaticServer()
      .then((serverUrl) => mainWindow.loadURL(serverUrl))
      .then(() => {
        console.log('[app] Production build loaded successfully');
        emitZoomChanged(getCurrentZoomFactor());
        mainWindow.show();
        isReady = true;

        if (deepLinkUrl) {
          console.log('[deep-link] Sending stored deep link');
          handleDeepLink(deepLinkUrl);
          deepLinkUrl = null;
        }
      })
      .catch((err) => {
        console.error('[error] Failed to load production build:', err);
        closeProductionServer();
        app.quit();
      });
  }

  // Handle page navigation errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[error] Page load failed: ${errorDescription} (${errorCode})`);
    if (isDev && errorCode === -102) { // ERR_CONNECTION_REFUSED
      console.log('[dev] Dev server not ready, will retry...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL('http://localhost:5174').catch(() => {});
        }
      }, 2000);
    }
  });

  mainWindow.on('closed', () => { 
    console.log('[window] Window closed');
    mainWindow = null; 
    isReady = false;
  });
  
  mainWindow.on('ready-to-show', () => {
    console.log('[window] Window ready to show');
    isReady = true;
  });
}

// IPC handler for getCommandLine
ipcMain.handle('get-command-line', () => {
  console.log('[ipc] get-command-line called, returning:', process.argv);
  return process.argv;
});

ipcMain.handle('save-file', async (event, payload = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: true };
  }

  const defaultPath = String(payload.defaultPath || 'download.xlsx');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: String(payload.title || 'Save file'),
    defaultPath,
    filters: Array.isArray(payload.filters) && payload.filters.length
      ? payload.filters
      : [{ name: 'All Files', extensions: ['*'] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const data = payload.data;
  let buffer;
  if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (data instanceof ArrayBuffer) {
    buffer = Buffer.from(new Uint8Array(data));
  } else if (ArrayBuffer.isView(data)) {
    buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else if (Array.isArray(data)) {
    buffer = Buffer.from(data);
  } else if (typeof data === 'string') {
    buffer = Buffer.from(data, payload.encoding || 'utf8');
  } else {
    throw new Error('Unsupported file data type.');
  }

  fs.writeFileSync(filePath, buffer);
  return { canceled: false, filePath };
});

ipcMain.handle('get-zoom-factor', () => getCurrentZoomFactor());
ipcMain.handle('set-zoom-factor', (event, factor) => applyZoomFactor(factor));
ipcMain.handle('zoom-in', () => changeZoom(ZOOM_STEP));
ipcMain.handle('zoom-out', () => changeZoom(-ZOOM_STEP));
ipcMain.handle('reset-zoom', () => resetZoom());

// App ready event
app.whenReady().then(() => {
  console.log('[app] App is ready');
  
  // Handle Windows deep link from command line arguments
  if (process.platform === 'win32') {
    const url = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (url) {
      console.log('[deep-link] Windows command line deep link:', url);
      deepLinkUrl = url;
    }
  }
  
  createWindow();
});

// Handle open-url event (macOS)
app.on('open-url', (event, url) => {
  console.log('[deep-link] macOS open-url event:', url);
  event.preventDefault();
  handleDeepLink(url);
});

// Handle window-all-closed
app.on('window-all-closed', () => { 
  console.log('[app] All windows closed');
  closeProductionServer();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle activate (macOS)
app.on('activate', () => { 
  console.log('[app] Activate event');
  if (!mainWindow) {
    createWindow();
  }
});

// Export for debugging
console.log('[app] main.js loaded successfully');

