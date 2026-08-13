import { sh } from './exec'

/**
 * Project naming. The cwd folder alone is not a project identity: three Rails
 * apps all running out of `backend/` are indistinguishable, which defeats the
 * point of the list. So we resolve to the git repository root, then only add
 * path context when the name would otherwise be generic or ambiguous.
 */

/** Folder names that describe a role inside a project, not the project. */
const GENERIC_NAMES = new Set([
  'backend',
  'frontend',
  'api',
  'web',
  'server',
  'app',
  'client',
  'src',
  'apps',
  'packages',
  'dist',
  // Beyond the specified set, but equally uninformative in practice:
  // ~/Library/.../kotlin/daemon reads better as "kotlin/daemon".
  'daemon',
  'bin',
  'current',
])

function isGenericName(name: string): boolean {
  const lower = name.toLowerCase()
  if (GENERIC_NAMES.has(lower)) return true
  // Version-numbered working directories (~/.gradle/daemon/9.4.1) name nothing.
  return /^v?\d+(\.\d+)*$/.test(lower)
}

/**
 * Package-manager and OS trees that happen to be git checkouts. Homebrew's
 * prefix is a real repo, so `postgres` running out of
 * /opt/homebrew/var/postgresql@18 would otherwise resolve to "homebrew".
 */
const SYSTEM_ROOTS = [
  '/opt',
  '/usr',
  '/nix',
  '/var',
  '/Library',
  '/System',
  '/Applications',
  '/private',
]

const MAX_SEGMENTS = 4

export function isSystemPath(path: string): boolean {
  return SYSTEM_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
}

const gitRootCache = new Map<string, string | null>()

export async function gitRoot(cwd: string): Promise<string | null> {
  const cached = gitRootCache.get(cwd)
  if (cached !== undefined) return cached

  const { stdout, failed } = await sh(
    'git',
    ['-C', cwd, 'rev-parse', '--show-toplevel'],
    3000,
  )
  const root = failed ? null : stdout.trim() || null
  gitRootCache.set(cwd, root)
  return root
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean)
}

/** Rightmost `count` path segments, joined — `coplyx/backend`. */
function nameFromPath(path: string, count: number): string {
  const parts = segments(path)
  return parts.slice(Math.max(0, parts.length - count)).join('/')
}

export interface ProjectInput {
  /** Row id, echoed back on the result. */
  id: string
  cwd: string | null
  /** Used when there is no usable directory at all (daemons with cwd `/`). */
  fallback: string
}

export interface ProjectResult {
  name: string
  /** Canonical directory this project resolved to; null when we fell back. */
  path: string | null
}

/**
 * Resolves display names for a whole visible list at once, because uniqueness
 * is a property of the list, not of a single row.
 */
export async function resolveProjects(
  inputs: ProjectInput[],
): Promise<Map<string, ProjectResult>> {
  // 1. Pick the directory that best represents each row: the git root when it
  //    is a real project checkout, else the cwd itself.
  const basePathById = new Map<string, string | null>()
  const uniqueCwds = [...new Set(inputs.map((i) => i.cwd).filter((c): c is string => Boolean(c)))]
  const rootByCwd = new Map<string, string | null>()

  await Promise.all(
    uniqueCwds.map(async (cwd) => {
      const root = await gitRoot(cwd)
      rootByCwd.set(cwd, root && !isSystemPath(root) ? root : null)
    }),
  )

  for (const input of inputs) {
    if (!input.cwd || segments(input.cwd).length === 0) {
      basePathById.set(input.id, null)
      continue
    }
    basePathById.set(input.id, rootByCwd.get(input.cwd) ?? input.cwd)
  }

  // 2. Start every distinct path at one segment, or two when that segment is a
  //    generic role name.
  const paths = [...new Set([...basePathById.values()].filter((p): p is string => Boolean(p)))]
  const segmentCount = new Map<string, number>()
  for (const path of paths) {
    segmentCount.set(path, isGenericName(nameFromPath(path, 1)) ? 2 : 1)
  }

  // 3. Extend colliding paths leftward until their names differ. Two rows from
  //    the *same* path are the same project and must keep the same name.
  for (let pass = 0; pass < MAX_SEGMENTS; pass++) {
    const byName = new Map<string, string[]>()
    for (const path of paths) {
      const name = nameFromPath(path, segmentCount.get(path) ?? 1)
      const bucket = byName.get(name)
      if (bucket) bucket.push(path)
      else byName.set(name, [path])
    }

    const colliding = [...byName.values()].filter((bucket) => bucket.length > 1).flat()
    if (!colliding.length) break

    let extended = false
    for (const path of colliding) {
      const current = segmentCount.get(path) ?? 1
      if (current < Math.min(segments(path).length, MAX_SEGMENTS)) {
        segmentCount.set(path, current + 1)
        extended = true
      }
    }
    // Distinct paths that share every available segment cannot be separated.
    if (!extended) break
  }

  const result = new Map<string, ProjectResult>()
  for (const input of inputs) {
    const path = basePathById.get(input.id) ?? null
    if (!path) {
      result.set(input.id, { name: input.fallback, path: null })
      continue
    }
    const name = nameFromPath(path, segmentCount.get(path) ?? 1)
    result.set(input.id, { name: name || input.fallback, path })
  }
  return result
}

/** Test seam: project resolution is pure apart from the git lookup. */
export function __setGitRootForTests(cwd: string, root: string | null) {
  gitRootCache.set(cwd, root)
}
