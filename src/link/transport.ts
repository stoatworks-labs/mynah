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

/** One AWJ message, in the protocol's own spelling. */
export interface AwjMessage {
  readonly op: 'replace' | 'get'
  readonly path: string
  readonly value?: unknown
}

/** What came back off the AWJ socket. */
export interface AwjReply {
  readonly path: string
  readonly value: unknown
}

export interface Link {
  connect(): void
  disconnect(): void
  /** Write one property. This *is* the command — there is no separate verb. */
  write(path: readonly string[], value: unknown): boolean
  readonly state: LinkState

  /**
   * Whether this transport can carry AWJ verbatim on TCP 10606.
   *
   * False in a browser, and not for want of trying: a page cannot open a raw
   * TCP socket, full stop. An AWJ message typed at the command line is still
   * perfectly runnable there — `Path` holds both spellings, so it is converted
   * to the store form and sent on the WebSocket, and it lands in exactly the
   * same place. What is lost is the *reply*: `{"op":"get",…}` has nowhere to
   * come back from, because the Web RCS socket is a stream of changes rather
   * than a request/response channel.
   *
   * So this flag gates two things — whether a `get` can be answered at all,
   * and whether the operator's choice between the two AWJ transports has more
   * than one option in it.
   */
  readonly canAwj: boolean

  /**
   * Send AWJ messages on a real 10606 socket and return the replies.
   *
   * Present only when `canAwj`. One connection is opened per call and closed
   * after it: the device allows five AWJ clients and this app is a guest on a
   * socket it does not own the rest of the time, so holding one open to answer
   * an occasional typed `get` would spend a scarce slot on nothing.
   */
  awj?(messages: readonly AwjMessage[]): Promise<readonly AwjReply[]>
}

/** True when running inside the Tauri desktop shell rather than a browser. */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
