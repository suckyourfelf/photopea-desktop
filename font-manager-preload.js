const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fontAPI', {
  getFontList: () => ipcRenderer.invoke('get-font-list'),
  downloadFonts: (fonts) => ipcRenderer.send('download-fonts', fonts),
  onDownloadProgress: (callback) => ipcRenderer.on('download-progress', (_event, value) => callback(value)),
  closeWindow: () => ipcRenderer.send('close-font-manager-window'),
});
