import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Infers a start command from what a project *declares*, for servers whose argv
 * cannot be recovered.
 *
 * Rails, puma, unicorn and postgres rewrite their process title, so `ps` reports
 * a status line instead of an executable command line and the original arguments
 * are gone from memory. There is no way to read them back. But the command is
 * not actually unknown — the project states it, in a binstub or a manifest. This
 * is how every tool that offers "start" knows what to run: it reads the
 * project's own configuration, or it owned the launch in the first place.
 *
 * Inference only ever fires as a fallback, and only when a marker file proves
 * what kind of project this is. A directory with no marker yields nothing.
 */

export interface InferredCommand {
  command: string
  /** Provenance, shown to the user so an inferred command is never a mystery. */
  source: string
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The `web:` process from a Procfile, with $PORT bound to the real port. */
function fromProcfile(dir: string, port: number): InferredCommand | null {
  for (const name of ['Procfile.dev', 'Procfile']) {
    const path = join(dir, name)
    if (!existsSync(path)) continue
    try {
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .find((l) => /^web:/.test(l))
      if (!line) continue
      const command = line.replace(/^web:\s*/, '').replace(/\$\{?PORT\}?/g, String(port))
      if (command) return { command, source: name }
    } catch {
      // unreadable Procfile is simply not a source
    }
  }
  return null
}

type Check = (dir: string, port: number) => InferredCommand | null

/**
 * Ordered most-port-precise first. A command that binds the port explicitly
 * restores the row the user actually stopped; a generic dev script might not.
 */
const CHECKS: Check[] = [
  // Rails. `bin/dev` in these projects is `exec "./bin/rails", "server", *ARGV`,
  // so the binstub is both the more direct and the more precise target.
  (dir, port) =>
    existsSync(join(dir, 'bin', 'rails')) && existsSync(join(dir, 'config.ru'))
      ? { command: `bin/rails server -p ${port}`, source: 'Rails binstub + config.ru' }
      : null,

  // Django.
  (dir, port) =>
    existsSync(join(dir, 'manage.py'))
      ? { command: `python manage.py runserver ${port}`, source: 'manage.py' }
      : null,

  // Phoenix.
  (dir, port) =>
    existsSync(join(dir, 'mix.exs'))
      ? { command: `PORT=${port} mix phx.server`, source: 'mix.exs' }
      : null,

  fromProcfile,

  // Node last: when argv capture fails for a Node server it is usually because
  // there was no ancestor, and the manifest is the next best statement of intent.
  (dir) => {
    const pkg = readJson(join(dir, 'package.json'))
    const scripts = pkg?.scripts
    if (!scripts || typeof scripts !== 'object') return null
    const table = scripts as Record<string, string>
    if (table.dev) return { command: 'npm run dev', source: 'package.json scripts.dev' }
    if (table.start) return { command: 'npm start', source: 'package.json scripts.start' }
    return null
  },
]

/**
 * Searches the listener's own directory first, then the repo root — in a
 * monorepo the app lives in a subdirectory and its manifest is the specific one.
 */
export function inferStartCommand(
  cwd: string | null,
  projectPath: string | null,
  port: number,
): (InferredCommand & { cwd: string }) | null {
  const dirs = [...new Set([cwd, projectPath].filter((d): d is string => Boolean(d)))]

  for (const dir of dirs) {
    if (dir === '/' || !existsSync(dir)) continue
    for (const check of CHECKS) {
      const hit = check(dir, port)
      if (hit) return { ...hit, cwd: dir }
    }
  }
  return null
}
