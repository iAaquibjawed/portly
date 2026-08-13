// Shared across the Electron main process and the renderer.

/** Shape-coded in the UI, never colour-coded. */
export type Protocol = 'http' | 'https' | 'nonhttp' | 'unknown'

export type Variant = 'normal' | 'nonhttp' | 'permission'

/** A stopped row keeps its place in the list until its restart window expires. */
export type RowState = 'live' | 'stopped'

/** How costly stopping a listener would be. */
export type RiskLevel = 'safe' | 'caution' | 'danger'

export interface StopRisk {
  level: RiskLevel
  /** Short chip text for the confirm line. */
  label: string
  /** Longer sentence for the tooltip. */
  detail: string
}

export interface PortRow {
  /** Stable identity for reconciliation: port + pid, never list index. */
  id: string
  port: number
  pid: number
  process: string
  /** Resolved project name — git repo root, disambiguated across the list. */
  project: string
  /** Canonical project directory; null when the name came from a fallback. */
  projectPath: string | null
  protocol: Protocol
  title: string | null
  uptimeSeconds: number
  cwd: string | null
  /** Full argv of the listening process, for the tooltip and Copy command. */
  command: string | null
  variant: Variant
  /**
   * Stable grouping key — the resolved project's absolute path, or
   * `proc:<name>` when there is none. Display names can collide; paths cannot.
   */
  groupKey: string
  state: RowState
  /** Epoch ms when Portly stopped it; null while live. */
  stoppedAt: number | null
  /** Start is offered only when Portly stopped it AND argv was captured. */
  startable: boolean
  starting: boolean
  /** Populated after a failed start; surfaced on hover and in the ⋯ menu. */
  startError: string | null
  /** What Start will run, shown on hover so an inferred command is visible. */
  startCommand: string | null
  /** `argv` read from the live process, or the file a command was inferred from. */
  startCommandSource: string | null
  /** What stopping this would cost — shown in the confirm. */
  risk: StopRisk
  /** Resident memory in KB, or null when ps did not report it. */
  memoryKb: number | null
  /**
   * A portless `.localhost` URL proxying to this port, when one is registered.
   * Portly shows the name and opens it in preference to the raw port.
   */
  namedUrl: string | null
}

/** Everything the overflow menu needs, built in the main process. */
export interface RowMenuPayload {
  port: number
  pid: number
  protocol: Protocol
  cwd: string | null
  command: string | null
  /** Surfaced in the menu when a start attempt failed. */
  startError?: string | null
  startCommand?: string | null
}

export interface ScanResult {
  /** Rows after the non-HTTP filter, live and stopped, in one list. */
  rows: PortRow[]
  /** Every listener found, before filtering. */
  totalCount: number
  /** How many the current filter is hiding. */
  hiddenCount: number
  /** Listeners serving HTTP or HTTPS — what the tray badges. */
  servingCount: number
  /** True when at least one listener could not be attributed to an owner. */
  hasUnresolved: boolean
  scannedAt: number
}

export interface KillResult {
  ok: boolean
  signal: 'SIGTERM' | 'SIGKILL' | null
  error?: string
}

export interface StartResult {
  ok: boolean
  error?: string
}

export interface Settings {
  refreshIntervalMs: number
  showNonHttp: boolean
  launchAtLogin: boolean
}

export type Theme = 'light' | 'dark'

export interface PortlyApi {
  scan(): Promise<ScanResult>
  kill(pid: number, port: number): Promise<KillResult>
  start(port: number, groupKey: string): Promise<StartResult>
  open(url: string): Promise<void>
  /** Opens the native overflow menu for a row. */
  showRowMenu(payload: RowMenuPayload): Promise<void>
  getSettings(): Promise<Settings>
  setShowNonHttp(value: boolean): Promise<void>
  openSettingsMenu(): Promise<void>
  quit(): Promise<void>
  hide(): Promise<void>
  setHeight(height: number): Promise<void>
  getTheme(): Promise<Theme>
  onThemeChange(cb: (theme: Theme) => void): () => void
  onShow(cb: () => void): () => void
  onSettingsChange(cb: (settings: Settings) => void): () => void
  /** Timer-driven rescans pushed from the main process. */
  onScan(cb: (result: ScanResult) => void): () => void
}
