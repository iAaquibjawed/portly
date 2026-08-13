import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  APERTURE,
  CANDIDATES,
  MARK_GRID,
  REJECTED_FULL_SIDE,
  apertureRatio,
  enclosureMark,
  type MarkSpec,
} from '../shared/marks'
import './trayCompare.css'

/**
 * Renders every tray candidate at true size in the four contexts a menu-bar
 * glyph actually lives in. Template behaviour is simulated the way macOS does
 * it: the mask is filled with `currentColor`, so black / inverted-white /
 * tint-white all come from one source of geometry.
 */

function Mark({ mark, size }: { mark: MarkSpec; size: number }) {
  // The markup string is rendered verbatim — the sheet and the shipped PNGs
  // consume the identical source, so review cannot drift from what ships.
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`}
      aria-label={mark.label}
      dangerouslySetInnerHTML={{ __html: mark.svg }}
    />
  )
}

/* Generic silhouettes of the neighbours a menu-bar glyph must not be confused
   with. Approximations drawn for collision testing, not copies of Apple art. */

function NeighbourWifi({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="wifi">
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M2 6.2a9 9 0 0 1 12 0" strokeWidth="1.7" />
        <path d="M4.4 9a5.6 5.6 0 0 1 7.2 0" strokeWidth="1.7" />
      </g>
      <circle cx="8" cy="12" r="1.3" fill="currentColor" />
    </svg>
  )
}

function NeighbourBattery({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="battery">
      <rect
        x="1"
        y="5"
        width="12"
        height="6.5"
        rx="1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <rect x="2.4" y="6.4" width="7" height="3.7" rx="0.9" fill="currentColor" />
      <path d="M14 7.4v1.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function NeighbourVolume({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="volume">
      <path d="M2 6.2h2.4L7.6 3.4v9.2L4.4 9.8H2z" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M10 6.1a3 3 0 0 1 0 3.8" />
        <path d="M12.1 4.4a5.6 5.6 0 0 1 0 7.2" />
      </g>
    </svg>
  )
}

function NeighbourSpotlight({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="spotlight">
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        <circle cx="7" cy="7" r="4.4" />
        <path d="M10.4 10.4 14 14" />
      </g>
    </svg>
  )
}

function NeighbourControlCentre({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-label="control centre">
      <g fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="2" y="2.2" width="12" height="5.1" rx="2.55" />
        <rect x="2" y="8.7" width="12" height="5.1" rx="2.55" />
      </g>
      <circle cx="10.6" cy="4.75" r="1.5" fill="currentColor" />
      <circle cx="5.4" cy="11.25" r="1.5" fill="currentColor" />
    </svg>
  )
}

const NEIGHBOURS = [
  NeighbourWifi,
  NeighbourBattery,
  NeighbourVolume,
  NeighbourSpotlight,
  NeighbourControlCentre,
]

type Context = 'light' | 'dark' | 'tint'

const CONTEXT_LABEL: Record<Context, string> = {
  light: 'Light menu bar — black mask',
  dark: 'Dark menu bar — inverted white',
  tint: 'Menu open — system tint',
}

function Bar({
  context,
  children,
}: {
  context: Context
  children: React.ReactNode
}) {
  return (
    <div className="menubar" data-context={context}>
      {children}
    </div>
  )
}

function CandidateRow({ mark }: { mark: MarkSpec }) {
  return (
    <div className="row">
      <div className="row-head">
        <div className="row-title">{mark.label}</div>
        <div className="row-intent">{mark.intent}</div>
        {/* Magnified for geometry inspection only — the small ones are truth. */}
        <div className="zoom">
          <span className="zoom-glyph">
            <Mark mark={mark} size={96} />
          </span>
          <span className="zoom-caption">6× · geometry only</span>
        </div>
      </div>

      <div className="row-cells">
        {(['light', 'dark', 'tint'] as Context[]).map((context) => (
          <div className="cell" key={context}>
            <div className="cell-label">{CONTEXT_LABEL[context]}</div>
            <Bar context={context}>
              <span className="slot">
                <Mark mark={mark} size={16} />
              </span>
              <span className="slot">
                <Mark mark={mark} size={32} />
              </span>
            </Bar>
            <div className="cell-caption">16pt (1×) · 32px (@2×)</div>
          </div>
        ))}

        <div className="cell cell--wide">
          <div className="cell-label">Beside real neighbours — collision test</div>
          {(['light', 'dark'] as Context[]).map((context) => (
            <Bar context={context} key={context}>
              <span className="slot slot--subject">
                <Mark mark={mark} size={16} />
              </span>
              <span className="divider" />
              {NEIGHBOURS.map((Neighbour, i) => (
                <span className="slot" key={i}>
                  <Neighbour size={16} />
                </span>
              ))}
            </Bar>
          ))}
          <div className="cell-caption">
            candidate first, then wifi · battery · volume · spotlight · control centre
          </div>
        </div>
      </div>
    </div>
  )
}



function Sheet() {
  return (
    <div className="sheet">
      <div className="problem">
        <div className="problem-label">The letterform failure being fixed</div>
        <div className="problem-body">
          <span className="zoom-glyph zoom-glyph--sm">
            <Mark mark={REJECTED_FULL_SIDE} size={64} />
          </span>
          <Bar context="light">
            <span className="slot slot--subject">
              <Mark mark={REJECTED_FULL_SIDE} size={16} />
            </span>
            <span className="divider" />
            {NEIGHBOURS.map((Neighbour, i) => (
              <span className="slot" key={i}>
                <Neighbour size={16} />
              </span>
            ))}
          </Bar>
          <div className="problem-note">
            The same geometry with the aperture at 100% — the whole right side
            absent. This is a letter C, and Claude&rsquo;s mark is a C, so it cannot
            ship. The fix below is one number: the aperture drops to{' '}
            {Math.round(APERTURE * 100)}% of the height, centred, and the top and
            bottom strokes run the full width so the eye closes the form.
          </div>
        </div>
      </div>

      <div className="row">
        <div className="row-head">
          <div className="row-title">Aperture ladder</div>
          <div className="row-intent">
            Which aperture stops reading as a letter at 16px. Pick the largest
            value that still reads as a broken rectangle.
          </div>
        </div>
        <div className="row-cells">
          {[0.4, 0.32, 0.3, 0.28, 0.24, 0.2, 0.16].map((aperture) => {
            const mark = enclosureMark(aperture)
            return (
              <div className="cell" key={mark.id}>
                <div className="cell-label">
                  {mark.label} · gap/stub {apertureRatio(aperture).toFixed(2)}
                </div>
                <Bar context="light">
                  <span className="slot">
                    <Mark mark={mark} size={16} />
                  </span>
                  <span className="slot">
                    <Mark mark={mark} size={32} />
                  </span>
                </Bar>
                <Bar context="dark">
                  <span className="slot">
                    <Mark mark={mark} size={16} />
                  </span>
                  <span className="slot">
                    <Mark mark={mark} size={32} />
                  </span>
                </Bar>
                <span className="zoom-glyph zoom-glyph--sm">
                  <Mark mark={mark} size={56} />
                </span>
                <div className="cell-caption">{mark.intent}</div>
              </div>
            )
          })}
        </div>
      </div>

      {CANDIDATES.map((mark) => (
        <CandidateRow mark={mark} key={mark.id} />
      ))}
    </div>
  )
}

const container = document.getElementById('root')
if (!container) throw new Error('trayCompare: #root missing')

createRoot(container).render(
  <StrictMode>
    <Sheet />
  </StrictMode>,
)
