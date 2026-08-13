import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Popover } from './Popover'
import { makeMockApi } from './mockApi'
import type { PortRow, Theme } from '../shared/types'
import './tokens.css'
import './app.css'
import './hero.css'

/**
 * The README hero: the real Popover component at its true 400px width, light and
 * dark, with sample data. No annotations, no panel chrome.
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

const ROWS: PortRow[] = [
  row({ port: 3000, pid: 19128, project: 'Qafaza', process: 'ruby', title: 'Ruby on Rails 8.1.3.1', uptimeSeconds: 240, command: 'bin/rails server -p 3000' }),
  row({ port: 5173, pid: 71907, project: 'Qafaza', title: 'Qafaza — for masjids, madrasahs, and the community around them', uptimeSeconds: 300 }),
  row({ port: 8088, pid: 51888, project: 'Qafaza', title: 'React Native', uptimeSeconds: 700 }),
  row({ port: 4000, pid: 47058, project: 'printdrop', title: 'PrintDrop — print sensitive documents, then watch them vanish', uptimeSeconds: 900 }),
  row({ port: 3001, pid: 95331, project: 'copyclipboard', process: 'ruby', title: 'Coplyx', uptimeSeconds: 924033 }),
]

function Pane({ theme }: { theme: Theme }) {
  return (
    <div className="hero-pane" data-theme={theme}>
      <Popover api={makeMockApi({ rows: ROWS, totalCount: 39, theme: 'light' })} />
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('hero: #root missing')
document.documentElement.dataset.theme = 'light'

createRoot(container).render(
  <StrictMode>
    <div className="hero">
      <Pane theme="light" />
      <Pane theme="dark" />
    </div>
  </StrictMode>,
)
