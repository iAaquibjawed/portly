import { useState } from 'react'
import type { PortRow, Protocol } from '../shared/types'
import { formatSince, formatUptime } from './format'
import { IconMore, IconOpen, IconStart, IconStop } from './icons'

/** Protocol reads through shape, in body-text ink. Survives grayscale. */
function Glyph({ protocol }: { protocol: Protocol }) {
  switch (protocol) {
    case 'http':
      return (
        <span className="glyph" aria-hidden="true">
          <span className="glyph-dot" />
        </span>
      )
    case 'https':
      return (
        <span className="glyph" aria-hidden="true">
          <span className="glyph-dot" />
          <span className="glyph-ring" />
        </span>
      )
    case 'nonhttp':
      return (
        <span className="glyph" aria-hidden="true">
          <span className="glyph-square" />
        </span>
      )
    case 'unknown':
      return (
        <span className="glyph" aria-hidden="true">
          <span className="glyph-dashed" />
        </span>
      )
  }
}

const PROTOCOL_LABEL: Record<Protocol, string> = {
  http: 'HTTP',
  https: 'HTTPS',
  nonhttp: 'non-HTTP',
  unknown: 'unresolved owner',
}

/**
 * A fallback project name is often just the process name. Showing
 * `CCLibrary · CCLibrary` is noise, so the process is dropped when the project
 * already contains it.
 */
function processIsRedundant(project: string, process: string): boolean {
  if (!process) return true
  const p = project.toLowerCase()
  const c = process.toLowerCase()
  return p === c || p.includes(c)
}

export interface RowProps {
  row: PortRow
  /** True when rendered inside a project group, which already names the project. */
  grouped: boolean
  focused: boolean
  killConfirm: boolean
  restarted: boolean
  onFocus(): void
  onOpen(): void
  onMenu(): void
  onKill(): void
  onCancelKill(): void
  onConfirmKill(): void
  onStart(): void
}

export function Row({
  row,
  grouped,
  focused,
  killConfirm,
  restarted,
  onFocus,
  onOpen,
  onMenu,
  onKill,
  onCancelKill,
  onConfirmKill,
  onStart,
}: RowProps) {
  const [hovered, setHovered] = useState(false)

  const isPermission = row.variant === 'permission'
  const isStopped = row.state === 'stopped'
  // A stopped server has no URL to open, so that slot is empty.
  const hasUrl = !isStopped && (row.protocol === 'http' || row.protocol === 'https')

  const showProcess = !processIsRedundant(row.project, row.process)
  const secondary = [
    // portless replaces ports with names; show the name, keep the port as the
    // anchor, because the port is what an EADDRINUSE actually reports.
    row.namedUrl ? row.namedUrl.replace(/^https?:\/\//, '') : null,
    showProcess ? row.process : null,
    // PID is the least useful token at rest: hover and tooltip only.
    hovered && !isPermission && !isStopped ? String(row.pid) : null,
    row.title,
  ].filter(Boolean) as string[]

  const memory = row.memoryKb ? `${Math.round(row.memoryKb / 1024)} MB` : null

  const tooltip = [
    row.project,
    row.namedUrl ? `${row.namedUrl}  ->  port ${row.port}` : `port ${row.port}`,
    isStopped ? 'stopped by Portly' : `${row.process} · pid ${row.pid}`,
    row.title,
    row.command,
    row.cwd,
    // Stopping is irreversible for the user's work, so say what it costs and how.
    isStopped ? null : `${row.risk.label} — ${row.risk.detail}`,
    isStopped ? null : 'Stop sends SIGTERM first; SIGKILL only if it ignores that.',
    memory ? `memory: ${memory}` : null,
    row.startCommand ? `start: ${row.startCommand}  (${row.startCommandSource})` : null,
    row.startError ? `start failed — ${row.startError}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  /** Right-hand column: never swaps out for actions. */
  const trailing = isStopped
    ? row.starting
      ? 'starting…'
      : row.startError
        ? 'start failed'
        : `stopped ${formatSince(row.stoppedAt ?? Date.now())}`
    : isPermission
      ? 'no access'
      : formatUptime(row.uptimeSeconds)

  return (
    <div
      className="row"
      role="option"
      aria-selected={focused}
      aria-label={`${row.project}, port ${row.port}, ${
        isStopped ? 'stopped' : PROTOCOL_LABEL[row.protocol]
      }`}
      title={tooltip}
      data-focused={focused}
      data-hovered={hovered}
      data-state={row.state}
      data-failed={Boolean(row.startError)}
      data-restarted={restarted}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Hover and keyboard focus stay separate signals.
      onClick={onFocus}
    >
      <div className="row-top">
        <Glyph protocol={row.protocol} />

        {grouped ? (
          /* The group heading already carries the project, so the port is the
             row's identity and its left-hand anchor. */
          <div className="row-anchor">{row.port}</div>
        ) : (
          <>
            <div className="row-project">{row.project}</div>
            <div className="row-port">{row.port}</div>
          </>
        )}

        {/* Fixed-width rail, always reserved: nothing reflows on hover. */}
        <div className="rail">
          <div className="rail-slot">
            {hasUrl && (
              <button
                type="button"
                className="action"
                data-role="open"
                title="Open in browser"
                aria-label="Open in browser"
                onClick={onOpen}
              >
                <IconOpen />
              </button>
            )}
          </div>
          <div className="rail-slot">
            <button
              type="button"
              className="action"
              data-role="more"
              title="More actions"
              aria-label="More actions"
              onClick={onMenu}
            >
              <IconMore />
            </button>
          </div>
          <div className="rail-slot">
            {isStopped ? (
              /* Start is not destructive, so unlike Stop it shows at rest. It
                 exists only where argv was captured; where it was not, the slot
                 stays empty and reserved rather than offering a dead button. */
              row.startable &&
              !row.starting && (
                <button
                  type="button"
                  className="action"
                  data-role="start"
                  title="Start server"
                  aria-label="Start server"
                  onClick={onStart}
                >
                  <IconStart />
                </button>
              )
            ) : (
              !isPermission && (
                <button
                  type="button"
                  className="action"
                  data-role="stop"
                  title="Stop server"
                  aria-label="Stop server"
                  onClick={onKill}
                >
                  <IconStop />
                </button>
              )
            )}
          </div>
        </div>
      </div>

      <div className="row-meta">
        {killConfirm ? (
          /* Reads with project and port — what the user needs to confirm they
             are killing the right thing. Destructive action first. */
          <div className="inline-row">
            {/* The project name absorbs any truncation; the port never does,
                because the port is what the user is verifying. */}
            <span className="confirm-label">Stop {row.project}</span>
            <span className="confirm-port">on {row.port}?</span>
            {/* Says what this costs. A database and a Vite server must not look
                identical at the moment of confirming. */}
            <span className="risk-chip" data-level={row.risk.level} title={row.risk.detail}>
              {row.risk.label}
            </span>
            <button type="button" className="link" data-tone="danger" onClick={onConfirmKill}>
              {row.risk.level === 'danger' ? 'Stop anyway' : 'Stop'}
            </button>
            <button type="button" className="link" onClick={onCancelKill}>
              Cancel
            </button>
          </div>
        ) : (
          <>
            <div className="row-submeta">
              {isPermission ? 'permission needed' : secondary.join(' · ')}
            </div>
            {/* Keeps its own position; never swaps out for actions. */}
            <div className="row-uptime">{trailing}</div>
          </>
        )}
      </div>
    </div>
  )
}
