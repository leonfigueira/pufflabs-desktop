const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("prefs", {
  get: () => ipcRenderer.invoke("prefs:get"),
  set: (patch) => ipcRenderer.invoke("prefs:set", patch),
  checkUpdates: () => ipcRenderer.invoke("prefs:check-updates"),
  version: () => ipcRenderer.invoke("prefs:version"),
});
