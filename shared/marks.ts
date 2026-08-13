/**
 * The Portly mark: a closed square enclosure broken by a single aperture on the
 * right edge. One geometry, expressed at two scales.
 *
 * The failure this geometry is tuned against: if the aperture grows past about
 * a third of the height, the form stops reading as a broken rectangle and
 * starts reading as the letter C. That is a hard failure — Claude's mark is a C,
 * and Portly is an independent project that must not look like a Claude tool.
 * `APERTURE` is the single number that controls it.
 *
 * Constraints:
 *  - square corners, zero radius — rounding pushes it toward a letterform
 *  - uniform stroke, flat caps, no taper; aperture terminals cut flush+vertical
 *  - genuinely square: equal width and height
 *  - nothing thinner than 1pt
 */

export const MARK_GRID = 16

export interface Rect {
  x: number
  y: number
  w: number
  h: number
  /** Always 0 — square corners are load-bearing for this mark. */
  r: number
}

export interface MarkSpec {
  id: string
  label: string
  intent: string
  /** Inner SVG markup on the 16×16 grid. */
  svg: string
}

/** Ink extent as a fraction of the box: 13 of 16pt, leaving optical padding. */
export const ENCLOSURE_INK = 13 / 16
/** 1.75pt at a 16pt grid. */
export const ENCLOSURE_STROKE_TRAY = 1.75 / 13
/** Marginally heavier at hero size, where a template weight reads timid. */
export const ENCLOSURE_STROKE_APP = 0.15
/**
 * Aperture as a fraction of total height, centred on the right edge.
 *
 * The number that actually governs the read is the aperture measured against
 * the right-edge stubs flanking it (`apertureRatio`). Once the gap approaches
 * the length of a stub, the eye stops seeing a broken edge and closes the form
 * into a letter C. Measured on the 16px ladder in
 * `mockups/tray-candidates.png`:
 *
 *   aperture  30%   28%   24%   22%   20%
 *   gap/stub  0.86  0.78  0.63  0.56  0.50
 *   16px      C     C-ish notch notch notch
 *
 * 0.22 sits clear of the tipping point while keeping the aperture obvious at
 * 1× (2.9pt of a 13pt edge). This is below the 28–32% the brief estimated,
 * because 28% still failed the 16px test the brief set as the gate.
 */
export const APERTURE = 0.22

/**
 * The one geometry function. Five filled rectangles — filled rather than
 * stroked so the corners are exactly square and the aperture terminals are
 * exactly flush and vertical, with no cap or join behaviour to negotiate.
 */
export function enclosureRects(
  box: number,
  strokeRatio: number,
  aperture: number = APERTURE,
  ink: number = ENCLOSURE_INK,
): Rect[] {
  const span = box * ink
  const origin = (box - span) / 2 // equal on both axes: genuinely square
  const stroke = span * strokeRatio
  const gap = span * aperture
  const segment = (span - gap) / 2 // right edge above and below the aperture
  const far = origin + span - stroke

  return [
    { x: origin, y: origin, w: span, h: stroke, r: 0 }, // top, full width
    { x: origin, y: far, w: span, h: stroke, r: 0 }, // bottom, full width
    { x: origin, y: origin, w: stroke, h: span, r: 0 }, // left
    // Right edge, split by the aperture. The top and bottom strokes already run
    // the full width, so these two stubs are what close the form.
    { x: far, y: origin, w: stroke, h: segment, r: 0 },
    { x: far, y: origin + span - segment, w: stroke, h: segment, r: 0 },
  ]
}

function rectsToSvg(rects: Rect[]): string {
  return rects
    .filter((r) => r.w > 0 && r.h > 0)
    .map(
      (r) =>
        `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="currentColor"/>`,
    )
    .join('')
}

const ENCLOSURE: MarkSpec = {
  id: 'enclosure',
  label: 'Open enclosure',
  intent: 'A square broken by a centred aperture — 22% of the height',
  svg: rectsToSvg(enclosureRects(MARK_GRID, ENCLOSURE_STROKE_TRAY)),
}

/**
 * Kept only as verification evidence: the same function with the aperture at
 * 100%, i.e. the whole right side absent. This is the execution that reads as a
 * letter. Not a candidate.
 */
export const REJECTED_FULL_SIDE: MarkSpec = {
  id: 'rejected-full-side',
  label: 'Rejected — full-side opening',
  intent: 'Entire right side absent: unmistakably the letter C',
  svg: rectsToSvg(enclosureRects(MARK_GRID, ENCLOSURE_STROKE_TRAY, 1)),
}

/** Builds the mark at an arbitrary aperture, for the 16px verification ladder. */
export function enclosureMark(aperture: number): MarkSpec {
  const pct = Math.round(aperture * 100)
  return {
    id: `enclosure-${pct}`,
    label: `${pct}%`,
    intent:
      apertureRatio(aperture) >= 0.78
        ? 'reads as C'
        : apertureRatio(aperture) >= 0.6
          ? 'notch'
          : 'notch, tight',
    svg: rectsToSvg(enclosureRects(MARK_GRID, ENCLOSURE_STROKE_TRAY, aperture)),
  }
}

/** Ratio of aperture to right-edge stub — the number that governs the read. */
export function apertureRatio(aperture: number): number {
  return aperture / ((1 - aperture) / 2)
}

export const CANDIDATES: MarkSpec[] = [ENCLOSURE]

/** The shipped mark. */
export const TRAY_MARK = ENCLOSURE

/** Standalone template SVG: currentColor only, nothing to outline. */
export function markTemplateSvg(mark: MarkSpec, size = MARK_GRID): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${MARK_GRID} ${MARK_GRID}">${mark.svg}</svg>`
  )
}

/* -------------------------------------------------------------- app icon -- */

/**
 * Apple's Big Sur macOS app-icon grid: a 1024 canvas with an 824×824 body,
 * which is a 100pt inset on every side.
 */
export const APP_CANVAS = 1024
export const APP_BODY_INSET = 100 / APP_CANVAS
/** Mark ink height as a fraction of the canvas. */
export const APP_MARK_HEIGHT = 0.4
/** Superellipse exponent approximating the macOS continuous corner. */
export const APP_SQUIRCLE_N = 5

/** Superellipse path — closer to the macOS corner than a border-radius. */
export function squirclePath(
  cx: number,
  cy: number,
  half: number,
  n = APP_SQUIRCLE_N,
  steps = 256,
): string {
  const points: string[] = []
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const x = Math.sign(ct) * Math.abs(ct) ** (2 / n) * half
    const y = Math.sign(st) * Math.abs(st) ** (2 / n) * half
    points.push(`${(cx + x).toFixed(3)} ${(cy + y).toFixed(3)}`)
  }
  return `M${points[0]}L${points.slice(1).join('L')}Z`
}

/**
 * The same mark at app-icon scale: identical ratios and identical aperture,
 * only the box and the stroke ratio differ. A pure translation of the box
 * centre onto the canvas centre — the enclosure is horizontally symmetric apart
 * from the aperture, so bounding-box centring is already optically correct and
 * no centroid correction is wanted.
 */
export function appMarkRects(canvas = APP_CANVAS): Rect[] {
  const box = (canvas * APP_MARK_HEIGHT) / ENCLOSURE_INK
  const offset = (canvas - box) / 2
  return enclosureRects(box, ENCLOSURE_STROKE_APP).map((r) => ({
    ...r,
    x: r.x + offset,
    y: r.y + offset,
  }))
}
