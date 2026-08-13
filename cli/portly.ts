/**
 * `portly` — the terminal half of the same answer.
 *
 * People hit `EADDRINUSE` and search the error, not the app. Every guide ends the
 * same way: run lsof, read a PID, kill it. This does that in one step and tells
 * you what you would be killing before you do.
 *
 *   portly              every listener, grouped by project
 *   portly 3000         what owns port 3000
 *   portly 3000 --json  the same, machine-readable
 *   portly 3000 --stop  stop it, after saying what it is
 *
 * Shares the scanner with the app, so the two can never disagree.
 */
import { scan, kill } from '../electron/ports'
import type { PortRow } from '../shared/types'

const RESET = '[0m'
const DIM = '[2m'
const BOLD = '[1m'
const RED = '[31m'
const YELLOW = '[33m'
const GREEN = '[32m'

/** Colour only when stdout is a terminal, so pipes stay clean. */
const tty = process.stdout.isTTY
const paint = (code: string, text: string) => (tty ? `${code}${text}${RESET}` : text)

const RISK_COLOUR = { safe: GREEN, caution: YELLOW, danger: RED } as const

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

const memory = (kb: number | null) => (kb ? `${Math.round(kb / 1024)} MB` : '—')

function describe(row: PortRow): string {
  const risk = paint(RISK_COLOUR[row.risk.level], row.risk.label)
  const url = row.namedUrl ?? `http://localhost:${row.port}`
  return [
    `${paint(BOLD, String(row.port))}  ${row.project}`,
    `  ${paint(DIM, 'process')}  ${row.process} · pid ${row.pid}`,
    `  ${paint(DIM, 'uptime ')}  ${formatUptime(row.uptimeSeconds)} · ${memory(row.memoryKb)}`,
    row.protocol === 'http' || row.protocol === 'https'
      ? `  ${paint(DIM, 'url    ')}  ${url}`
      : `  ${paint(DIM, 'proto  ')}  ${row.protocol}`,
    row.title ? `  ${paint(DIM, 'title  ')}  ${row.title}` : null,
    row.cwd ? `  ${paint(DIM, 'cwd    ')}  ${row.cwd}` : null,
    `  ${paint(DIM, 'stopping')} ${risk} — ${row.risk.detail}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function usage(): never {
  process.stdout.write(
    [
      'portly — which of your local projects is running on which port',
      '',
      'Usage:',
      '  portly                 list every listener, grouped by project',
      '  portly <port>          show what owns a port',
      '  portly <port> --stop   stop it (SIGTERM, then SIGKILL if it ignores that)',
      '  portly [<port>] --json machine-readable output',
      '  portly --all           include non-HTTP listeners',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('-h') || args.includes('--help')) usage()

  const json = args.includes('--json')
  const stop = args.includes('--stop')
  const all = args.includes('--all') || Boolean(args.find((a) => /^\d+$/.test(a)))
  const portArg = args.find((a) => /^\d+$/.test(a))
  const port = portArg ? Number.parseInt(portArg, 10) : null

  // A specific port is always shown, HTTP or not — you asked about that port.
  const result = await scan(all)
  const rows = port === null ? result.rows : result.rows.filter((r) => r.port === port)

  if (json) {
    process.stdout.write(`${JSON.stringify(port === null ? result : rows, null, 2)}\n`)
    return
  }

  if (!rows.length) {
    process.stdout.write(
      port === null ? 'Nothing listening.\n' : `Nothing listening on ${port}.\n`,
    )
    process.exit(port === null ? 0 : 1)
  }

  if (port !== null) {
    for (const row of rows) process.stdout.write(`${describe(row)}\n`)

    if (stop) {
      for (const row of rows) {
        if (row.risk.level === 'danger') {
          process.stdout.write(
            `\n${paint(RED, 'Refusing')} to stop a ${row.risk.label} without --force.\n` +
              `${row.risk.detail}\n`,
          )
          process.exit(2)
        }
        process.stdout.write(`\nStopping ${row.process} (pid ${row.pid})…\n`)
        const outcome = await kill(row.pid, row.port)
        process.stdout.write(
          outcome.ok
            ? `${paint(GREEN, 'Stopped')} with ${outcome.signal ?? 'no signal needed'}.\n`
            : `${paint(RED, 'Failed')}: ${outcome.error ?? 'unknown error'}\n`,
        )
        if (!outcome.ok) process.exit(1)
      }
    }
    return
  }

  // Grouped listing, keyed on the project path exactly as the app groups it.
  const groups = new Map<string, PortRow[]>()
  for (const row of rows) {
    const bucket = groups.get(row.groupKey)
    if (bucket) bucket.push(row)
    else groups.set(row.groupKey, [row])
  }

  for (const [, groupRows] of groups) {
    const sorted = [...groupRows].sort((a, b) => a.port - b.port)
    process.stdout.write(`${paint(BOLD, sorted[0].project)}\n`)
    for (const row of sorted) {
      const risk = paint(RISK_COLOUR[row.risk.level], row.risk.label.padEnd(18))
      const name = row.namedUrl ? row.namedUrl.replace(/^https?:\/\//, '') : row.process
      process.stdout.write(
        `  ${String(row.port).padStart(6)}  ${risk}  ${paint(DIM, formatUptime(row.uptimeSeconds).padEnd(9))}  ${name}\n`,
      )
    }
  }

  const hidden = result.hiddenCount
  process.stdout.write(
    `\n${rows.length} of ${result.totalCount} listeners` +
      (hidden ? `  ${paint(DIM, `(${hidden} non-HTTP hidden — use --all)`)}` : '') +
      '\n',
  )
}

main().catch((err: unknown) => {
  process.stderr.write(`portly: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
