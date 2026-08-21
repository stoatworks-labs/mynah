/**
 * A LivePremier, in memory.
 *
 * Enough of one to learn the command line against: four screens with layers,
 * three preset buffers each, and the four memory banks. It consumes the exact
 * paths the compiler emits and answers with the exact pushes a real device
 * sends, so the app above it cannot tell the difference — the log, the
 * empty-memory detection and the vendor-selection sync all work unchanged.
 *
 * It reproduces the real device's awkward behaviour on purpose, because those
 * are the things worth learning before you meet one:
 *
 *   - A recall of an empty memory is answered with **silence**. No error, no
 *     response at all.
 *   - Preview and program are names for whichever buffer is pending or live,
 *     and **which buffer that is differs per screen**. A take swaps them.
 *   - Status reports memories against buffers `A`/`B`/`C`, never against
 *     preview/program.
 *   - Master-store filters persist until overwritten.
 */

import { CATEGORIES } from '../lang/model.ts'

export type Buffer = 'A' | 'B' | 'C'

export interface LayerState {
  /** Layer number, or 0 for the background (`NATIVE`). */
  readonly layer: number
  readonly source: string
  /** Fractions of the canvas, so the wireframe scales to any box. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

export interface ScreenContent {
  readonly memory: number
  readonly layers: readonly LayerState[]
}

export interface Screen {
  readonly key: string
  readonly n: number
  readonly width: number
  readonly height: number
  /** Which buffer is currently on air. The other is preview. */
  live: Buffer
  content: Record<Buffer, ScreenContent>
  /** Cleared when a memory lands, set when anything is touched afterwards. */
  unmodified: Record<Buffer, boolean>
}

export interface Memory {
  readonly slot: number
  label: string
  readonly layers: readonly LayerState[]
}

const empty: ScreenContent = { memory: 0, layers: [] }

/** A few looks worth recalling, so a demo actually shows something changing. */
function seedMemories(): Map<number, Memory> {
  const l = (layer: number, source: string, x: number, y: number, w: number, h: number): LayerState =>
    ({ layer, source, x, y, w, h })

  const m: Memory[] = [
    { slot: 1, label: 'Full screen', layers: [l(0, 'BG — Gradient', 0, 0, 1, 1), l(1, 'IN 1 — Camera', 0, 0, 1, 1)] },
    { slot: 2, label: 'PIP bottom right', layers: [l(0, 'BG — Gradient', 0, 0, 1, 1), l(1, 'IN 1 — Camera', 0, 0, 1, 1), l(2, 'IN 2 — Laptop', 0.58, 0.58, 0.38, 0.36)] },
    { slot: 3, label: 'Side by side', layers: [l(0, 'BG — Blue', 0, 0, 1, 1), l(1, 'IN 1 — Camera', 0.02, 0.22, 0.47, 0.56), l(2, 'IN 2 — Laptop', 0.51, 0.22, 0.47, 0.56)] },
    { slot: 4, label: 'Lower third', layers: [l(0, 'BG — Gradient', 0, 0, 1, 1), l(1, 'IN 1 — Camera', 0, 0, 1, 1), l(2, 'IN 3 — Graphic', 0.05, 0.72, 0.5, 0.16)] },
    { slot: 5, label: 'Holding slide', layers: [l(0, 'IMG — Holding', 0, 0, 1, 1)] },
    { slot: 12, label: 'Q&A wide', layers: [l(0, 'BG — Blue', 0, 0, 1, 1), l(1, 'IN 1 — Camera', 0.06, 0.1, 0.88, 0.8)] },
  ]
  return new Map(m.map((x) => [x.slot, x]))
}

export interface Push {
  readonly path: string[]
  readonly value: unknown
  /** Milliseconds to wait before sending, so a load looks like a load. */
  readonly after?: number
}

export class SimDevice {
  readonly screens: Screen[]
  readonly screenMemories = seedMemories()
  readonly masterMemories = new Map<number, Memory>()
  readonly layerMemories = new Map<number, Memory>()

  /** Persistent master-store mask, exactly as the real device keeps it. */
  masterFilter = {
    mode: 'SAVE_FROM_PGM',
    screenFilter: [] as string[],
    auxFilter: [] as string[],
    layerFilter: [] as string[],
    categoryFilter: [...CATEGORIES] as string[],
  }

  constructor() {
    // Buffer roles deliberately differ per screen: on real hardware one recall
    // pass landed on A for S1 and B for S2–S4 at the same moment.
    this.screens = [
      { key: 'S1', n: 1, width: 3840, height: 2160, live: 'B', content: { A: empty, B: empty, C: empty }, unmodified: { A: true, B: true, C: true } },
      { key: 'S2', n: 2, width: 1920, height: 1080, live: 'A', content: { A: empty, B: empty, C: empty }, unmodified: { A: true, B: true, C: true } },
      { key: 'S3', n: 3, width: 7680, height: 2160, live: 'A', content: { A: empty, B: empty, C: empty }, unmodified: { A: true, B: true, C: true } },
      { key: 'S4', n: 4, width: 1920, height: 1080, live: 'A', content: { A: empty, B: empty, C: empty }, unmodified: { A: true, B: true, C: true } },
    ]
    // Something on air to begin with, so the first screen is not blank.
    this.load(this.screens[0], this.screens[0].live, 1)
    this.load(this.screens[1], this.screens[1].live, 3)
  }

  screen(key: string): Screen | undefined {
    return this.screens.find((s) => s.key === key)
  }

  /** The buffer a preset mode names right now, which a take swaps. */
  bufferFor(s: Screen, mode: string): Buffer {
    if (mode === 'PROGRAM') return s.live
    return s.live === 'A' ? 'B' : 'A'
  }

  private load(s: Screen, buffer: Buffer, slot: number): boolean {
    const mem = this.screenMemories.get(slot)
    if (!mem) return false
    s.content = { ...s.content, [buffer]: { memory: slot, layers: mem.layers } }
    s.unmodified = { ...s.unmodified, [buffer]: true }
    return true
  }

  /**
   * Apply one write and return what the device would push back.
   *
   * The echo always comes first — a real device echoes every accepted write,
   * whatever it does about it afterwards.
   */
  apply(path: readonly string[], value: unknown): Push[] {
    const p = path.join('/')
    const pushes: Push[] = [{ path: [...path], value }]

    const num = (i: number) => Number(path[i])

    // presetBank/control/load/slotList/items/N/screenList/items/S/presetList/items/MODE/pp/xRequest
    let m = /^device\/presetBank\/control\/load\/slotList\/items\/(\d+)\/screenList\/items\/(S\d+)\/presetList\/items\/(PREVIEW|PROGRAM)\/pp\/xRequest$/.exec(p)
    if (m) {
      const [, slotS, key, mode] = m
      const s = this.screen(key)
      const slot = Number(slotS)
      // The tell: an empty memory produces the echo and nothing else, ever.
      if (!s || !this.screenMemories.has(slot)) return pushes
      const buffer = this.bufferFor(s, mode)
      const base = `device/presetBank/control/load/slotList/items/${slot}/screenList/items/${key}/presetList/items/${mode}/pp`
      const status = `device/presetBank/status/presetId/screenList/items/${key}/presetList/items/${buffer}/pp`
      this.load(s, buffer, slot)
      pushes.push(
        { path: `${base}/isLoading`.split('/'), value: true, after: 40 },
        { path: `${status}/id`.split('/'), value: slot, after: 120 },
        { path: `${status}/isNotModified`.split('/'), value: true, after: 130 },
        { path: `${base}/isLoading`.split('/'), value: false, after: 200 },
      )
      return pushes
    }

    // presetBank/control/save/screenList/items/S/presetList/items/MODE/slotList/items/N/pp/xRequest
    m = /^device\/presetBank\/control\/save\/screenList\/items\/(S\d+)\/presetList\/items\/(PREVIEW|PROGRAM)\/slotList\/items\/(\d+)\/pp\/xRequest$/.exec(p)
    if (m) {
      const [, key, mode, slotS] = m
      const s = this.screen(key)
      if (!s) return pushes
      const slot = Number(slotS)
      const content = s.content[this.bufferFor(s, mode)]
      this.screenMemories.set(slot, {
        slot,
        label: this.screenMemories.get(slot)?.label ?? '',
        layers: content.layers,
      })
      pushes.push({
        path: `device/presetBank/bankList/items/${slot}/status/pp/isValid`.split('/'),
        value: true,
        after: 60,
      })
      return pushes
    }

    // Master and layer stores: recorded so the banks fill up, no visible change.
    m = /^device\/masterPresetBank\/control\/save\/slotList\/items\/(\d+)\/pp\/xRequest$/.exec(p)
    if (m) {
      const slot = Number(m[1])
      this.masterMemories.set(slot, { slot, label: '', layers: [] })
      pushes.push({
        path: `device/masterPresetBank/bankList/items/${slot}/status/pp/isValid`.split('/'),
        value: true,
        after: 60,
      })
      return pushes
    }

    m = /^device\/masterPresetBank\/control\/save\/pp\/(mode|screenFilter|auxFilter|layerFilter|categoryFilter)$/.exec(p)
    if (m) {
      // Filters persist until overwritten, which is why an unfiltered store has
      // to write them wide open rather than leaving them alone.
      ;(this.masterFilter as Record<string, unknown>)[m[1]] = value
      return pushes
    }

    m = /^device\/masterPresetBank\/control\/load\/slotList\/items\/(\d+)\/presetList\/items\/(PREVIEW|PROGRAM)\/pp\/xRequest$/.exec(p)
    if (m) {
      const slot = Number(m[1])
      if (!this.masterMemories.has(slot)) return pushes
      const base = `device/masterPresetBank/control/load/slotList/items/${slot}/presetList/items/${m[2]}/pp`
      pushes.push(
        { path: `${base}/isLoading`.split('/'), value: true, after: 40 },
        { path: `${base}/isLoading`.split('/'), value: false, after: 220 },
      )
      return pushes
    }

    m = /^device\/layerBank\/control\/save\/screenList\/items\/(S\d+)\/presetList\/items\/(PREVIEW|PROGRAM)\/layerList\/items\/(\w+)\/slotList\/items\/(\d+)\/pp\/xRequest$/.exec(p)
    if (m) {
      const slot = Number(m[4])
      this.layerMemories.set(slot, { slot, label: '', layers: [] })
      return pushes
    }

    m = /^device\/layerBank\/control\/load\/slotList\/items\/(\d+)\//.exec(p)
    if (m) {
      const slot = Number(m[1])
      if (!this.layerMemories.has(slot)) return pushes
      const base = p.replace(/\/xRequest$/, '')
      pushes.push(
        { path: `${base}/isLoading`.split('/'), value: true, after: 40 },
        { path: `${base}/isLoading`.split('/'), value: false, after: 200 },
      )
      return pushes
    }

    // screenAuxGroupList/items/S/control/pp/xTake
    m = /^device\/screenAuxGroupList\/items\/(S\d+)\/control\/pp\/xTake$/.exec(p)
    if (m && value === true) {
      const s = this.screen(m[1])
      if (s) s.live = s.live === 'A' ? 'B' : 'A'
      return pushes
    }

    // Labels and deletes, across whichever bank.
    m = /^device\/(presetBank|masterPresetBank|layerBank)\/bankList\/items\/(\d+)\/control\/pp\/(label|xDelete)$/.exec(p)
    if (m) {
      const bank =
        m[1] === 'presetBank' ? this.screenMemories : m[1] === 'masterPresetBank' ? this.masterMemories : this.layerMemories
      const slot = Number(m[2])
      if (m[3] === 'label') {
        const mem = bank.get(slot)
        if (mem) mem.label = String(value ?? '')
      } else if (value === true) {
        bank.delete(slot)
        pushes.push({
          path: `device/${m[1]}/bankList/items/${slot}/status/pp/isValid`.split('/'),
          value: false,
          after: 60,
        })
      }
      return pushes
    }

    void num
    return pushes
  }
}
