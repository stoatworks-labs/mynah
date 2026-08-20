/**
 * X-Keys support over WebHID.
 *
 * An X-Keys panel is a plain HID device that no driver claims, so a browser
 * can open it directly once the user has picked it from the chooser. That is
 * what makes it the one programmable panel that works in a static web tool
 * with nothing installed — a Stream Deck cannot be opened this way while
 * Elgato's own software holds it, which is why that route is a plugin instead
 * (see `docs/DEVICES.md`).
 *
 * ⚠️ Written against PI Engineering's published report layout and exercised
 * only with a synthetic report. It has never been run against a physical
 * panel, so the button offset is a setting rather than a constant.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** PI Engineering, who make every X-Keys panel. */
export const XKEYS_VENDOR_ID = 0x05f3

/**
 * Where the button bitmap starts in an input report.
 *
 * X-Keys reports lead with a unit id and a protocol byte, then carry the keys
 * as a column-major bitmap: one byte per column, one bit per row, so the key
 * index the panel's own documentation uses is `column * 8 + row`. Panels
 * differ, which is why this is adjustable.
 */
const DEFAULT_BUTTON_OFFSET = 2

export interface XKeysBinding {
  /** Key index as printed in the X-Keys documentation. */
  readonly key: number
  /** A command string, run exactly as if it had been typed. */
  readonly command: string
}

export interface XKeysState {
  readonly supported: boolean
  readonly connected: boolean
  readonly productName?: string
  readonly bindings: readonly XKeysBinding[]
  readonly lastKey?: number
  request: () => void
  disconnect: () => void
  setBindings: (b: readonly XKeysBinding[]) => void
}

/** A starting layout: the commands a memory-recall panel most obviously wants. */
export const DEFAULT_BINDINGS: readonly XKeysBinding[] = [
  { key: 0, command: 'Take' },
  { key: 1, command: 'Recall Memory 1' },
  { key: 2, command: 'Recall Memory 2' },
  { key: 3, command: 'Recall Memory 3' },
  { key: 4, command: 'Recall Memory 4' },
  { key: 8, command: 'Select Screen 1' },
  { key: 9, command: 'Select Screen 2' },
  { key: 10, command: 'Select Screen 3' },
  { key: 11, command: 'Select Screen 4' },
]

const STORAGE_KEY = 'mynah.xkeys.bindings'

export function useXKeys(run: (command: string) => void): XKeysState {
  const deviceRef = useRef<HIDDevice | undefined>(undefined)
  const previous = useRef<Uint8Array | undefined>(undefined)
  const [connected, setConnected] = useState(false)
  const [productName, setProductName] = useState<string | undefined>()
  const [lastKey, setLastKey] = useState<number | undefined>()
  const [bindings, setBindingsState] = useState<readonly XKeysBinding[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw) as XKeysBinding[]
    } catch {
      // A corrupt binding set should cost the defaults, not the whole app.
    }
    return DEFAULT_BINDINGS
  })

  const supported = typeof navigator !== 'undefined' && 'hid' in navigator

  const setBindings = useCallback((b: readonly XKeysBinding[]) => {
    setBindingsState(b)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(b))
    } catch {
      // Private browsing; the bindings simply will not persist.
    }
  }, [])

  const runRef = useRef(run)
  runRef.current = run
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings

  const onInputReport = useCallback((event: HIDInputReportEvent) => {
    const data = new Uint8Array(event.data.buffer)
    const prev = previous.current
    previous.current = data

    // The panel reports the state of every key on every report, so a press is
    // a bit that was clear and is now set. Without the previous report there
    // is nothing to diff against, and the first report is only a baseline —
    // acting on it would fire whatever was already held down at connect.
    if (!prev) return

    for (let byte = DEFAULT_BUTTON_OFFSET; byte < data.length; byte++) {
      const changed = (prev[byte] ?? 0) ^ data[byte]
      if (changed === 0) continue
      for (let bit = 0; bit < 8; bit++) {
        const mask = 1 << bit
        if ((changed & mask) === 0) continue
        const pressed = (data[byte] & mask) !== 0
        if (!pressed) continue // release does nothing; commands fire on press
        const key = (byte - DEFAULT_BUTTON_OFFSET) * 8 + bit
        setLastKey(key)
        const binding = bindingsRef.current.find((b) => b.key === key)
        if (binding) runRef.current(binding.command)
      }
    }
  }, [])

  const attach = useCallback(
    async (device: HIDDevice) => {
      if (!device.opened) await device.open()
      device.addEventListener('inputreport', onInputReport)
      deviceRef.current = device
      previous.current = undefined
      setConnected(true)
      setProductName(device.productName)
    },
    [onInputReport],
  )

  const request = useCallback(() => {
    if (!supported) return
    void navigator.hid
      .requestDevice({ filters: [{ vendorId: XKEYS_VENDOR_ID }] })
      .then((devices) => {
        if (devices.length > 0) return attach(devices[0])
      })
      .catch(() => {
        // The chooser was dismissed, which is not an error worth surfacing.
      })
  }, [supported, attach])

  const disconnect = useCallback(() => {
    const d = deviceRef.current
    if (d) {
      d.removeEventListener('inputreport', onInputReport)
      void d.close()
    }
    deviceRef.current = undefined
    previous.current = undefined
    setConnected(false)
    setProductName(undefined)
  }, [onInputReport])

  // A panel already granted in a previous session reattaches without a
  // chooser, so the operator does not re-authorise their own panel every load.
  useEffect(() => {
    if (!supported) return
    void navigator.hid.getDevices().then((devices) => {
      const xk = devices.find((d) => d.vendorId === XKEYS_VENDOR_ID)
      if (xk) void attach(xk)
    })
  }, [supported, attach])

  useEffect(() => () => disconnect(), [disconnect])

  return { supported, connected, productName, bindings, lastKey, request, disconnect, setBindings }
}
