'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spindle', {
  scan: (kind) => ipcRenderer.invoke('scan', kind),
  launch: (id, index) => ipcRenderer.invoke('launch', id, index),
  played: (id) => ipcRenderer.invoke('played', id),
  openFolder: (id) => ipcRenderer.invoke('open-folder', id),
  saveSettings: (s) => ipcRenderer.invoke('settings', s),
  addGame: () => ipcRenderer.invoke('add-game'),
  addFolder: (kind) => ipcRenderer.invoke('add-folder', kind),
  removeFolder: (f, kind) => ipcRenderer.invoke('remove-folder', f, kind),
  setCover: (id) => ipcRenderer.invoke('set-cover', id),
  rename: (id, t) => ipcRenderer.invoke('rename', id, t),
  setHidden: (id, h) => ipcRenderer.invoke('set-hidden', id, h),
  removeCustom: (id) => ipcRenderer.invoke('remove-custom', id),
  version: () => ipcRenderer.invoke('version'),
  fullscreen: () => ipcRenderer.invoke('fullscreen'),
  onGameUpdated: (cb) => ipcRenderer.on('game-updated', (_e, g) => cb(g)),
  onToast: (cb) => ipcRenderer.on('toast', (_e, m) => cb(m)),
});
