const { contextBridge, ipcRenderer } = require('electron');

// Expose a mocked __TAURI__ global object to the renderer process
// This maps calls to Tauri's invoke('command', args) directly to Electron's ipcRenderer.invoke('command', args)
contextBridge.exposeInMainWorld('__TAURI__', {
  core: {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args)
  },
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args),
  tauri: {
    invoke: (cmd, args) => ipcRenderer.invoke(cmd, args)
  }
});
