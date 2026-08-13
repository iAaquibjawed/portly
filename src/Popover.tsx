import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PortlyApi, PortRow, ScanResult, Settings, Theme } from '../shared/types'
import { Row } from './Row'
import { useKeyboard } from './useKeyboard'
import { localUrl } from './format'
import { mockApi } from './mockApi'
import { IconSearch } from './icons'

const defaultApi: PortlyApi = window.portly ?? mockApi

const RESTART_FLASH_MS = 2000
const ERROR_TIMEOUT_MS = 4000

interface ProjectGroup {
  key: string
  project: string
  rows: PortRow[]
  /** Uptime of the most recently started port in the group. */
  freshest: number
}

/**
 * A monorepo running 3000/3001/5173 is one project with three ports, not three
 * scattered rows. Single-port projects get no group chrome — grouping must not
 * add weight where there is nothing to group.
 *
 * Keyed on `row.groupKey`, which is the project's absolute path. Keying on the
 * display name would merge two unrelated directories that happen to resolve to
 * the same label.
 */
function groupByProject(rows: PortRow[]): ProjectGroup[] {
  const byKey = new Map<string, PortRow[]>()
  for (const row of rows) {
    const bucket = byKey.get(row.groupKey)
    if (bucket) bucket.push(row)
    else byKey.set(row.groupKey, [row])
  }

  return [...byKey.entries()]
    .map(([key, groupRows]) => ({
      key,
      project: groupRows[0].project,
      rows: [...groupRows].sort((a, b) => a.port - b.port),
      freshest: Math.min(...groupRows.map((r) => r.uptimeSeconds)),
    }))
    .sort((a, b) => a.freshest - b.freshest || a.project.localeCompare(b.project))
}

export function Popover({ api = defaultApi }: { api?: PortlyApi } = {}) {
  const [rows, setRows] = useState<PortRow[]>([])
  const [totals, setTotals] = useState({ total: 0, hidden: 0 })
  const [hasUnresolved, setHasUnresolved] = useState(false)
  const [showNonHttp, setShowNonHttp] = useState(false)
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [query, setQuery] = useState('')
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [killConfirmId, setKillConfirmId] = useState<string | null>(null)
  const [restartedIds, setRestartedIds] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [scroll, setScroll] = useState({ up: false, down: false })

  const cardRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  /** port -> pid from the previous scan, for restart detection. */
  const portToPid = useRef(new Map<number, number>())

  const applyResult = useCallback((result: ScanResult) => {
    const restarts: string[] = []
    for (const row of result.rows) {
      const previousPid = portToPid.current.get(row.port)
      // Same port, new pid: the process restarted. Hold its place and flash.
      if (previousPid !== undefined && previousPid !== row.pid) restarts.push(row.id)
    }
    portToPid.current = new Map(result.rows.map((r) => [r.port, r.pid]))

    setRows(result.rows)
    setTotals({ total: result.totalCount, hidden: result.hiddenCount })
    setHasUnresolved(result.hasUnresolved)
    setLoading(false)

    if (restarts.length) {
      setRestartedIds((prev) => new Set([...prev, ...restarts]))
      window.setTimeout(() => {
        setRestartedIds((prev) => {
          const next = new Set(prev)
          for (const id of restarts) next.delete(id)
          return next
        })
      }, RESTART_FLASH_MS)
    }
  }, [])

  const refresh = useCallback(async () => {
    setScanning(true)
    try {
      applyResult(await api.scan())
    } finally {
      setScanning(false)
    }
  }, [api, applyResult])

  // Boot: theme and settings, then first scan.
  useEffect(() => {
    let cancelled = false

    const applyTheme = (theme: Theme) => {
      document.documentElement.dataset.theme = theme
    }
    const applySettings = (settings: Settings) => {
      if (!cancelled) setShowNonHttp(settings.showNonHttp)
    }

    void api.getTheme().then((theme) => {
      if (!cancelled) applyTheme(theme)
    })
    void api.getSettings().then(applySettings)
    void refresh()

    const offTheme = api.onThemeChange(applyTheme)
    const offScan = api.onScan(applyResult)
    const offSettings = api.onSettingsChange(applySettings)
    const offShow = api.onShow(() => {
      // A fresh glance starts clean: no stale confirm, no stale filter.
      setKillConfirmId(null)
      setError(null)
      setQuery('')
      searchRef.current?.blur()
    })

    return () => {
      cancelled = true
      offTheme()
      offScan()
      offSettings()
      offShow()
    }
  }, [api, applyResult, refresh])

  // Report content height so the window hugs the list.
  useEffect(() => {
    const card = cardRef.current
    if (!card) return
    const report = () => void api.setHeight(card.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(card)
    return () => observer.disconnect()
  }, [api])

  useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => setError(null), ERROR_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [error])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter(
      (r) =>
        r.project.toLowerCase().includes(needle) ||
        String(r.port).includes(needle) ||
        r.process.toLowerCase().includes(needle) ||
        (r.title?.toLowerCase().includes(needle) ?? false),
    )
  }, [rows, query])

  const groups = useMemo(() => groupByProject(filtered), [filtered])
  /** Display order, for keyboard navigation across group boundaries. */
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups])

  // P8: a scrollable list must say so.
  const updateScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    const max = el.scrollHeight - el.clientHeight
    setScroll({ up: el.scrollTop > 2, down: max > 2 && el.scrollTop < max - 2 })
  }, [])

  useEffect(() => {
    updateScroll()
    const el = listRef.current
    if (!el) return
    const observer = new ResizeObserver(updateScroll)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateScroll, groups])

  // Keep the highlight on a row that still exists.
  useEffect(() => {
    if (focusedId && !ordered.some((r) => r.id === focusedId)) setFocusedId(null)
  }, [ordered, focusedId])

  useEffect(() => {
    if (!focusedId) return
    listRef.current
      ?.querySelector('[data-focused="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusedId])

  const closeTransients = () => {
    setKillConfirmId(null)
  }

  const openRow = useCallback(
    (row: PortRow) => {
      if (row.protocol !== 'http' && row.protocol !== 'https') return
      void api.open(localUrl(row.protocol, row.port))
    },
    [api],
  )

  const confirmKill = useCallback(
    async (row: PortRow) => {
      setKillConfirmId(null)
      const result = await api.kill(row.pid, row.port)
      if (!result.ok) {
        setError(result.error ?? `Could not stop ${row.process} (${row.pid})`)
        return
      }
      // No collapse and no move: the next scan returns this row in place, in
      // its group, marked stopped.
      void refresh()
    },
    [api, refresh],
  )

  const startRow = useCallback(
    async (row: PortRow) => {
      const result = await api.start(row.port, row.groupKey)
      // The row itself carries the stderr on hover and in the ⋯ menu; the banner
      // is only for a refusal with no row to attach to.
      if (!result.ok && !result.error) setError(`Could not start port ${row.port}`)
    },
    [api],
  )

  const toggleNonHttp = useCallback(() => {
    const next = !showNonHttp
    setShowNonHttp(next)
    void api.setShowNonHttp(next)
  }, [api, showNonHttp])

  useKeyboard({
    focusSearch: () => {
      searchRef.current?.focus()
      searchRef.current?.select()
    },
    move: (delta) => {
      if (!ordered.length) return
      const index = ordered.findIndex((r) => r.id === focusedId)
      const next =
        index === -1
          ? delta === 1
            ? 0
            : ordered.length - 1
          : (index + delta + ordered.length) % ordered.length
      setFocusedId(ordered[next].id)
      closeTransients()
    },
    openFocused: () => {
      const row = ordered.find((r) => r.id === focusedId)
      if (row) openRow(row)
    },
    killFocused: () => {
      const row = ordered.find((r) => r.id === focusedId)
      if (!row || row.variant === 'permission' || row.state === 'stopped') return
      if (killConfirmId === row.id) void confirmKill(row)
      else setKillConfirmId(row.id)
    },
    escape: () => {
      if (killConfirmId) return setKillConfirmId(null)
      if (query) return setQuery('')
      if (document.activeElement === searchRef.current) searchRef.current?.blur()
      void api.hide()
    },
    isSearchFocused: () => document.activeElement === searchRef.current,
  })

  const showSkeletons = loading && rows.length === 0
  const isEmpty = !loading && ordered.length === 0

  return (
    <div className="popover" ref={cardRef}>
      <div className="header">
        <span className="search-icon">
          <IconSearch />
        </span>
        <input
          ref={searchRef}
          className="search"
          type="text"
          placeholder="Search project, port, process…"
          value={query}
          spellCheck={false}
          autoComplete="off"
          aria-label="Search ports"
          onChange={(e) => {
            setQuery(e.target.value)
            closeTransients()
          }}
        />
        <span className="chip" aria-hidden="true">
          ⌘K
        </span>
        <button
          type="button"
          className="refresh"
          data-spinning={scanning}
          title="Rescan"
          aria-label="Rescan ports"
          onClick={() => void refresh()}
        >
          <span>↻</span>
        </button>
      </div>

      <div className="list-wrap" data-scroll-up={scroll.up} data-scroll-down={scroll.down}>
        <div
          className="list"
          ref={listRef}
          role="listbox"
          aria-label="Listening ports"
          onScroll={updateScroll}
        >
          {error && (
            <div className="banner" data-tone="danger" role="alert">
              {error}
            </div>
          )}

          {showSkeletons ? (
            <div className="skeletons">
              {[0, 1, 2].map((i) => (
                <div className="skeleton" key={i}>
                  <div className="skeleton-glyph" style={{ animationDelay: `${i * 0.15}s` }} />
                  <div className="skeleton-lines">
                    <div
                      className="skeleton-line"
                      data-role="title"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                    <div
                      className="skeleton-line"
                      data-role="meta"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="empty">
              <div className="empty-glyph" aria-hidden="true" />
              <div className="empty-title">
                {query ? 'No matches' : totals.hidden > 0 ? 'No servers' : 'Nothing listening'}
              </div>
              <div className="empty-body">
                {query ? (
                  'No project, port or process matches that.'
                ) : totals.hidden > 0 ? (
                  <>
                    {totals.hidden} non-HTTP{' '}
                    {totals.hidden === 1 ? 'listener is' : 'listeners are'} hidden.
                  </>
                ) : (
                  'Start a dev server and it will show up here.'
                )}
              </div>
            </div>
          ) : (
            <>
              {hasUnresolved && (
                <div className="banner">
                  Some processes need permission to identify their owner.
                </div>
              )}

              {groups.map((group) => {
                const isGroup = group.rows.length > 1
                return (
                  <div className="group" key={group.key} data-chrome={isGroup}>
                    {isGroup && (
                      <div className="group-header">
                        {/* Truncates with an ellipsis in CSS; the full name is
                            always available on hover. */}
                        <span className="group-name" title={group.key.startsWith('proc:') ? group.project : group.key}>
                          {group.project}
                        </span>
                      </div>
                    )}
                    {group.rows.map((row) => (
                      <Row
                        key={row.id}
                        row={row}
                        grouped={isGroup}
                        focused={focusedId === row.id}
                        killConfirm={killConfirmId === row.id}
                        restarted={restartedIds.has(row.id)}
                        onFocus={() => setFocusedId(row.id)}
                        onOpen={() => openRow(row)}
                        onMenu={() =>
                          void api.showRowMenu({
                            port: row.port,
                            pid: row.pid,
                            protocol: row.protocol,
                            cwd: row.cwd,
                            command: row.command,
                            startError: row.startError,
                            startCommand: row.startCommand,
                          })
                        }
                        onKill={() => setKillConfirmId(row.id)}
                        onCancelKill={() => setKillConfirmId(null)}
                        onConfirmKill={() => void confirmKill(row)}
                        onStart={() => void startRow(row)}
                      />
                    ))}
                  </div>
                )
              })}

            </>
          )}
        </div>
      </div>

      <div className="footer">
        {/* P2: the filter documents itself, and one click reveals the rest. */}
        <button
          type="button"
          className="footer-count"
          onClick={toggleNonHttp}
          title={
            showNonHttp
              ? 'Hide non-HTTP listeners'
              : `Show ${totals.hidden} hidden non-HTTP listener${totals.hidden === 1 ? '' : 's'}`
          }
        >
          {loading && rows.length === 0 ? (
            'Scanning…'
          ) : totals.hidden > 0 ? (
            <>
              <strong>{rows.length}</strong> of {totals.total} active
            </>
          ) : (
            <>
              <strong>{totals.total}</strong> active
            </>
          )}
        </button>
        <div className="footer-actions">
          <button type="button" className="link" onClick={() => void api.openSettingsMenu()}>
            Settings
          </button>
          <button type="button" className="link" onClick={() => void api.quit()}>
            Quit
          </button>
        </div>
      </div>
    </div>
  )
}
