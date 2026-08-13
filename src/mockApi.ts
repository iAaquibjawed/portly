import type {
  KillResult,
  PortlyApi,
  PortRow,
  ScanResult,
  Settings,
  StartResult,
  Theme,
} from '../shared/types'

/**
 * Stand-in used when the renderer is opened without the Electron preload —
 * plain-browser review and the mockup generator. Seeded from the real listener
 * set on the development machine so layout is exercised against true data
 * (long titles, monorepos sharing a project, duplicate process names).
 */

function row(partial: Partial<PortRow> & Pick<PortRow, 'port' | 'pid' | 'project'>): PortRow {
  return {
    id: `${partial.port}:${partial.pid}`,
    process: 'node',
    projectPath: `/Users/dev/${partial.project}`,
    groupKey: `/Users/dev/${partial.project}`,
    state: 'live',
    stoppedAt: null,
    startable: false,
    starting: false,
    startError: null,
    startCommand: null,
    startCommandSource: null,
    memoryKb: 148 * 1024,
    namedUrl: null,
    risk: { level: 'safe', label: 'dev server', detail: 'Serves HTTP from a project directory under a development runtime. Safe to stop.' },

    protocol: 'http',
    title: null,
    uptimeSeconds: 600,
    cwd: `/Users/dev/${partial.project}`,
    command: 'npm run dev',
    variant: 'normal',
    ...partial,
  } as PortRow
}

/** Grouped populated state: one monorepo with three ports, three singles. */
export const GROUPED_ROWS: PortRow[] = [
  row({
    port: 3000,
    pid: 19128,
    project: 'Qafaza',
    process: 'ruby',
    title: 'Ruby on Rails 8.1.3.1',
    uptimeSeconds: 334710,
  }),
  row({
    port: 5173,
    pid: 71907,
    project: 'Qafaza',
    process: 'node',
    title: 'Qafaza — for masjids, madrasahs, and the community around them',
    uptimeSeconds: 350374,
  }),
  row({
    port: 8088,
    pid: 51888,
    project: 'Qafaza',
    process: 'node',
    title: 'React Native',
    uptimeSeconds: 697090,
  }),
  row({
    port: 4000,
    pid: 47058,
    project: 'printdrop',
    title: 'PrintDrop — print sensitive documents, then watch them vanish',
    uptimeSeconds: 180,
  }),
  row({
    port: 3001,
    pid: 95331,
    project: 'copyclipboard',
    process: 'ruby',
    title: 'Coplyx',
    uptimeSeconds: 924033,
  }),
  row({
    port: 3002,
    pid: 54927,
    project: 'facedetection',
    process: 'ruby',
    title: 'FaceApp — Attendance & Retention Platform',
    uptimeSeconds: 1016948,
  }),
]

/** A stopped row keeps its place inside its group, with Start available. */
export const STOPPED_ROW: PortRow = row({
  port: 5173,
  pid: 71907,
  project: 'Qafaza',
  title: 'Qafaza — for masjids, madrasahs, and the community around them',
  uptimeSeconds: 300,
  command: 'npm run dev',
  state: 'stopped',
  stoppedAt: Date.now() - 12_000,
  startable: true,
})

/**
 * The unfiltered list as it actually appears on the development machine: 8
 * servers buried under 31 daemons. This is the state the non-HTTP filter exists
 * to suppress, and the state that needs a scroll affordance.
 */
export const ALL_LISTENERS: PortRow[] = [
  ...GROUPED_ROWS,
  row({ port: 5000, pid: 5420, project: 'ControlCenter', process: 'ControlCenter', cwd: '/', projectPath: null, uptimeSeconds: 3636177 }),
  row({ port: 7000, pid: 5420, project: 'ControlCenter', process: 'ControlCenter', cwd: '/', projectPath: null, uptimeSeconds: 3636177 }),
  row({ port: 5037, pid: 14701, project: 'Qafaza', process: 'adb', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 2180850 }),
  row({ port: 5433, pid: 63397, project: 'postgresql@18', process: 'postgres', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 2673625 }),
  row({ port: 6379, pid: 5551, project: 'redis', process: 'redis-server', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 3636175 }),
  row({ port: 5554, pid: 5339, project: 'muhlat', process: 'qemu-system-aarch64', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 240 }),
  row({ port: 5555, pid: 5339, project: 'muhlat', process: 'qemu-system-aarch64', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 240 }),
  row({ port: 8554, pid: 5339, project: 'muhlat', process: 'qemu-system-aarch64', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 240 }),
  row({ port: 6402, pid: 5425, project: 'muhlat', process: 'netsimd', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 240 }),
  row({ port: 7681, pid: 5425, project: 'muhlat', process: 'netsimd', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 240 }),
  row({ port: 8081, pid: 92888, project: 'copyclipboard', title: 'React Native', uptimeSeconds: 1003872 }),
  row({ port: 9277, pid: 5581, project: 'mdaaquibjawed', process: 'stable', uptimeSeconds: 3636174 }),
  row({ port: 17550, pid: 9617, project: 'kotlin/daemon', process: 'java', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 90000 }),
  row({ port: 17638, pid: 10445, project: 'kotlin/daemon', process: 'java', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 90000 }),
  row({ port: 15292, pid: 6221, project: 'Adobe Desktop Service', process: 'Adobe Desktop Service', protocol: 'nonhttp', variant: 'nonhttp', cwd: '/', projectPath: null, uptimeSeconds: 3636166 }),
  row({ port: 15393, pid: 6221, project: 'Adobe Desktop Service', process: 'Adobe Desktop Service', protocol: 'nonhttp', variant: 'nonhttp', cwd: '/', projectPath: null, uptimeSeconds: 3636166 }),
  row({ port: 16494, pid: 6221, project: 'Adobe Desktop Service', process: 'Adobe Desktop Service', protocol: 'nonhttp', variant: 'nonhttp', cwd: '/', projectPath: null, uptimeSeconds: 3636166 }),
  row({ port: 58904, pid: 5394, project: 'rapportd', process: 'rapportd', protocol: 'nonhttp', variant: 'nonhttp', cwd: '/', projectPath: null, uptimeSeconds: 3636178 }),
  row({ port: 59743, pid: 31410, project: 'rubymine', process: 'rubymine', cwd: '/', projectPath: null, uptimeSeconds: 1561998 }),
  row({ port: 63342, pid: 31410, project: 'rubymine', process: 'rubymine', cwd: '/', projectPath: null, uptimeSeconds: 1561998 }),
  row({ port: 63666, pid: 9333, project: 'daemon/9.4.1', process: 'java', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 90000 }),
  row({ port: 64333, pid: 9333, project: 'daemon/9.4.1', process: 'java', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 90000 }),
]

export interface MockScenario {
  rows?: PortRow[]
  totalCount?: number
  showNonHttp?: boolean
  theme?: Theme
}

export function makeMockApi(scenario: MockScenario = {}): PortlyApi {
  let live = [...(scenario.rows ?? GROUPED_ROWS)]
  const total = scenario.totalCount ?? live.length
  const noop = async () => {}
  const noSubscription = (_cb: unknown) => () => {}

  return {
    async scan(): Promise<ScanResult> {
      return {
        rows: live,
        totalCount: total,
        hiddenCount: Math.max(0, total - live.length),
        servingCount: live.filter((r) => r.protocol === 'http' || r.protocol === 'https').length,
        hasUnresolved: live.some((r) => r.variant === 'permission'),
        scannedAt: Date.now(),
      }
    },
    async kill(pid, port): Promise<KillResult> {
      // Stays in place, marked stopped — it does not leave the list.
      live = live.map((r) =>
        r.pid === pid && r.port === port
          ? { ...r, state: 'stopped' as const, stoppedAt: Date.now(), startable: true }
          : r,
      )
      return { ok: true, signal: 'SIGTERM' }
    },
    async start(): Promise<StartResult> {
      return { ok: false, error: 'Start is unavailable outside the Electron app' }
    },
    async open(url) {
      window.open(url, '_blank', 'noopener')
    },
    showRowMenu: noop,
    async getSettings(): Promise<Settings> {
      return {
        refreshIntervalMs: 5000,
        showNonHttp: scenario.showNonHttp ?? false,
        launchAtLogin: false,
      }
    },
    setShowNonHttp: noop,
    openSettingsMenu: noop,
    quit: noop,
    hide: noop,
    setHeight: noop,
    async getTheme(): Promise<Theme> {
      if (scenario.theme) return scenario.theme
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    },
    onThemeChange: noSubscription,
    onShow: noSubscription,
    onSettingsChange: noSubscription,
    onScan: noSubscription,
  }
}

/** Default instance used by the renderer when no preload is present. */
export const mockApi: PortlyApi = makeMockApi({ rows: GROUPED_ROWS, totalCount: 39 })
