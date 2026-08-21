import type { LinkState } from '../link/webrcs.ts'

interface Props {
  state: LinkState
  detail?: string
  host: string
  port: number
  onHost: (v: string) => void
  onPort: (v: number) => void
  onConnect: (host: string, port: number) => void
  onDisconnect: () => void
  /** Run against the built-in simulator rather than a switcher. */
  demo: boolean
  onDemo: (v: boolean) => void
  /** True when a real connection is impossible here, so demo cannot be turned off. */
  demoLocked: boolean
}

const LABEL: Record<LinkState, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  open: 'Connected',
  closed: 'Disconnected',
  error: 'Error',
  blocked: 'Blocked by HTTPS',
}

export function ConnectionBar({
  state,
  detail,
  host,
  port,
  onHost,
  onPort,
  onConnect,
  onDisconnect,
  demo,
  onDemo,
  demoLocked,
}: Props) {
  const live = state === 'open' || state === 'connecting'

  return (
    <div className="connbar">
      <label
        className="toggle"
        title={
          demoLocked
            ? 'This page is served over HTTPS, so it cannot reach a switcher. The simulator is the only option here.'
            : 'Run commands against a model of a LivePremier instead of a real one'
        }
      >
        <input
          type="checkbox"
          checked={demo}
          disabled={live || demoLocked}
          onChange={(e) => onDemo(e.target.checked)}
        />
        <span>Simulator</span>
      </label>
      <label className="field" hidden={demo}>
        <span>Device</span>
        <input
          value={host}
          onChange={(e) => onHost(e.target.value)}
          disabled={live}
          spellCheck={false}
          size={14}
        />
      </label>
      <label className="field" hidden={demo}>
        <span>Port</span>
        <input
          value={String(port)}
          onChange={(e) => onPort(Number(e.target.value) || 0)}
          disabled={live}
          size={5}
          inputMode="numeric"
        />
      </label>
      <button
        className="btn"
        onClick={() => (live ? onDisconnect() : onConnect(host, port))}
      >
        {live ? 'Disconnect' : demo ? 'Start simulator' : 'Connect'}
      </button>
      <span className={`status status-${state}`} title={detail}>
        <i className="dot" />
        {LABEL[state]}
      </span>
    </div>
  )
}
