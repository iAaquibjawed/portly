import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isPortListening, readCwds, sh, wait } from './exec'
import { inferStartCommand } from './infer'

/**
 * Start is deliberately narrow: it re-runs a command Portly itself captured at
 * the moment it stopped a listener. It never reconstructs a command, and never
 * offers to start something it did not stop.
 */

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh'])

/** Session and supervisor processes: the walk always stops here. */
const SUPERVISORS = new Set([
  'login',
  'launchd',
  'systemd',
  'init',
  'tmux',
  'screen',
  'sshd',
  'su',
  'sudo',
])

/**
 * A shell invoked with -c is a wrapper some tool inserted (npm runs scripts
 * containing shell operators via `sh -c`). We walk *through* those to reach the
 * command the user actually typed, but never capture the shell itself. A shell
 * without -c is the user's interactive session, and the walk stops there.
 */
function hasDashC(command: string): boolean {
  return /\s-[a-zA-Z]*c(\s|$)/.test(command)
}

/** A real command is short. A captured shell snapshot or eval blob is not. */
const MAX_COMMAND_LEN = 400

/**
 * Servers that call setproctitle (puma, postgres, unicorn) replace their argv
 * with a human-readable status line, so `ps -o command=` hands back a display
 * string rather than something executable. Verified: the captured value for a
 * Rails/puma listener is `puma 7.2.0 (tcp://0.0.0.0:3001) [backend]`, and
 * `zsh -l -c` on that returns `zsh:1: number expected`. Brackets and parens are
 * the reliable tell, and they are shell metacharacters no plain command line
 * carries unquoted.
 */
const REWRITTEN_TITLE = /[()\[\]]/

/** POSIX single-quote escaping, for anything interpolated into `-c`. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Can the login shell actually find argv0? Absolute paths must exist. */
async function argv0IsRunnable(command: string): Promise<boolean> {
  const first = command.trim().split(/\s+/)[0] ?? ''
  if (!first) return false
  if (first.startsWith('/')) return existsSync(first)
  const shell = process.env.SHELL || '/bin/zsh'
  const { stdout } = await sh(shell, ['-l', '-c', `command -v ${shellQuote(first)}`], 4000)
  return stdout.trim().length > 0
}

const MAX_WALK_DEPTH = 12
const CAPTURE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FAIL_FAST_MS = 3_000
const LISTEN_TIMEOUT_MS = 10_000
const POLL_INTERVAL_MS = 400
const LOG_TAIL_BYTES = 2_000

export interface CapturedCommand {
  port: number
  project: string
  /** Full argv of the highest in-cwd ancestor, e.g. `npm run dev`. */
  command: string
  cwd: string
  processName: string
  capturedAt: number
  /**
   * `argv` is ground truth read from the live process. `inferred` was derived
   * from the project's own declared configuration because the process had
   * overwritten its argv. Shown to the user either way.
   */
  source: 'argv' | 'inferred'
  /** For inferred commands: which file it came from. */
  sourceDetail?: string
}

export interface ChainStep {
  pid: number
  argv0: string
  cwd: string | null
  command: string
  verdict: 'listener' | 'adopted' | 'stepped-over-wrapper' | 'stop'
}

/** Every stage of the ancestor walk, so a failed capture can be explained. */
export interface CaptureDiagnostics {
  ok: boolean
  listeningPid: number
  ancestorPid: number | null
  command: string | null
  cwd: string | null
  chain: ChainStep[]
  reason: string
  source?: 'argv' | 'inferred'
}

export interface StartState {
  starting: boolean
  error: string | null
}

const captures = new Map<string, CapturedCommand>()
const startStates = new Map<string, StartState>()

let storePath: string | null = null
let logDir: string | null = null

const keyFor = (port: number, project: string) => `${port}::${project}`

export function initRestartStore(userDataDir: string) {
  storePath = join(userDataDir, 'restart-store.json')
  logDir = join(userDataDir, 'logs')
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    // logging is best-effort
  }
  load()
}

function load() {
  if (!storePath || !existsSync(storePath)) return
  try {
    const raw = JSON.parse(readFileSync(storePath, 'utf8')) as CapturedCommand[]
    const now = Date.now()
    for (const entry of raw) {
      if (
        entry &&
        typeof entry.command === 'string' &&
        typeof entry.cwd === 'string' &&
        now - entry.capturedAt < CAPTURE_TTL_MS
      ) {
        captures.set(keyFor(entry.port, entry.project), {
          ...entry,
          source: entry.source ?? 'argv',
        })
      }
    }
  } catch {
    // A corrupt store just means nothing is startable yet.
  }
}

function persistStore() {
  if (!storePath) return
  try {
    writeFileSync(storePath, JSON.stringify([...captures.values()], null, 2))
  } catch {
    // Not worth failing a kill over.
  }
}

function expire() {
  const now = Date.now()
  for (const [key, entry] of captures) {
    if (now - entry.capturedAt >= CAPTURE_TTL_MS) captures.delete(key)
  }
}

/** First token of an argv string, without a login shell's leading dash. */
function argv0(command: string): string {
  const first = command.trim().split(/\s+/)[0] ?? ''
  return basename(first).replace(/^-/, '')
}

interface ProcInfo {
  ppid: number
  command: string
}

async function processTable(): Promise<Map<number, ProcInfo>> {
  const table = new Map<number, ProcInfo>()
  const { stdout } = await sh('ps', ['-ax', '-o', 'pid=,ppid=,command='])
  for (const line of stdout.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    table.set(Number.parseInt(match[1], 10), {
      ppid: Number.parseInt(match[2], 10),
      command: match[3],
    })
  }
  return table
}

/**
 * Walks up from the listening pid to the highest ancestor still rooted in the
 * same cwd, and returns that process's argv.
 *
 * `npm run dev` spawns `vite`; capturing the listening child would give us
 * `node .../vite`, which on restart runs orphaned from npm and leaves the
 * user's terminal showing a dead script. The ancestor is what they actually ran.
 */
export async function captureCommand(
  pid: number,
  cwd: string | null,
  port: number,
  projectKey: string,
  processName: string,
  persist = true,
  projectPath: string | null = null,
): Promise<CaptureDiagnostics> {
  const chain: ChainStep[] = []

  const store = (command: string, at: string, source: 'argv' | 'inferred', detail?: string) => {
    if (!persist) return
    expire()
    captures.set(keyFor(port, projectKey), {
      port,
      project: projectKey,
      command,
      cwd: at,
      processName,
      capturedAt: Date.now(),
      source,
      sourceDetail: detail,
    })
    persistStore()
  }

  /**
   * argv was unusable. Before giving up, ask the project what it declares — a
   * Rails app states its own start command in a binstub even though puma has
   * destroyed the argv that launched it.
   */
  const fail = (reason: string): CaptureDiagnostics => {
    const inferred = inferStartCommand(cwd, projectPath, port)
    if (inferred) {
      store(inferred.command, inferred.cwd, 'inferred', inferred.source)
      return {
        ok: true,
        listeningPid: pid,
        ancestorPid: null,
        command: inferred.command,
        cwd: inferred.cwd,
        chain,
        reason: `${reason}; inferred from ${inferred.source}`,
        source: 'inferred',
      }
    }
    return {
      ok: false,
      listeningPid: pid,
      ancestorPid: null,
      command: null,
      cwd,
      chain,
      reason,
      source: undefined,
    }
  }

  if (!cwd) return fail('no cwd for the listening process')

  const table = await processTable()
  if (!table.has(pid)) return fail('listening pid not in the process table')

  // Collect the ancestor pids first so cwds can be read in one lsof call.
  const ancestorPids: number[] = []
  let cursor = pid
  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const info = table.get(cursor)
    if (!info || info.ppid <= 1) break
    ancestorPids.push(info.ppid)
    cursor = info.ppid
  }

  const cwds = ancestorPids.length
    ? await readCwds(ancestorPids)
    : new Map<number, string>()

  let candidate = pid
  cursor = pid
  chain.push({
    pid,
    argv0: argv0(table.get(pid)?.command ?? ''),
    cwd,
    command: table.get(pid)?.command ?? '',
    verdict: 'listener',
  })

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const info = table.get(cursor)
    if (!info) break
    const parent = info.ppid
    if (parent <= 1) break

    const parentInfo = table.get(parent)
    if (!parentInfo) break

    const name = argv0(parentInfo.command)
    const parentCwd = cwds.get(parent) ?? null
    const step = (verdict: ChainStep['verdict']) =>
      chain.push({ pid: parent, argv0: name, cwd: parentCwd, command: parentInfo.command, verdict })

    // Sessions and supervisors are never the user's command.
    if (SUPERVISORS.has(name)) {
      step('stop')
      break
    }
    // Stop at the first ancestor that left the project directory.
    if (parentCwd !== cwd) {
      step('stop')
      break
    }

    if (SHELLS.has(name)) {
      // An interactive/login shell is where the user typed; stop below it.
      if (!hasDashC(parentInfo.command)) {
        step('stop')
        break
      }
      // A `-c` wrapper is machinery: step over it without capturing it.
      step('stepped-over-wrapper')
      cursor = parent
      continue
    }

    step('adopted')
    candidate = parent
    cursor = parent
  }

  const command = table.get(candidate)?.command?.trim()
  const name = command ? argv0(command) : ''
  if (!command) return fail('no argv for the chosen ancestor')
  if (command.length > MAX_COMMAND_LEN) return fail('argv too long to be a real command')
  if (SHELLS.has(name) || SUPERVISORS.has(name)) return fail(`chosen ancestor is a ${name}`)
  // A bare interpreter with no script cannot be re-run.
  if (!/\s/.test(command)) return fail(`argv is a bare interpreter with no script: ${command}`)
  // A rewritten process title is not a command, however plausible it looks.
  if (REWRITTEN_TITLE.test(command)) {
    return fail(`argv is a rewritten process title, not a command: ${command}`)
  }
  if (!(await argv0IsRunnable(command))) {
    return fail(`the login shell cannot resolve argv0 of: ${command}`)
  }

  store(command, cwd, 'argv')

  return {
    ok: true,
    listeningPid: pid,
    ancestorPid: candidate,
    command,
    cwd,
    chain,
    reason:
      candidate === pid ? 'no eligible ancestor; captured the listener itself' : 'captured ancestor',
    source: 'argv',
  }
}

export function getCapture(port: number, projectKey: string): CapturedCommand | null {
  expire()
  return captures.get(keyFor(port, projectKey)) ?? null
}

export function dropCapture(port: number, project: string) {
  if (captures.delete(keyFor(port, project))) persistStore()
  startStates.delete(keyFor(port, project))
}

export function getStartState(port: number, projectKey: string): StartState | null {
  return startStates.get(keyFor(port, projectKey)) ?? null
}

/** Stable grouping/capture key: a path never collides, a display name can. */
export function groupKeyFor(projectPath: string | null, processName: string): string {
  return projectPath ?? `proc:${processName}`
}

function readLogTail(port: number): string {
  if (!logDir) return ''
  try {
    const text = readFileSync(join(logDir, `start-${port}.log`), 'utf8')
    return text.slice(-LOG_TAIL_BYTES).trim()
  } catch {
    return ''
  }
}

/** Last non-empty line, which is almost always the actual error. */
function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1].slice(0, 300) : ''
}

/**
 * Re-spawns a captured command through the user's login shell so nvm/pyenv/rbenv
 * shims and profile env are present — Electron's own environment would pick the
 * wrong runtime or none at all.
 */
export async function startCapture(
  port: number,
  projectKey: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = keyFor(port, projectKey)
  const entry = getCapture(port, projectKey)
  if (!entry) return { ok: false, error: 'No captured command for this port' }
  if (startStates.get(key)?.starting) return { ok: false, error: 'Already starting' }

  if (!existsSync(entry.cwd)) {
    const error = `Working directory no longer exists: ${entry.cwd}`
    startStates.set(key, { starting: false, error })
    return { ok: false, error }
  }

  startStates.set(key, { starting: true, error: null })

  const shell = process.env.SHELL || '/bin/zsh'
  // Output goes to a file, not a pipe, so the child stays fully independent of
  // Portly's lifetime while its stderr remains readable after a failure.
  let fd: number | null = null
  const logPath = logDir ? join(logDir, `start-${port}.log`) : null
  try {
    if (logPath) fd = openSync(logPath, 'w')
  } catch {
    fd = null
  }

  let child
  try {
    child = spawn(shell, ['-l', '-c', entry.command], {
      cwd: entry.cwd,
      detached: true,
      stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'],
    })
  } catch (err) {
    if (fd !== null) closeSync(fd)
    const error = `Could not launch ${shell}: ${(err as Error).message}`
    startStates.set(key, { starting: false, error })
    return { ok: false, error }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        // parent's copy only
      }
    }
  }

  let exited = false
  let exitCode: number | null = null
  child.on('exit', (code) => {
    exited = true
    exitCode = code
  })
  child.on('error', () => {
    exited = true
    exitCode = -1
  })

  const startedAt = Date.now()
  const groupId = child.pid

  const abandon = () => {
    if (groupId === undefined || exited) return
    try {
      // Detached children lead their own group; take the whole tree down.
      process.kill(-groupId, 'SIGTERM')
    } catch {
      try {
        process.kill(groupId, 'SIGTERM')
      } catch {
        // already gone
      }
    }
  }

  const fail = (message: string) => {
    abandon()
    const detail = lastLine(readLogTail(port))
    const error = detail ? `${message} — ${detail}` : message
    startStates.set(key, { starting: false, error })
    return { ok: false, error }
  }

  while (Date.now() - startedAt < LISTEN_TIMEOUT_MS) {
    await wait(POLL_INTERVAL_MS)

    if (await isPortListening(port)) {
      child.unref()
      startStates.delete(key)
      return { ok: true }
    }

    // A command that dies fast has failed; do not wait out the full window.
    if (exited && Date.now() - startedAt <= FAIL_FAST_MS) {
      if ((exitCode ?? 0) !== 0) {
        return fail(`Command exited with code ${exitCode ?? 'unknown'}`)
      }
    }
  }

  return fail(`No listener appeared on port ${port} within 10s`)
}

/** Test seam. */
export function __seedCapture(entry: CapturedCommand) {
  captures.set(keyFor(entry.port, entry.project), entry)
}
