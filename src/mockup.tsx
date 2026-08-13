import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover } from './Popover'
import { makeMockApi } from './mockApi'
import type { PortRow, Theme } from '../shared/types'
import './tokens.css'
import './app.css'
import './mockup.css'

/**
 * Renders the real components (not a redrawn facsimile) at their true 400px
 * width, so the resting contrast of the action rail can be judged honestly.
 */

function row(p: Partial<PortRow> & Pick<PortRow, 'port' | 'pid' | 'project'>): PortRow {
  return {
    id: `${p.port}:${p.pid}`,
    process: 'node',
    projectPath: `/Users/dev/${p.project}`,
    groupKey: `/Users/dev/${p.project}`,
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
    cwd: `/Users/dev/${p.project}`,
    command: 'npm run dev',
    variant: 'normal',
    ...p,
  } as PortRow
}

/** A group of three plus two ungrouped. Uptimes order the group first. */
const LIST: PortRow[] = [
  row({ port: 3000, pid: 19128, project: 'Qafaza', process: 'ruby', title: 'Ruby on Rails 8.1.3.1', uptimeSeconds: 240, command: 'bin/rails server -p 3000' }),
  row({ port: 5173, pid: 71907, project: 'Qafaza', title: 'Qafaza — for masjids, madrasahs, and the community around them', uptimeSeconds: 300 }),
  row({ port: 8088, pid: 51888, project: 'Qafaza', title: 'React Native', uptimeSeconds: 700 }),
  row({ port: 4000, pid: 47058, project: 'printdrop', title: 'PrintDrop — print sensitive documents, then watch them vanish', uptimeSeconds: 900 }),
  row({ port: 3001, pid: 95331, project: 'copyclipboard', process: 'ruby', title: 'Coplyx', uptimeSeconds: 924033 }),
]

/** Non-HTTP rows: the Open slot must be empty, not disabled. */
const NON_HTTP: PortRow[] = [
  row({ port: 6379, pid: 5551, project: 'redis', process: 'redis-server', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 120, cwd: '/opt/homebrew/var/db/redis', command: '/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379' }),
  row({ port: 5433, pid: 63397, project: 'postgresql@18', process: 'postgres', protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 180, cwd: '/opt/homebrew/var/postgresql@18' }),
  row({ port: 4000, pid: 47058, project: 'printdrop', title: 'PrintDrop — print sensitive documents, then watch them vanish', uptimeSeconds: 900 }),
]

/**
 * The same list with two rows stopped, both keeping their slots inside Qafaza:
 * 5173 had its argv captured, 3000 is a Rails/puma server whose rewritten
 * process title could not be captured. Both stay; only one offers Start.
 */
const WITH_STOPPED: PortRow[] = LIST.map((r) => {
  if (r.port === 5173) {
    return { ...r, state: 'stopped' as const, stoppedAt: Date.now() - 12_000, startable: true }
  }
  if (r.port === 3000) {
    // Rails/puma: argv unrecoverable, but the binstub declares the command.
    return {
      ...r,
      state: 'stopped' as const,
      stoppedAt: Date.now() - 95_000,
      startable: true,
      startCommand: 'bin/rails server -p 3000',
      startCommandSource: 'inferred from Rails binstub + config.ru',
    }
  }
  return r
})

/** A datastore row, to show the escalated confirm. */
const DANGER_LIST: PortRow[] = [
  row({
    port: 5432, pid: 63397, project: 'postgresql@18', process: 'postgres',
    protocol: 'nonhttp', variant: 'nonhttp', uptimeSeconds: 2673625,
    cwd: '/opt/homebrew/var/postgresql@18',
    risk: { level: 'danger', label: 'database', detail: 'This looks like a datastore. Stopping it can lose writes that have not been flushed to disk.' },
  }),
  ...LIST.slice(3),
]

interface PanelSpec {
  key: string
  label: string
  note: string
  rows: PortRow[]
  total: number
  showNonHttp?: boolean
  /** Index of the row to put into a real hover state, if any. */
  hoverRow?: number
  /** Index of the row whose Stop button to click, to show the confirm state. */
  confirmRow?: number
}

const PANELS: PanelSpec[] = [
  {
    key: 'rest',
    label: '(a) At rest',
    note: 'Open and More sit at low contrast in a rail that is always reserved. Stop is absent. Inside the Qafaza group the port is the primary anchor; the page title has dropped to metadata. No PID anywhere.',
    rows: LIST,
    total: 39,
  },
  {
    key: 'hover',
    label: '(b) Row 2 hovered',
    note: 'Open and More rise to full contrast, Stop appears in the third slot, and the PID joins the metadata line. Uptime keeps its place — nothing moved, because the rail was already reserved.',
    rows: LIST,
    total: 39,
    hoverRow: 1,
  },
  {
    key: 'stopped',
    label: '(c) Stopped row, in place',
    note: 'Both stopped rows keep their slots inside Qafaza and both offer Start. 5173 came from captured argv; 3000 is Rails/puma, whose rewritten process title destroys its argv, so the command came from the project\u2019s own bin/rails binstub instead. Hovering either row shows exactly what Start will run, and where it came from.',
    rows: WITH_STOPPED,
    total: 39,
    hoverRow: 1,
  },
  {
    key: 'confirm',
    label: '(d) Stop confirm — safe',
    note: 'Reads with project and port, not PID. A chip says what stopping costs: this one is a dev server. Destructive action first, Cancel second, Esc cancels, and the row does not change height.',
    rows: LIST,
    total: 39,
    confirmRow: 3,
  },
  {
    key: 'confirm-danger',
    label: '(e) Stop confirm — database',
    note: 'The same control, escalated. A datastore is chipped in the warm colour and the verb becomes “Stop anyway”, because stopping Postgres and stopping Vite must not look identical at the moment you commit to it.',
    rows: DANGER_LIST,
    total: 39,
    showNonHttp: true,
    // Groups sort by freshest uptime, so the 30-day postgres row lands last.
    confirmRow: 2,
  },
  {
    key: 'nonhttp',
    label: '(c) Non-HTTP — Open slot empty',
    note: 'redis and postgres have no URL, so the first slot renders nothing — not a disabled button. Compare the alignment against printdrop below them. The hovered redis row shows Stop in the same third slot.',
    rows: NON_HTTP,
    total: NON_HTTP.length,
    showNonHttp: true,
    hoverRow: 0,
  },
]

/**
 * Drives real hover state rather than faking styles, so hover-only affordances
 * appear through the same code path users hit. React synthesises mouseenter
 * from a bubbling mouseover with no relatedTarget.
 */
function useSimulatedHover() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const panel of document.querySelectorAll('[data-hover-row]')) {
        const index = Number(panel.getAttribute('data-hover-row'))
        const target = panel.querySelectorAll('.row')[index]
        target?.dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }),
        )
      }
      // Drive the confirm through a real click on the real Stop button.
      for (const panel of document.querySelectorAll('[data-confirm-row]')) {
        const index = Number(panel.getAttribute('data-confirm-row'))
        const target = panel.querySelectorAll('.row')[index]
        target?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }))
        const stop = target?.querySelector<HTMLButtonElement>('[data-role="stop"]')
        stop?.click()
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [])
}

function Band({ theme }: { theme: Theme }) {
  return (
    <section className="band" data-theme={theme} data-band={theme}>
      <div className="band-title">{theme}</div>
      <div className="band-panels">
        {PANELS.map((panel) => (
          <div
            className="panel"
            key={panel.key}
            data-panel-key={theme === 'light' ? panel.key : `${panel.key}-dark`}
            {...(panel.hoverRow !== undefined ? { 'data-hover-row': panel.hoverRow } : {})}
            {...(panel.confirmRow !== undefined ? { 'data-confirm-row': panel.confirmRow } : {})}
          >
            <div className="panel-label">{panel.label}</div>
            <Popover
              api={makeMockApi({
                rows: panel.rows,
                totalCount: panel.total,
                showNonHttp: panel.showNonHttp,
                // Every instance reports light so it never stomps the root; the
                // dark band's wrapper overrides the tokens for its subtree.
                theme: 'light',
              })}
            />
            <div className="panel-note">{panel.note}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function Sheet() {
  useSimulatedHover()
  return (
    <div className="sheet">
      <Band theme="light" />
      <Band theme="dark" />
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('mockup: #root missing')
document.documentElement.dataset.theme = 'light'

createRoot(container).render(
  <StrictMode>
    <Sheet />
  </StrictMode>,
)
