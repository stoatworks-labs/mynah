/**
 * The Web RCS WebSocket — the socket the vendor browser UI itself speaks.
 *
 * Undocumented, but recovered from the Web RCS bundle and confirmed against a
 * running device on firmware 6.2.73. It is the right transport for a browser
 * tool for three reasons: a page cannot open a raw TCP socket at all, so AWJ
 * on 10606 is unreachable from here; the device pushes state unsolicited from
 * the moment the socket opens, with no subscription list to get wrong; and
 * there is no documented five-client cap.
 *
 * Wire format:
 *
 *   {"channel":"DEVICE","data":{"path":["device",…],"value":…}}
 *
 * The same envelope goes both ways — writing a property *is* the command, and
 * the device echoes the write back. `REMOTE` carries the Web RCS's own shared
 * UI store instead: which browser has which screen selected.
 *
 * Keepalives are bare text frames, `0x9` out and `0xA` back — not WebSocket
 * control frames, and not JSON.
 */

export const PING = '0x9'
export const PONG = '0xA'

/** Idle time before pinging starts, and the gap between pings thereafter. */
const PING_SILENT_MS = 3000
const PING_INTERVAL_MS = 1000

/** The Web RCS is on port 80 on a device and 3000 on the simulator. */
export const DEVICE_PORT = 80
export const SIMULATOR_PORT = 3000

export type LinkState = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface DeviceValue {
  readonly path: readonly string[]
  readonly value: unknown
}

export interface LinkEvents {
  onState?: (state: LinkState, detail?: string) => void
  /** A device property changed — either ours echoed back, or someone else's. */
  onValue?: (v: DeviceValue) => void
  /** The vendor UI's own screen selection, when it changes. */
  onRemoteSelection?: (keys: readonly string[]) => void
}

export class WebRcsLink {
  private ws?: WebSocket
  private pingTimer?: ReturnType<typeof setInterval>
  private idleTimer?: ReturnType<typeof setTimeout>
  private closedByUs = false

  /** Last known value per path key, seeded by echoes and pushes alike. */
  readonly cache = new Map<string, unknown>()

  constructor(
    private readonly url: string,
    private readonly events: LinkEvents = {},
  ) {}

  static urlFor(host: string, port: number = DEVICE_PORT): string {
    // The socket lives at the server root, sharing the Web RCS's own port.
    return `ws://${host}:${port}/`
  }

  get state(): LinkState {
    if (!this.ws) return 'idle'
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting'
      case WebSocket.OPEN:
        return 'open'
      default:
        return 'closed'
    }
  }

  connect(): void {
    this.closedByUs = false
    this.events.onState?.('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch (e) {
      this.events.onState?.('error', e instanceof Error ? e.message : String(e))
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.events.onState?.('open')
      this.restartPing()
    }

    ws.onmessage = (ev) => {
      const data = ev.data
      if (typeof data !== 'string') return

      // The device pings us too, and expects the answer.
      if (data === PING) {
        this.sendRaw(PONG)
        return
      }
      if (data === PONG) return

      this.restartPing()

      let msg: unknown
      try {
        msg = JSON.parse(data)
      } catch {
        return
      }
      this.handle(msg)
    }

    ws.onerror = () => {
      // The browser deliberately withholds the reason for a WebSocket error,
      // so there is nothing more specific to report than that it failed.
      this.events.onState?.('error', 'Connection failed')
    }

    ws.onclose = () => {
      this.stopPing()
      this.events.onState?.('closed', this.closedByUs ? 'Disconnected' : 'Connection lost')
    }
  }

  disconnect(): void {
    this.closedByUs = true
    this.stopPing()
    this.ws?.close()
    this.ws = undefined
  }

  /**
   * Write one property. This *is* the command — there is no separate verb.
   *
   * Writes are not awaited: ordering on a single socket is guaranteed, and a
   * compound command like a masked master store depends on its filters landing
   * before its trigger, which a burst preserves and a request/response round
   * trip per op would only slow down.
   */
  write(path: readonly string[], value: unknown): boolean {
    return this.sendRaw(JSON.stringify({ channel: 'DEVICE', data: { path, value } }))
  }

  private sendRaw(text: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(text)
    return true
  }

  private handle(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return
    const m = msg as { channel?: string; data?: unknown }

    if (m.channel === 'DEVICE') {
      const d = m.data as { path?: unknown; value?: unknown } | undefined
      if (!d || !Array.isArray(d.path)) return
      const path = d.path.map(String)
      this.cache.set(path.join('/'), d.value)
      this.events.onValue?.({ path, value: d.value })
      return
    }

    if (m.channel === 'REMOTE') {
      this.handleRemote(m.data)
    }
  }

  /**
   * The vendor UI's shared store: an `INIT` snapshot then RFC 6902 patches.
   *
   * Only one thing in it matters here — which screens the operator has
   * selected in the vendor UI — so rather than mirroring the whole store and
   * applying patches to it, both shapes are read for that one key.
   */
  private handleRemote(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const d = data as { channel?: string; snapshot?: unknown; patch?: unknown }

    if (d.channel === 'INIT') {
      const keys = readSelection(d.snapshot)
      if (keys) this.events.onRemoteSelection?.(keys)
      return
    }

    if (d.channel === 'PATCH') {
      const p = d.patch as { path?: unknown; value?: unknown } | undefined
      if (typeof p?.path !== 'string') return
      if (!p.path.startsWith('/live/screens/screenAuxSelection')) return
      const keys = Array.isArray(p.value) ? p.value.map(String) : undefined
      if (keys) this.events.onRemoteSelection?.(keys)
    }
  }

  /**
   * Ping only once the link has gone quiet, matching the vendor client. On a
   * busy device the traffic itself is proof of life and no ping is needed.
   */
  private restartPing(): void {
    this.stopPing()
    this.idleTimer = setTimeout(() => {
      this.pingTimer = setInterval(() => this.sendRaw(PING), PING_INTERVAL_MS)
    }, PING_SILENT_MS)
  }

  private stopPing(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.idleTimer = undefined
    this.pingTimer = undefined
  }
}

function readSelection(snapshot: unknown): string[] | undefined {
  const s = snapshot as
    | { live?: { screens?: { screenAuxSelection?: { keys?: unknown } } } }
    | undefined
  const keys = s?.live?.screens?.screenAuxSelection?.keys
  return Array.isArray(keys) ? keys.map(String) : undefined
}
