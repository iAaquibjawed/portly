/** `2h 14m`, `6h 02m`, `41m`, `12s`, `3d 4h` — minutes pad to two digits so the
 *  uptime column stays a column. */
export function formatUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.floor(seconds)}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** `just now`, `4m ago`, `2h ago`, `3d ago` */
export function formatAgo(epochMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000))
  if (seconds < 45) return 'just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

export function localUrl(protocol: string, port: number): string {
  return `${protocol === 'https' ? 'https' : 'http'}://localhost:${port}`
}

/** `12s ago`, `3m ago`, `2h ago` — second granularity, unlike formatAgo. */
export function formatSince(epochMs: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - epochMs) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.floor(minutes / 60)}h ago`
}
