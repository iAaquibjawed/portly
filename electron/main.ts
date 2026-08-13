import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  screen,
  shell,
  Tray,
} from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { forgetStopped, kill, scan, stoppedSnapshot } from './ports'
import { initRestartStore, startCapture } from './restart'
import type { RowMenuPayload, ScanResult, Settings } from '../shared/types'

/** The popover is 400px wide per the spec; the window carries extra padding so
 *  the CSS drop shadow has room to render outside the rounded card. */
const POPOVER_WIDTH = 400
const WINDOW_PADDING = 20
const WINDOW_WIDTH = POPOVER_WIDTH + WINDOW_PADDING * 2
const MAX_POPOVER_HEIGHT = 520
const MIN_POPOVER_HEIGHT = 120

const VISIBLE_INTERVAL_MS = 5_000
const HIDDEN_INTERVAL_MS = 30_000

/**
 * Bumped when a default changes in a way that must override what an earlier run
 * persisted. v2 forces showNonHttp off: it shipped defaulting to true, and a
 * stored `true` was silently outliving the new default.
 */
const SETTINGS_VERSION = 2

const DEFAULT_SETTINGS: Settings = {
  refreshIntervalMs: VISIBLE_INTERVAL_MS,
  // Off by default: on a real machine the non-HTTP listeners outnumber the
  // dev servers roughly 4:1 and bury them. The footer says what is hidden.
  showNonHttp: false,
  launchAtLogin: false,
}

let tray: Tray | null = null
let win: BrowserWindow | null = null
let settings: Settings = { ...DEFAULT_SETTINGS }
let settingsVersion = SETTINGS_VERSION
let scanTimer: NodeJS.Timeout | null = null
let scanning = false
let lastResult: ScanResult | null = null
/** Suppresses hide-on-blur while a native menu owns the focus. */
let menuOpen = false

const settingsPath = () => join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  let stored: Partial<Settings> & { version?: number } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), 'utf8'))
  } catch {
    stored = {}
  }

  settings = { ...DEFAULT_SETTINGS, ...stored }

  // Migrate stale values that predate a default change, then persist so the
  // migration runs once rather than on every launch.
  if ((stored.version ?? 1) < SETTINGS_VERSION) {
    settings.showNonHttp = DEFAULT_SETTINGS.showNonHttp
    console.log(
      `settings: migrated v${stored.version ?? 1} -> v${SETTINGS_VERSION}, ` +
        `showNonHttp reset to ${DEFAULT_SETTINGS.showNonHttp}`,
    )
    settingsVersion = SETTINGS_VERSION
    saveSettings()
  } else {
    settingsVersion = SETTINGS_VERSION
  }

  settings.launchAtLogin = app.getLoginItemSettings().openAtLogin
}

function saveSettings() {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(
      settingsPath(),
      JSON.stringify({ version: settingsVersion, ...settings }, null, 2),
    )
  } catch {
    // A settings file we cannot write is not worth crashing the app over.
  }
}

function broadcast(channel: string, payload?: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function trayImage() {
  const dir = join(__dirname, '..', 'build', 'icons')
  const isMac = process.platform === 'darwin'
  // Windows and Linux trays have no template concept, so they get the
  // monochrome white glyph their default dark trays need.
  const file = join(dir, isMac ? 'trayIconTemplate.png' : 'trayIconWin.png')
  if (!existsSync(file)) return nativeImage.createEmpty()

  const image = nativeImage.createFromPath(file)
  if (isMac) {
    // A template image is an alpha mask: macOS discards the colour and draws it
    // black on light menu bars, white on dark, and tinted while the menu is open.
    image.setTemplateImage(true)
  }
  return image
}

function applyTray(result: ScanResult) {
  if (!tray) return
  // No numeric title. A count beside the glyph reads as a system monitor;
  // a bare glyph reads as a tool. The count lives in the popover footer.
  const serving = result.servingCount
  tray.setToolTip(
    serving === 1
      ? `Portly — 1 server (${result.totalCount} listeners)`
      : `Portly — ${serving} servers (${result.totalCount} listeners)`,
  )
}

/** Re-broadcasts cached rows with freshly-read stopped/start state. */
function pushState() {
  const current = lastResult
  if (!current) return
  const stoppedPorts = new Set(stoppedSnapshot().map((r) => r.port))
  const merged: ScanResult = {
    ...current,
    rows: [
      ...current.rows.filter((r) => r.state === 'live' && !stoppedPorts.has(r.port)),
      ...stoppedSnapshot(),
    ].sort((a, b) => a.port - b.port),
  }
  lastResult = merged
  applyTray(merged)
  broadcast('portly:scan-result', merged)
}

async function runScan(): Promise<ScanResult> {
  if (scanning && lastResult) return lastResult
  scanning = true
  try {
    const result = await scan(settings.showNonHttp)
    lastResult = result
    applyTray(result)
    broadcast('portly:scan-result', result)
    return result
  } finally {
    scanning = false
  }
}

function scheduleScans() {
  if (scanTimer) clearInterval(scanTimer)
  const visible = Boolean(win?.isVisible())
  const period = visible
    ? Math.max(1000, settings.refreshIntervalMs)
    : Math.max(settings.refreshIntervalMs, HIDDEN_INTERVAL_MS)
  scanTimer = setInterval(() => void runScan(), period)
}

function createWindow() {
  win = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: MAX_POPOVER_HEIGHT + WINDOW_PADDING * 2,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // The spec is explicit: no glass. Solid surfaces, CSS shadow only.
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('blur', () => {
    if (!menuOpen) hidePopover()
  })

  // Keep external links out of the popover.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
}

function positionWindow() {
  if (!win || !tray) return
  const trayBounds = tray.getBounds()
  const { width, height } = win.getBounds()
  const display = screen.getDisplayNearestPoint({
    x: Math.round(trayBounds.x + trayBounds.width / 2),
    y: Math.round(trayBounds.y),
  })
  const area = display.workArea

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - width / 2)
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  // The window's padding supplies the visual gap under the menu bar.
  const y = Math.round(trayBounds.y + trayBounds.height - WINDOW_PADDING + 4)

  win.setPosition(x, Math.min(y, area.y + area.height - height), false)
}

function showPopover() {
  if (!win) return
  positionWindow()
  win.show()
  win.focus()
  broadcast('portly:show')
  void runScan()
  scheduleScans()
}

function hidePopover() {
  if (!win || !win.isVisible()) return
  win.hide()
  scheduleScans()
}

function togglePopover() {
  if (win?.isVisible()) hidePopover()
  else showPopover()
}

function openSettingsMenu() {
  menuOpen = true
  const menu = Menu.buildFromTemplate([
    {
      label: 'Launch Portly at login',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: () => {
        settings.launchAtLogin = !settings.launchAtLogin
        app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin })
        saveSettings()
        broadcast('portly:settings', settings)
      },
    },
    {
      label: 'Show non-HTTP ports',
      type: 'checkbox',
      checked: settings.showNonHttp,
      click: () => {
        settings.showNonHttp = !settings.showNonHttp
        saveSettings()
        broadcast('portly:settings', settings)
        void runScan()
      },
    },
    { type: 'separator' },
    {
      label: 'Refresh interval',
      submenu: ([2000, 5000, 10000, 30000] as const).map((ms) => ({
        label: ms < 60000 ? `${ms / 1000} seconds` : `${ms / 60000} minutes`,
        type: 'radio' as const,
        checked: settings.refreshIntervalMs === ms,
        click: () => {
          settings.refreshIntervalMs = ms
          saveSettings()
          broadcast('portly:settings', settings)
          scheduleScans()
        },
      })),
    },
    { type: 'separator' },
    { label: `Portly ${app.getVersion()}`, enabled: false },
  ])

  menu.popup({
    window: win ?? undefined,
    callback: () => {
      menuOpen = false
      // Returning focus keeps the keyboard model intact after the menu closes.
      if (win?.isVisible()) win.focus()
    },
  })
}

function registerIpc() {
  ipcMain.handle('portly:scan', () => runScan())
  ipcMain.handle('portly:kill', (_e, pid: number, port: number) => kill(pid, port))

  ipcMain.handle('portly:start', async (_e, port: number, groupKey: string) => {
    // startCapture marks the row as starting synchronously, so pushing state
    // before awaiting lets the row show progress for the full 10s window.
    const pending = startCapture(port, groupKey)
    pushState()
    const result = await pending
    if (result.ok) forgetStopped(port)
    await runScan()
    return result
  })

  ipcMain.handle('portly:set-show-nonhttp', async (_e, value: boolean) => {
    settings.showNonHttp = Boolean(value)
    saveSettings()
    broadcast('portly:settings', settings)
    await runScan()
  })

  ipcMain.handle('portly:open', async (_e, url: string) => {
    // Only ever open loopback dev servers.
    try {
      const parsed = new URL(url)
      const localHosts = ['localhost', '127.0.0.1', '::1', '[::1]']
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        localHosts.includes(parsed.hostname)
      ) {
        await shell.openExternal(url)
      }
    } catch {
      // malformed URL — ignore
    }
  })

  ipcMain.handle('portly:row-menu', (_e, payload: RowMenuPayload) => {
    menuOpen = true
    const items: Electron.MenuItemConstructorOptions[] = []
    const scheme = payload.protocol === 'https' ? 'https' : 'http'

    if (payload.protocol === 'http' || payload.protocol === 'https') {
      items.push({
        label: 'Copy URL',
        click: () => clipboard.writeText(`${scheme}://localhost:${payload.port}`),
      })
    }
    if (payload.cwd && existsSync(payload.cwd)) {
      items.push({
        label: 'Reveal in Finder',
        click: () => shell.showItemInFolder(payload.cwd as string),
      })
    }
    if (payload.cwd) {
      items.push({
        label: 'Copy path',
        click: () => clipboard.writeText(payload.cwd as string),
      })
    }
    items.push({
      label: 'Copy PID',
      click: () => clipboard.writeText(String(payload.pid)),
    })
    if (payload.command) {
      items.push({
        label: 'Copy command',
        click: () => clipboard.writeText(payload.command as string),
      })
    }
    if (payload.startCommand) {
      items.push({ type: 'separator' })
      items.push({
        label: 'Copy start command',
        click: () => clipboard.writeText(payload.startCommand as string),
      })
    }
    // A failed start must be readable somewhere other than a tooltip.
    if (payload.startError) {
      items.push({ type: 'separator' })
      items.push({ label: 'Last start failed:', enabled: false })
      items.push({
        label: payload.startError.slice(0, 120),
        click: () => clipboard.writeText(payload.startError as string),
      })
    }

    Menu.buildFromTemplate(items).popup({
      window: win ?? undefined,
      callback: () => {
        menuOpen = false
        if (win?.isVisible()) win.focus()
      },
    })
  })

  ipcMain.handle('portly:get-settings', () => settings)
  ipcMain.handle('portly:settings-menu', () => openSettingsMenu())
  ipcMain.handle('portly:quit', () => app.quit())
  ipcMain.handle('portly:hide', () => hidePopover())
  ipcMain.handle('portly:get-theme', () =>
    nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
  )

  ipcMain.handle('portly:set-height', (_e, height: number) => {
    if (!win || win.isDestroyed()) return
    const clamped = Math.round(
      Math.min(MAX_POPOVER_HEIGHT, Math.max(MIN_POPOVER_HEIGHT, height)),
    )
    const total = clamped + WINDOW_PADDING * 2
    if (win.getBounds().height === total) return
    win.setBounds({ ...win.getBounds(), height: total }, false)
    if (win.isVisible()) positionWindow()
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showPopover())

  app.whenReady().then(() => {
    loadSettings()
    initRestartStore(app.getPath('userData'))

    // Menu-bar only: no Dock tile, no window in the app switcher.
    if (process.platform === 'darwin') app.dock?.hide()

    tray = new Tray(trayImage())
    tray.setToolTip('Portly')
    tray.on('click', togglePopover)
    tray.on('right-click', openSettingsMenu)

    registerIpc()
    createWindow()

    nativeTheme.on('updated', () => {
      broadcast('portly:theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    })

    void runScan()
    scheduleScans()
  })

  // A menu-bar app has no windows to keep it alive.
  app.on('window-all-closed', () => {})
}
