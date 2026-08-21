/**
 * The built-in simulator, as a transport.
 *
 * It implements the same `Link` as the browser WebSocket and the desktop IPC
 * bridge, so nothing above it changes: the same compiler produces the same
 * ops, the log reports the same statuses, and the empty-memory detection works
 * because the simulated device is deliberately as unhelpful as a real one.
 *
 * This is what the hosted copy runs. A page on https cannot reach a switcher —
 * the device is http-only with 443 closed — so rather than offer a connection
 * box that can only fail, the hosted build drives this and says so.
 */

import { SimDevice } from '../sim/device.ts'
import type { Link, LinkEvents, LinkState } from './transport.ts'

export class SimLink implements Link {
  private current: LinkState = 'idle'
  private timers: ReturnType<typeof setTimeout>[] = []

  constructor(
    readonly device: SimDevice,
    private readonly events: LinkEvents = {},
    /** Called after any op that could have changed what the screens show. */
    private readonly onChanged?: () => void,
  ) {}

  get state(): LinkState {
    return this.current
  }

  connect(): void {
    this.current = 'connecting'
    this.events.onState?.('connecting')
    // A beat of delay so the UI reads as a connection being made rather than
    // as a state that was always there.
    this.timers.push(
      setTimeout(() => {
        this.current = 'open'
        this.events.onState?.('open', 'Built-in simulator')
        this.events.onRemoteSelection?.(['S1'])
      }, 180),
    )
  }

  disconnect(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    this.current = 'idle'
    this.events.onState?.('idle')
  }

  write(path: readonly string[], value: unknown): boolean {
    if (this.current !== 'open') return false

    for (const push of this.device.apply(path, value)) {
      if (push.after) {
        this.timers.push(
          setTimeout(() => {
            this.events.onValue?.({ path: push.path, value: push.value })
            this.onChanged?.()
          }, push.after),
        )
      } else {
        // The echo goes out synchronously, as a device's does.
        this.events.onValue?.({ path: push.path, value: push.value })
      }
    }
    this.onChanged?.()
    return true
  }
}
