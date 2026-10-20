'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tianxiApp', {
  win: (cmd) => ipcRenderer.invoke('tianxi:win', cmd),
  show: () => ipcRenderer.invoke('tianxi:show'),
  getConfig: () => ipcRenderer.invoke('tianxi:getConfig'),
  listModels: (c) => ipcRenderer.invoke('tianxi:listModels', c),
  updateStatus: () => ipcRenderer.invoke('tianxi:updateStatus'),
  updateCheck: () => ipcRenderer.invoke('tianxi:updateCheck'),
  updateSource: (c) => ipcRenderer.invoke('tianxi:updateSource', c),
  restart: () => ipcRenderer.invoke('tianxi:restart'),
  onUpdate: (cb) => ipcRenderer.on('tianxi:update', (e, st) => cb(st)),
  saveConfig: (c) => ipcRenderer.invoke('tianxi:saveConfig', c),
  runEval: (o) => ipcRenderer.invoke('tianxi:runEval', o),
  evalStop: () => ipcRenderer.invoke('tianxi:evalStop'),
  evalStatus: () => ipcRenderer.invoke('tianxi:evalStatus'),
  evalOpen: (dir) => ipcRenderer.invoke('tianxi:evalOpen', dir),
})
