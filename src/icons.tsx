/**
 * One matched set, drawn on a single 16×16 grid with 1.5px strokes and rounded
 * caps and joins. Every icon's ink is centred on (8, 8) so the arrow, the dots
 * and the cross share an optical baseline instead of floating independently.
 */

const GRID = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

/** Arrow leaving a box. Ink spans 2.5–13.5 on both axes. */
export function IconOpen() {
  return (
    <svg {...GRID} className="icon">
      <path d="M6.75 3.5H4.25A1.75 1.75 0 0 0 2.5 5.25v6.5A1.75 1.75 0 0 0 4.25 13.5h6.5A1.75 1.75 0 0 0 12.5 11.75V9.25" />
      <path d="M9.75 2.5h3.75v3.75" />
      <path d="M13.5 2.5 8 8" />
    </svg>
  )
}

/** Three dots on y=8 — the same optical centre line as the arrow. */
export function IconMore() {
  return (
    <svg {...GRID} className="icon">
      <circle cx="3.9" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.1" cy="8" r="1.05" fill="currentColor" stroke="none" />
    </svg>
  )
}

/**
 * Filled square — the media-stop convention. A cross was wrong here: in a list
 * row an ✕ means "dismiss this row", not "terminate this process".
 */
export function IconStop() {
  return (
    <svg {...GRID} className="icon">
      <rect x="4.4" y="4.4" width="7.2" height="7.2" rx="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Filled play triangle, the counterpart to the stop square. */
export function IconStart() {
  return (
    <svg {...GRID} className="icon">
      <path d="M5.6 3.7 12.6 8 5.6 12.3Z" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Magnifier from the same grid — replaces the malformed CSS circle. */
export function IconSearch() {
  return (
    <svg {...GRID} className="icon">
      <circle cx="6.75" cy="6.75" r="4.25" />
      <path d="M9.85 9.85 13.5 13.5" />
    </svg>
  )
}
