const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  onDeepLink(callback) {
    const listener = (_event, url) => callback(url)
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.removeListener('deep-link', listener)
  },
  getCommandLine() {
    return ipcRenderer.invoke('get-command-line')
  },
})