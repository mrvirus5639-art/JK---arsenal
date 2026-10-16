'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spindle', {
  scan: () => ipcRenderer.invoke('scan'),
  launch: (id) => ipcRenderer.invoke('launch', id),
  openFolder: (id) => ipcRenderer.invoke('open-folder', id),
  saveSettings: (s) => ipcRenderer.invoke('settings', s),
  addGame: () => ipcRenderer.invoke('add-game'),
  addFolder: () => ipcRenderer.invoke('add-folder'),
  removeFolder: (f) => ipcRenderer.invoke('remove-folder', f),
  setCover: (id) => ipcRenderer.invoke('set-cover', id),
  rename: (id, t) => ipcRenderer.invoke('rename', id, t),
  setHidden: (id, h) => ipcRenderer.invoke('set-hidden', id, h),
  removeCustom: (id) => ipcRenderer.invoke('remove-custom', id),
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  onGameUpdated: (cb) => ipcRenderer.on('game-updated', (_e, g) => cb(g)),
});
