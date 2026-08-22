/**
 * The desktop transport: device I/O happens in Rust, the webview only listens.
 *
 * This exists because the webview cannot do it. Tauri registers its scheme as
 * trustworthy, so the page is a secure context, and a secure context may not
 * open a plain `ws://` — the same rule that stops the hosted https copy
 * reaching a switcher. Moving the socket into Rust removes the browser sandbox
 * from the path entirely, which is the whole reason the desktop build exists.
 *
 * The Rust side speaks the same Web RCS WebSocket and emits the same three
 * things this app has always consumed, so nothing above `Link` can tell the
 * difference.
 */

import type { AwjMessage, AwjReply, DeviceValue, Link, LinkEvents, LinkState } from './transport.ts'

/** Minimal shape of the Tauri v2 API, resolved lazily so a browser build never loads it. */
interface TauriApi {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>
  listen(event: string, handler: (e: { payload: unknown }) => void): Promise<() => void>
}

async function tauri(): Promise<TauriApi> {
  const [core, event] = await Promise.all([
    import(/* @vite-ignore */ '@tauri-apps/api/core'),
    import(/* @vite-ignore */ '@tauri-apps/api/event'),
  ])
  return { invoke: core.invoke, listen: event.listen as TauriApi['listen'] }
}

export class DesktopLink implements Link {
  private unlisten: (() => void)[] = []
  private current: LinkState = 'idle'

  /**
   * This is the build that can. Rust has no browser sandbox in front of it, so
   * TCP 10606 is simply a socket — which makes the desktop app the only place
   * an AWJ `get` can be answered, and the only place a message can go out on
   * the wire in the form it was typed rather than translated to the store
   * spelling first.
   */
  readonly canAwj = true

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly events: LinkEvents = {},
  ) {}

  get state(): LinkState {
    return this.current
  }

  private setState(state: LinkState, detail?: string): void {
    this.current = state
    this.events.onState?.(state, detail)
  }

  connect(): void {
    this.setState('connecting')
    void (async () => {
      const api = await tauri()

      // Subscribed before connecting, so a device that answers immediately
      // cannot beat the listeners into place.
      await this.subscribe(api)

      try {
        await api.invoke('link_connect', { host: this.host, port: this.port })
      } catch (e) {
        this.setState('error', String(e))
      }
    })()
  }

  private async subscribe(api: TauriApi): Promise<void> {
    if (this.unlisten.length > 0) return

    this.unlisten.push(
      await api.listen('link-state', (e) => {
        const p = e.payload as { state?: string; detail?: string }
        if (p?.state) this.setState(p.state as LinkState, p.detail)
      }),
      await api.listen('device-value', (e) => {
        const p = e.payload as DeviceValue
        if (p && Array.isArray(p.path)) this.events.onValue?.(p)
      }),
      await api.listen('remote-selection', (e) => {
        const keys = e.payload as string[]
        if (Array.isArray(keys)) this.events.onRemoteSelection?.(keys)
      }),
    )
  }

  disconnect(): void {
    void (async () => {
      const api = await tauri()
      try {
        await api.invoke('link_disconnect')
      } catch {
        // Already gone; the state event will have said so.
      }
      for (const off of this.unlisten) off()
      this.unlisten = []
      this.setState('idle')
    })()
  }

  /**
   * Writes are fire-and-forget, matching the browser transport: ordering on one
   * socket is guaranteed, and a masked master store depends on its filters
   * landing before its trigger. Awaiting each op would only be slower.
   */
  write(path: readonly string[], value: unknown): boolean {
    if (this.current !== 'open') return false
    void (async () => {
      const api = await tauri()
      try {
        await api.invoke('link_write', { path, value })
      } catch {
        // A failed write surfaces as the command never being confirmed, which
        // is already how an unacknowledged command is reported.
      }
    })()
    return true
  }

  /**
   * One AWJ exchange, on a connection of its own.
   *
   * Deliberately not pooled. The device allows five AWJ clients at once and
   * counts them; a console that opened one on startup would hold a scarce slot
   * open for the sake of the occasional typed `get`, and would show up as a
   * client to whoever is looking at the device's own list. A connect per
   * command costs a few milliseconds and nothing else.
   */
  async awj(messages: readonly AwjMessage[]): Promise<readonly AwjReply[]> {
    const api = await tauri()
    const replies = await api.invoke('link_awj', {
      host: this.host,
      messages: messages.map((m) => ({ op: m.op, path: m.path, value: m.value ?? null })),
    })
    return (Array.isArray(replies) ? replies : []) as AwjReply[]
  }
}
