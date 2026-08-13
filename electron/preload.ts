import { contextBridge, ipcRenderer } from 'electron'
import type { PortlyApi, ScanResult, Settings, Theme } from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: PortlyApi = {
  scan: () => ipcRenderer.invoke('portly:scan'),
  kill: (pid, port) => ipcRenderer.invoke('portly:kill', pid, port),
  start: (port, project) => ipcRenderer.invoke('portly:start', port, project),
  setShowNonHttp: (value) => ipcRenderer.invoke('portly:set-show-nonhttp', value),
  open: (url) => ipcRenderer.invoke('portly:open', url),
  showRowMenu: (payload) => ipcRenderer.invoke('portly:row-menu', payload),
  getSettings: () => ipcRenderer.invoke('portly:get-settings'),
  openSettingsMenu: () => ipcRenderer.invoke('portly:settings-menu'),
  quit: () => ipcRenderer.invoke('portly:quit'),
  hide: () => ipcRenderer.invoke('portly:hide'),
  setHeight: (height) => ipcRenderer.invoke('portly:set-height', height),
  getTheme: () => ipcRenderer.invoke('portly:get-theme'),
  onThemeChange: (cb) => subscribe<Theme>('portly:theme', cb),
  onShow: (cb) => subscribe<void>('portly:show', () => cb()),
  onSettingsChange: (cb) => subscribe<Settings>('portly:settings', cb),
  onScan: (cb) => subscribe<ScanResult>('portly:scan-result', cb),
}

contextBridge.exposeInMainWorld('portly', api)
