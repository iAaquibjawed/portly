import { execFile } from 'node:child_process'

export interface ShResult {
  stdout: string
  failed: boolean
}

export function sh(cmd: string, args: string[], timeout = 5000): Promise<ShResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout }, (err, stdout) => {
      // lsof and git exit non-zero for partial/absent results while still
      // printing what they could resolve, so stdout wins over the exit code.
      resolve({ stdout: stdout || '', failed: Boolean(err) && !stdout })
    })
  })
}

export interface LsofSet {
  pid: number
  command: string
  user: string
  names: string[]
}

/** Splits `lsof -F` output into process sets keyed by pid. */
export function parseLsofFields(stdout: string): LsofSet[] {
  const sets: LsofSet[] = []
  let current: LsofSet | null = null

  for (const line of stdout.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      const pid = Number.parseInt(value, 10)
      if (!Number.isFinite(pid)) {
        current = null
        continue
      }
      current = { pid, command: '', user: '', names: [] }
      sets.push(current)
    } else if (!current) {
      continue
    } else if (tag === 'c') {
      current.command = value
    } else if (tag === 'L') {
      current.user = value
    } else if (tag === 'n') {
      current.names.push(value)
    }
  }
  return sets
}

/** Working directory per pid, for any pid we are allowed to inspect. */
export async function readCwds(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!pids.length) return out
  const { stdout } = await sh('lsof', ['-a', '-d', 'cwd', '-p', pids.join(','), '-Fn'])
  for (const set of parseLsofFields(stdout)) {
    const cwd = set.names.find((n) => n.startsWith('/'))
    if (cwd) out.set(set.pid, cwd)
  }
  return out
}

export async function isPortListening(port: number): Promise<boolean> {
  const { stdout } = await sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], 3000)
  return /^p\d+/m.test(stdout)
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
