import { existsSync, readFileSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Reads route registrations from portless (vercel-labs/portless), which replaces
 * port numbers with stable `.localhost` names and proxies to whatever port the
 * dev server actually picked.
 *
 * portless solves the same problem from the opposite direction — it hides ports,
 * Portly reveals them — and it ships no UI of its own. So when a listener is
 * behind a portless route, Portly shows the name alongside the port and opens the
 * pretty URL.
 *
 * Read-only and deliberately paranoid. portless is pre-1.0 and its README states
 * outright that "the state directory format may change between releases", so every
 * failure here is silent: an unreadable, missing or unfamiliar file simply means
 * no names, and rows render exactly as they did before.
 *
 * Verified against portless 0.15.5: `routes.json` is a JSON array of
 * `{ hostname, port, pid }`, so a route matches a listener on the same
 * `port + pid` identity Portly already keys on.
 */

export interface PortlessRoute {
  hostname: string
  port: number
  pid: number
}

/** Both state directories portless uses: per-user, and the one it falls back to
 *  when the proxy is running under sudo. */
function stateDirs(): string[] {
  return [
    join(homedir(), '.portless'),
    process.platform === 'win32' ? join(tmpdir(), 'portless') : '/tmp/portless',
  ]
}

interface Cached {
  routes: PortlessRoute[]
  /** Directory the routes came from, and the mtime we read it at. */
  signature: string
  readAt: number
}

let cache: Cached | null = null
const CACHE_TTL_MS = 2_000

function parseRoutes(raw: string): PortlessRoute[] {
  const parsed: unknown = JSON.parse(raw)
  // The shipped implementation bails on anything that is not an array, and so do we.
  if (!Array.isArray(parsed)) return []

  const routes: PortlessRoute[] = []
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const hostname = record.hostname
    const port = record.port
    const pid = record.pid
    if (typeof hostname !== 'string' || !hostname) continue
    if (typeof port !== 'number' || !Number.isFinite(port)) continue
    routes.push({
      hostname,
      port,
      pid: typeof pid === 'number' && Number.isFinite(pid) ? pid : 0,
    })
  }
  return routes
}

/**
 * portless enables HTTPS by default and writes a `proxy.tls` marker into its
 * state directory. Absence of the marker means `--no-tls` was used.
 */
function schemeFor(dir: string): 'http' | 'https' {
  try {
    return existsSync(join(dir, 'proxy.tls')) ? 'https' : 'http'
  } catch {
    return 'https'
  }
}

interface RouteTable {
  /** Keyed `port:pid`, then by port alone as a fallback. */
  byPortPid: Map<string, string>
  byPort: Map<number, string>
}

const EMPTY: RouteTable = { byPortPid: new Map(), byPort: new Map() }

/** Named URLs for every live portless route, or an empty table. */
export function readPortlessRoutes(): RouteTable {
  const now = Date.now()

  for (const dir of stateDirs()) {
    const path = join(dir, 'routes.json')
    let signature: string
    try {
      if (!existsSync(path)) continue
      const stat = statSync(path)
      signature = `${path}:${stat.mtimeMs}:${stat.size}`
    } catch {
      continue
    }

    if (cache && cache.signature === signature && now - cache.readAt < CACHE_TTL_MS) {
      return toTable(cache.routes, schemeFor(dir))
    }

    try {
      const routes = parseRoutes(readFileSync(path, 'utf8'))
      cache = { routes, signature, readAt: now }
      return toTable(routes, schemeFor(dir))
    } catch {
      // Corrupt or mid-write. Fall through to the next directory, then to empty.
      continue
    }
  }

  return EMPTY
}

function toTable(routes: PortlessRoute[], scheme: 'http' | 'https'): RouteTable {
  const byPortPid = new Map<string, string>()
  const byPort = new Map<number, string>()
  for (const route of routes) {
    const url = `${scheme}://${route.hostname}`
    if (route.pid) byPortPid.set(`${route.port}:${route.pid}`, url)
    // Last writer wins on bare port; the pid-qualified key is preferred anyway.
    byPort.set(route.port, url)
  }
  return { byPortPid, byPort }
}

/** The named URL for one listener, preferring an exact port+pid match. */
export function namedUrlFor(table: RouteTable, port: number, pid: number): string | null {
  return table.byPortPid.get(`${port}:${pid}`) ?? table.byPort.get(port) ?? null
}
