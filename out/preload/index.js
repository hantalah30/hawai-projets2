"use strict";
const electron = require("electron");
const preload = require("@electron-toolkit/preload");
electron.contextBridge.exposeInMainWorld("electron", preload.electronAPI);
electron.contextBridge.exposeInMainWorld("steam", {
  detectPath: () => electron.ipcRenderer.invoke("detect-steam-path"),
  selectPath: () => electron.ipcRenderer.invoke("select-steam-folder"),
  flushConfig: () => electron.ipcRenderer.send("steam-flush"),
  downgrade: () => electron.ipcRenderer.send("steam-downgrade"),
  // ADD THE NEW ONE HERE
  versionDowngrade: () => electron.ipcRenderer.invoke("steam-version-downgrade"),
  cancelDownload: () => electron.ipcRenderer.send("cancel-download")
});
electron.contextBridge.exposeInMainWorld("app", {
  getVersion: () => electron.ipcRenderer.invoke("get-app-version"),
  openExternal: (url) => electron.shell.openExternal(url)
});
electron.contextBridge.exposeInMainWorld("electronAPI", {
  getDeviceId: () => electron.ipcRenderer.invoke("get-device-id"),
  getPcName: () => electron.ipcRenderer.invoke("get-pc-name")
});
electron.contextBridge.exposeInMainWorld("hawai", {
  installGame: (game) => electron.ipcRenderer.invoke("install-game", game),
  restartSteam: () => electron.ipcRenderer.invoke("restart-steam")
});
electron.contextBridge.exposeInMainWorld("library", {
  getAppIds: () => electron.ipcRenderer.invoke("get-steam-appids"),
  getLocalCover: (appid) => electron.ipcRenderer.invoke("get-local-game-art", appid),
  getGridDbCover: (appid) => electron.ipcRenderer.invoke("get-steamgriddb-art", appid)
});
electron.contextBridge.exposeInMainWorld("hawaiX", {
  applyFix: (game) => electron.ipcRenderer.invoke("apply-fix", game),
  playGame: (game) => electron.ipcRenderer.invoke("play-game", game),
  installVCRedist: () => electron.ipcRenderer.invoke("install-vc-redist"),
  addAVExclusion: () => electron.ipcRenderer.invoke("add-av-exclusion"),
  checkAVExclusion: () => electron.ipcRenderer.invoke("check-av-exclusion"),
  // <--- ADD THIS LINE
  openFolder: (game) => electron.ipcRenderer.invoke("open-game-folder", game),
  onDownloadProgress: (callback) => {
    electron.ipcRenderer.removeAllListeners("download-progress");
    electron.ipcRenderer.on("download-progress", (_, data) => callback(data));
  }
});
electron.contextBridge.exposeInMainWorld("appUpdater", {
  checkForUpdates: () => electron.ipcRenderer.invoke("check-app-update"),
  startDownload: () => electron.ipcRenderer.invoke("start-app-update"),
  installUpdate: () => electron.ipcRenderer.invoke("install-app-update"),
  // Listen for progress/status
  onProgress: (callback) => {
    const subscription = (_, data) => callback(data);
    electron.ipcRenderer.on("updater-progress", subscription);
    return () => electron.ipcRenderer.removeListener("updater-progress", subscription);
  }
});
