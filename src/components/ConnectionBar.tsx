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
}

const LABEL: Record<LinkState, string> = {
  idle: 'Offline',
  connecting: 'Connecting',
  open: 'Connected',
  closed: 'Disconnected',
  error: 'Error',
  blocked: 'Blocked by HTTPS',
}

export function ConnectionBar({ state, detail, host, port, onHost, onPort, onConnect, onDisconnect }: Props) {
  const live = state === 'open' || state === 'connecting'

  return (
    <div className="connbar">
      <label className="field">
        <span>Device</span>
        <input
          value={host}
          onChange={(e) => onHost(e.target.value)}
          disabled={live}
          spellCheck={false}
          size={14}
        />
      </label>
      <label className="field">
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
        {live ? 'Disconnect' : 'Connect'}
      </button>
      <span className={`status status-${state}`} title={detail}>
        <i className="dot" />
        {LABEL[state]}
      </span>
    </div>
  )
}
