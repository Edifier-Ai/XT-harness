'use strict'
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('tianxiApp', {
  platform: process.platform,
  win: (cmd) => ipcRenderer.invoke('tianxi:win', cmd),
  show: () => ipcRenderer.invoke('tianxi:show'),
  // the floating 小天
  onOrb: (cb) => ipcRenderer.on('tianxi:orb', (e, m) => cb(m)),
  orbHit: (on) => ipcRenderer.send('tianxi:orbHit', !!on),
  orbDrag: (on) => ipcRenderer.send('tianxi:orbDrag', !!on),
  orbMenu: () => ipcRenderer.send('tianxi:orbMenu'),
  // 钉到桌面: widget windows (web/widget.html)
  widgetsSync: () => ipcRenderer.invoke('tianxi:widgetsSync'),
  widgetFit: (h) => ipcRenderer.send('tianxi:widgetFit', h),
  widgetClose: () => ipcRenderer.send('tianxi:widgetClose'),
  widgetMenu: (o) => ipcRenderer.send('tianxi:widgetMenu', o),
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
  // 手机: pairing a phone on the same Wi-Fi
  phoneState: () => ipcRenderer.invoke('tianxi:phoneState'),
  phoneOn: (on) => ipcRenderer.invoke('tianxi:phoneOn', on),
  phoneRenew: () => ipcRenderer.invoke('tianxi:phoneRenew'),
  phoneForget: (id) => ipcRenderer.invoke('tianxi:phoneForget', id),
  onPhone: (cb) => ipcRenderer.on('tianxi:phone', (e, ev) => cb(ev)),
})
