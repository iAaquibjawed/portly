import { userInfo } from 'node:os'
import http from 'node:http'
import https from 'node:https'
import { isPortListening, parseLsofFields, readCwds, sh, wait } from './exec'
import { resolveProjects, type ProjectInput } from './project'
import { basename } from 'node:path'
import { captureCommand, getCapture, getStartState, groupKeyFor } from './restart'
import { assessStopRisk } from './risk'
import { namedUrlFor, readPortlessRoutes } from './portless'
import type { PortRow, Protocol, ScanResult, Variant } from '../shared/types'

const CURRENT_USER = userInfo().username

/** Ports whose protocol we know without touching the socket. */
const KNOWN_NONHTTP_PORTS = new Set([
  22, 25, 53, 587, 1433, 2181, 3306, 5432, 5433, 5672, 6379, 9092, 11211, 27017, 27018, 27019,
])

/** Process names that are never HTTP servers, regardless of port. */
const NONHTTP_PROCESSES =
  /^(postgres|postmaster|mysqld|mariadbd|redis-server|mongod|memcached|rabbitmq|beam\.smp|sshd|dnsmasq|mDNSResponder|adb|qemu-|netsimd)/i

const PROBE_TIMEOUT_MS = 500
const TITLE_MAX_LEN = 80
const TITLE_TTL_MS = 30_000
/**
 * How long a stopped row keeps its place in the list. After this it disappears
 * outright — it never migrates to a separate section.
 */
const STOPPED_WINDOW_MS = 10 * 60_000

interface ProbeCacheEntry {
  protocol: Protocol
  title: string | null
  titleAt: number
}

/** A row Portly stopped, held in place so the user does not lose it. */
interface StoppedEntry {
  /** The last known live row, so it renders in exactly its old position. */
  row: PortRow
  stoppedAt: number
}

const probeCache = new Map<string, ProbeCacheEntry>()
/** Keyed by port: whichever pid held it, the port is what the user sees. */
const stopped = new Map<number, StoppedEntry>()
let lastSeen = new Map<string, PortRow>()

/** `*:5173` / `127.0.0.1:6379` / `[::1]:3000` -> host + port */
function parseAddress(name: string): { host: string; port: number } | null {
  const colon = name.lastIndexOf(':')
  if (colon === -1) return null
  const port = Number.parseInt(name.slice(colon + 1), 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  const host = name.slice(0, colon).replace(/^\[|\]$/g, '')
  return { host, port }
}

/**
 * Which addresses to actually probe. A wildcard bind is reachable on both
 * loopback families; an explicit bind is only reachable where it was bound —
 * Vite defaults to IPv6 localhost, so assuming 127.0.0.1 misses it entirely.
 */
function candidateHosts(hosts: Iterable<string>): string[] {
  const out: string[] = []
  for (const host of hosts) {
    if (host === '*' || host === '0.0.0.0' || host === '::') out.push('127.0.0.1', '::1')
    else out.push(host)
  }
  return [...new Set(out)]
}

/** `[[dd-]hh:]mm:ss` -> seconds */
function parseEtime(raw: string): number {
  const text = raw.trim()
  if (!text) return 0
  let days = 0
  let rest = text
  const dash = text.indexOf('-')
  if (dash !== -1) {
    days = Number.parseInt(text.slice(0, dash), 10) || 0
    rest = text.slice(dash + 1)
  }
  const parts = rest.split(':').map((p) => Number.parseInt(p, 10) || 0)
  let hours = 0
  let minutes = 0
  let seconds = 0
  if (parts.length === 3) [hours, minutes, seconds] = parts
  else if (parts.length === 2) [minutes, seconds] = parts
  else if (parts.length === 1) [seconds] = parts
  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

interface ProcFacts {
  uptimeSeconds: number
  command: string | null
  /** Executable path from `comm`, which is never truncated. */
  comm: string | null
  /** Resident set size in KB. */
  rssKb: number | null
}

/**
 * Two ps calls. etime never contains a space so it can share a line with argv,
 * but `comm` can contain spaces, so it gets its own call where it is the only
 * trailing field — lsof's own command field is truncated at ~31 characters,
 * which is what produced "Creative Cloud Libraries Synchr" cut mid-word.
 */
async function readProcFacts(pids: number[]): Promise<Map<number, ProcFacts>> {
  const out = new Map<number, ProcFacts>()
  if (!pids.length) return out

  const [argv, comm] = await Promise.all([
    sh('ps', ['-o', 'pid=,etime=,rss=,command=', '-p', pids.join(',')]),
    sh('ps', ['-o', 'pid=,comm=', '-p', pids.join(',')]),
  ])

  for (const line of argv.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\S+)\s+(\d+)\s*(.*)$/.exec(line)
    if (!match) continue
    out.set(Number.parseInt(match[1], 10), {
      uptimeSeconds: parseEtime(match[2]),
      rssKb: Number.parseInt(match[3], 10) || null,
      command: match[4].trim() || null,
      comm: null,
    })
  }
  for (const line of comm.stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const entry = out.get(Number.parseInt(match[1], 10))
    if (entry) entry.comm = match[2].trim() || null
  }
  return out
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, body: string) => {
    const token = body.toLowerCase()
    let code: number | null = null
    if (token.startsWith('#x')) code = Number.parseInt(token.slice(2), 16)
    else if (token.startsWith('#')) code = Number.parseInt(token.slice(1), 10)
    if (code !== null) {
      return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match
    }
    return NAMED_ENTITIES[token] ?? match
  })
}

function cleanTitle(raw: string): string | null {
  const text = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > TITLE_MAX_LEN ? `${text.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…` : text
}

/**
 * One HTTP(S) request to a listener. Resolves to the page title, `null` if it
 * spoke the protocol but offered no usable title, or `false` if it never
 * answered (i.e. it is not an HTTP server at that address).
 */
function requestTitle(
  scheme: 'http' | 'https',
  host: string,
  port: number,
): Promise<string | null | false> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null | false) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    const mod = scheme === 'http' ? http : https
    const req = mod.request(
      {
        host,
        port,
        path: '/',
        method: 'GET',
        timeout: PROBE_TIMEOUT_MS,
        headers: { 'User-Agent': 'Portly', Accept: 'text/html' },
        ...(scheme === 'https' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const status = res.statusCode ?? 0
        const type = String(res.headers['content-type'] || '')
        // It answered, so the protocol is settled. An error page's title is
        // noise ("404 Not Found"), so only 2xx/3xx bodies get read.
        if (!type.includes('html') || status >= 400) {
          res.destroy()
          finish(null)
          return
        }

        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
          // <title> lives in <head>; no need to buffer a whole SPA payload.
          if (body.length > 64 * 1024 || /<\/title>/i.test(body)) res.destroy()
        })
        const done = () => {
          const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
          finish(match ? cleanTitle(match[1]) : null)
        }
        res.on('end', done)
        res.on('close', done)
        res.on('error', () => finish(null))
      },
    )

    req.on('timeout', () => {
      req.destroy()
      finish(false)
    })
    req.on('error', () => finish(false))
    req.end()
  })
}

/** Probes every candidate address for one scheme; first answer wins. */
async function probeScheme(
  scheme: 'http' | 'https',
  hosts: string[],
  port: number,
): Promise<string | null | false> {
  const results = await Promise.all(hosts.map((host) => requestTitle(scheme, host, port)))
  for (const result of results) {
    if (result !== false) return result
  }
  return false
}

async function probe(
  key: string,
  port: number,
  command: string,
  hosts: string[],
): Promise<{ protocol: Protocol; title: string | null }> {
  const cached = probeCache.get(key)
  const titleFresh = cached && Date.now() - cached.titleAt < TITLE_TTL_MS

  if (cached && (cached.protocol === 'nonhttp' || titleFresh)) {
    return { protocol: cached.protocol, title: cached.title }
  }

  if (KNOWN_NONHTTP_PORTS.has(port) || NONHTTP_PROCESSES.test(command)) {
    probeCache.set(key, { protocol: 'nonhttp', title: null, titleAt: Date.now() })
    return { protocol: 'nonhttp', title: null }
  }

  let protocol: Protocol = 'nonhttp'
  let title: string | null = null

  const overHttp = await probeScheme('http', hosts, port)
  if (overHttp !== false) {
    protocol = 'http'
    title = overHttp
  } else {
    const overHttps = await probeScheme('https', hosts, port)
    if (overHttps !== false) {
      protocol = 'https'
      title = overHttps
    }
  }

  probeCache.set(key, { protocol, title, titleAt: Date.now() })
  return { protocol, title }
}

/**
 * Decorates a stopped row with its live start state.
 *
 * `startable` is resolved here, per scan, so it reflects whether a usable
 * command actually exists right now. It has no bearing on whether the row is
 * shown: every row Portly stopped stays visible for the full window, whether or
 * not it can be started again.
 */
function stoppedRow(entry: StoppedEntry): PortRow {
  const state = getStartState(entry.row.port, entry.row.groupKey)
  const capture = getCapture(entry.row.port, entry.row.groupKey)
  return {
    ...entry.row,
    state: 'stopped',
    stoppedAt: entry.stoppedAt,
    startable: capture !== null,
    starting: state?.starting ?? false,
    startError: state?.error ?? null,
    startCommand: capture?.command ?? null,
    startCommandSource: capture
      ? capture.source === 'inferred'
        ? `inferred from ${capture.sourceDetail ?? 'project config'}`
        : 'captured argv'
      : null,
  }
}

/**
 * Prunes the stopped set. A stopped row is kept for the whole stopped window and
 * then disappears outright, rather than moving anywhere.
 */
function pruneStopped(livePorts: Set<number>) {
  const now = Date.now()
  for (const [port, entry] of stopped) {
    // Two reasons only: the port is serving again, or the window elapsed.
    // Whether it is restartable is deliberately NOT a reason — a row the user
    // just stopped must not vanish because Portly could not capture its argv.
    const expired = now - entry.stoppedAt > STOPPED_WINDOW_MS
    if (livePorts.has(port) || expired) stopped.delete(port)
  }
}

export async function scan(showNonHttp: boolean): Promise<ScanResult> {
  const { stdout, failed } = await sh('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-FpcnL'])

  if (failed) {
    return {
      rows: [],
      totalCount: 0,
      hiddenCount: 0,
      servingCount: 0,
      hasUnresolved: false,
      scannedAt: Date.now(),
    }
  }

  // Collapse the IPv4/IPv6 pair lsof reports for the same listener, keeping
  // every address it answers on so the protocol probe knows where to knock.
  interface Listener {
    pid: number
    port: number
    command: string
    user: string
    hosts: Set<string>
  }
  const seen = new Map<string, Listener>()
  for (const set of parseLsofFields(stdout)) {
    for (const name of set.names) {
      const address = parseAddress(name)
      if (!address) continue
      const id = `${address.port}:${set.pid}`
      const existing = seen.get(id)
      if (existing) {
        existing.hosts.add(address.host)
      } else {
        seen.set(id, {
          pid: set.pid,
          port: address.port,
          command: set.command,
          user: set.user,
          hosts: new Set([address.host]),
        })
      }
    }
  }

  const pids = [...new Set([...seen.values()].map((s) => s.pid))]
  const [cwds, procFacts] = await Promise.all([readCwds(pids), readProcFacts(pids)])
  // Best-effort: absent or unfamiliar portless state simply yields no names.
  const portlessRoutes = readPortlessRoutes()

  // Project names are resolved for the whole list at once, since uniqueness is
  // a property of the list.
  /**
   * The display name comes from ps's `comm`, not lsof's command field, which
   * truncates at ~31 characters and cuts names mid-word.
   *
   * `comm` is only a path for normal processes. A server that rewrote its
   * process title reports the title here instead, and taking a basename of
   * `puma 7.2.0 (tcp://0.0.0.0:3000) [backend]` yields the garbage
   * `0.0.0.0:3000) [backend]`. So paths get a basename and anything else gets
   * its leading token, which is the actual program name.
   */
  const fallbackName = (pid: number, lsofCommand: string) => {
    const comm = procFacts.get(pid)?.comm
    if (!comm) return lsofCommand
    const name = comm.startsWith('/') ? basename(comm) : comm.trim().split(/\s+/)[0]
    return name || lsofCommand
  }

  const projectInputs: ProjectInput[] = [...seen.entries()].map(([id, info]) => ({
    id,
    cwd: cwds.get(info.pid) ?? null,
    fallback: fallbackName(info.pid, info.command),
  }))
  const projects = await resolveProjects(projectInputs)

  const rows = await Promise.all(
    [...seen.entries()].map(async ([id, info]) => {
      const cwd = cwds.get(info.pid) ?? null
      const foreign = Boolean(info.user) && info.user !== CURRENT_USER
      const unresolved = !cwd && foreign

      const { protocol, title } = unresolved
        ? { protocol: 'unknown' as Protocol, title: null }
        : await probe(id, info.port, info.command, candidateHosts(info.hosts))

      const variant: Variant = unresolved
        ? 'permission'
        : protocol === 'nonhttp'
          ? 'nonhttp'
          : 'normal'

      const resolved = projects.get(id)
      const displayProcess = unresolved ? 'unknown' : fallbackName(info.pid, info.command)

      const row: PortRow = {
        id,
        port: info.port,
        pid: info.pid,
        process: displayProcess,
        project: unresolved ? '(unresolved)' : (resolved?.name ?? displayProcess),
        projectPath: unresolved ? null : (resolved?.path ?? null),
        groupKey: groupKeyFor(
          unresolved ? null : (resolved?.path ?? null),
          unresolved ? 'unknown' : displayProcess,
        ),
        state: 'live',
        stoppedAt: null,
        startable: false,
        starting: false,
        startError: null,
        startCommand: null,
        startCommandSource: null,
        memoryKb: procFacts.get(info.pid)?.rssKb ?? null,
        namedUrl: namedUrlFor(portlessRoutes, info.port, info.pid),
        risk: assessStopRisk({
          process: displayProcess,
          port: info.port,
          protocol,
          projectPath: unresolved ? null : (resolved?.path ?? null),
          uptimeSeconds: procFacts.get(info.pid)?.uptimeSeconds ?? 0,
          cwd,
          variant,
        }),
        protocol,
        title,
        uptimeSeconds: procFacts.get(info.pid)?.uptimeSeconds ?? 0,
        cwd,
        command: unresolved ? null : (procFacts.get(info.pid)?.command ?? null),
        variant,
      }
      return row
    }),
  )

  const livePorts = new Set(rows.map((r) => r.port))
  pruneStopped(livePorts)

  // Stopped rows sit alongside live ones, sorted by port, so each keeps exactly
  // the position it had in its group.
  const visible = [
    ...rows.filter((r) => showNonHttp || r.variant !== 'nonhttp'),
    ...[...stopped.values()].map(stoppedRow),
  ].sort((a, b) => a.port - b.port)

  const now = Date.now()
  lastSeen = new Map(rows.map((r) => [r.id, r]))

  const servingCount = rows.filter(
    (r) => r.protocol === 'http' || r.protocol === 'https',
  ).length

  return {
    rows: visible,
    totalCount: rows.length,
    hiddenCount: rows.length - visible.length,
    servingCount,
    hasUnresolved: rows.some((r) => r.variant === 'permission'),
    scannedAt: now,
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** SIGTERM first so the process can clean up; SIGKILL only if it refuses. */
export async function kill(pid: number, port: number) {
  const row = lastSeen.get(`${port}:${pid}`)

  // Capture the command while the process is still alive — this is the only
  // moment Start can ever be made possible. A failed capture costs the row its
  // Start action, nothing more.
  if (row) {
    await captureCommand(
      pid,
      row.cwd,
      row.port,
      row.groupKey,
      row.process,
      true,
      row.projectPath,
    )
  }

  const finish = (result: { ok: boolean; signal: 'SIGTERM' | 'SIGKILL' | null; error?: string }) => {
    // Every row Portly stopped keeps its place, restartable or not. Anything
    // else makes the list behave differently depending on which server it was.
    if (result.ok && row) {
      stopped.set(row.port, { row, stoppedAt: Date.now() })
    }
    return result
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return finish({ ok: true, signal: null })
    return {
      ok: false,
      signal: null,
      error: code === 'EPERM' ? 'Not permitted — process belongs to another user' : String(code),
    }
  }

  for (let i = 0; i < 15 && isAlive(pid); i++) await wait(100)

  if (isAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // raced with an exit; the poll below settles it
    }
    for (let i = 0; i < 10 && isAlive(pid); i++) await wait(100)
    if (isAlive(pid)) {
      return { ok: false, signal: 'SIGKILL' as const, error: 'Process did not exit' }
    }
    return finish({ ok: true, signal: 'SIGKILL' })
  }

  return finish({ ok: true, signal: 'SIGTERM' })
}

/** Called after a successful start; the live listener supersedes the stub. */
export function forgetStopped(port: number) {
  stopped.delete(port)
}

/** The stopped rows as the renderer sees them, with fresh start state. */
export function stoppedSnapshot(): PortRow[] {
  return [...stopped.values()].map(stoppedRow)
}

export { isPortListening }
