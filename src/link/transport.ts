/**
 * The one thing the app needs from a device connection, whichever way it is
 * made.
 *
 * There are two implementations and the difference is not cosmetic. In a
 * browser the page opens the WebSocket itself. In the desktop app it cannot:
 * Tauri registers its custom scheme as a *trustworthy* origin, which makes the
 * webview a secure context, and a secure context is forbidden from opening a
 * plain `ws://` to a switcher exactly as an https page is. So the desktop build
 * does its device I/O in Rust and the webview only ever talks to it over IPC.
 *
 * Everything above this interface — the command line, the compiler, the log,
 * the empty-memory detection — is identical either way.
 */

export type LinkState = 'idle' | 'connecting' | 'open' | 'closed' | 'error' | 'blocked'

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

export interface Link {
  connect(): void
  disconnect(): void
  /** Write one property. This *is* the command — there is no separate verb. */
  write(path: readonly string[], value: unknown): boolean
  readonly state: LinkState
}

/** True when running inside the Tauri desktop shell rather than a browser. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
