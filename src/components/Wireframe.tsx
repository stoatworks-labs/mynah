import type { Buffer, Screen, SimDevice } from '../sim/device.ts'

interface Props {
  device: SimDevice
  /** Bumped by the link on every change, to force a redraw. */
  tick: number
}

/**
 * What the simulated switcher is putting out, drawn as wireframes.
 *
 * Two panes per screen — program and preview — because that distinction is the
 * one the command line is really about, and because seeing them swap is the
 * only way a Take reads as anything at all.
 *
 * The buffer letter is shown next to each pane on purpose. Preview and program
 * are names for whichever buffer is pending or live, the mapping differs
 * between screens, and a take swaps it. Anyone who later reads a status path
 * and finds `A`/`B`/`C` should already have seen where those come from.
 */
export function Wireframe({ device, tick }: Props) {
  void tick
  return (
    <div className="wire">
      <div className="wire-head">
        <h2>Simulated output</h2>
        <span className="wire-note">Not a real switcher — a model to learn the syntax against</span>
      </div>
      <div className="wire-grid">
        {device.screens.map((s) => (
          <ScreenView key={s.key} device={device} screen={s} />
        ))}
      </div>
    </div>
  )
}

function ScreenView({ device, screen }: { device: SimDevice; screen: Screen }) {
  const pgm = screen.live
  const pvw: Buffer = screen.live === 'A' ? 'B' : 'A'

  return (
    <section className="wire-screen">
      <header className="wire-screen-head">
        <strong>Screen {screen.n}</strong>
        <span className="wire-canvas">
          {screen.width}×{screen.height}
        </span>
      </header>
      <div className="wire-panes">
        <Pane device={device} screen={screen} buffer={pgm} role="Program" onAir />
        <Pane device={device} screen={screen} buffer={pvw} role="Preview" />
      </div>
    </section>
  )
}

function Pane({
  device,
  screen,
  buffer,
  role,
  onAir = false,
}: {
  device: SimDevice
  screen: Screen
  buffer: Buffer
  role: string
  onAir?: boolean
}) {
  const content = screen.content[buffer]
  const mem = content.memory ? device.screenMemories.get(content.memory) : undefined
  // A 16:9 box regardless of the real canvas: this is a diagram of what is on
  // the screen, not a scale drawing of the canvas.
  const W = 160
  const H = 90

  return (
    <figure className={`wire-pane ${onAir ? 'on-air' : 'pvw'}`}>
      <figcaption>
        <span className="wire-role">{role}</span>
        <span className="wire-buffer" title="The device reports memories against this buffer, not against preview/program">
          buffer {buffer}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="wire-svg" role="img" aria-label={`${role}: ${mem?.label ?? 'empty'}`}>
        <rect x="0" y="0" width={W} height={H} className="wire-bg" />
        {content.layers.length === 0 && (
          <text x={W / 2} y={H / 2} className="wire-empty-text" textAnchor="middle" dominantBaseline="middle">
            empty
          </text>
        )}
        {content.layers.map((l) => (
          <g key={l.layer}>
            <rect
              x={l.x * W}
              y={l.y * H}
              width={l.w * W}
              height={l.h * H}
              className={l.layer === 0 ? 'wire-native' : 'wire-layer'}
            />
            <text x={l.x * W + 3} y={l.y * H + 8} className="wire-label">
              {l.layer === 0 ? 'NATIVE' : `L${l.layer}`} {l.source}
            </text>
          </g>
        ))}
      </svg>
      <footer className="wire-mem">
        {content.memory ? (
          <>
            <span className="wire-memno">MEM {content.memory}</span>
            {mem?.label && <span className="wire-memlabel">{mem.label}</span>}
          </>
        ) : (
          <span className="wire-memno wire-none">no memory</span>
        )}
      </footer>
    </figure>
  )
}
