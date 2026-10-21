'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tianxiApp', {
  win: (cmd) => ipcRenderer.invoke('tianxi:win', cmd),
  show: () => ipcRenderer.invoke('tianxi:show'),
  // the floating 小天
  onOrb: (cb) => ipcRenderer.on('tianxi:orb', (e, m) => cb(m)),
  orbHit: (on) => ipcRenderer.send('tianxi:orbHit', !!on),
  orbDrag: (on) => ipcRenderer.send('tianxi:orbDrag', !!on),
  orbMenu: () => ipcRenderer.send('tianxi:orbMenu'),
  getConfig: () => ipcRenderer.invoke('tianxi:getConfig'),
  listModels: (c) => ipcRenderer.invoke('tianxi:listModels', c),
  updateStatus: () => ipcRenderer.invoke('tianxi:updateStatus'),
  updateCheck: () => ipcRenderer.invoke('tianxi:updateCheck'),
  updateSource: (c) => ipcRenderer.invoke('tianxi:updateSource', c),
  restart: () => ipcRenderer.invoke('tianxi:restart'),
  onUpdate: (cb) => ipcRenderer.on('tianxi:update', (e, st) => cb(st)),
  saveConfig: (c) => ipcRenderer.invoke('tianxi:saveConfig', c),
  freeScan: () => ipcRenderer.invoke('tianxi:freeScan'),
  freeSignIn: (c) => ipcRenderer.invoke('tianxi:freeSignIn', c),
  freeReopen: (site) => ipcRenderer.invoke('tianxi:freeReopen', site),
  freeSignOut: (site) => ipcRenderer.invoke('tianxi:freeSignOut', site),
  freeTest: (c) => ipcRenderer.invoke('tianxi:freeTest', c),
  freeSave: (c) => ipcRenderer.invoke('tianxi:freeSave', c),
  open: (url) => ipcRenderer.invoke('tianxi:open', url),
  runEval: (o) => ipcRenderer.invoke('tianxi:runEval', o),
  evalStop: () => ipcRenderer.invoke('tianxi:evalStop'),
  evalStatus: () => ipcRenderer.invoke('tianxi:evalStatus'),
  evalOpen: (dir) => ipcRenderer.invoke('tianxi:evalOpen', dir),
})
