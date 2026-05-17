const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mascot', {
  hide:  ()   => ipcRenderer.send('mascot-hide'),
  onDir: (cb) => ipcRenderer.on('mascot-dir', (_, dir) => cb(dir)),
});

