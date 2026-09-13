/** The shape a parsed command line takes before it is compiled to device ops. */

import type { Category, PresetMode } from './model.ts'

/**
 * A resolved set of numbers, plus the spans that produced it.
 *
 * Ranges are resolved eagerly at parse time rather than carried as an
 * expression tree: `1 Thru 8 - 5` is eight numbers minus one, and no later
 * stage benefits from knowing how it was written.
 */
export interface NumberSet {
  readonly values: readonly number[]
  /** True if the range was left open, e.g. `1 Thru`, and clamped to the max. */
  readonly openEnded: boolean
}

export type FunctionName =
  | 'Recall'
  | 'Store'
  | 'Take'
  | 'Delete'
  | 'Label'
  | 'Select'
  | 'Clear'
  | 'Set'

/** A number the operator typed, and whether they meant it as a proportion. */
export interface Amount {
  readonly value: number
  readonly percent: boolean
}

/** What a `Set` is assigning. */
export interface Assignment {
  readonly source?: { readonly family: 'live' | 'still' | 'none' | 'colour'; readonly n?: number }
  /** Horizontal then vertical. A single value given means both axes. */
  readonly size?: readonly Amount[]
  readonly position?: readonly Amount[]
  readonly opacity?: Amount
}

/** The screens and auxes a command addresses, before defaults are applied. */
export interface Scope {
  readonly screens?: NumberSet
  readonly auxes?: NumberSet
  readonly layers?: { readonly native: boolean; readonly numbers: NumberSet }
  readonly multiviewers?: NumberSet
  readonly master?: boolean
}

/** The `If` clause: a record mask on a store. */
export interface Filter {
  readonly screens?: NumberSet
  readonly auxes?: NumberSet
  readonly layers?: { readonly native: boolean; readonly numbers: NumberSet }
  readonly categories?: readonly Category[]
}

/** What a `Set Audio` is doing. `FOLLOW` exists only on a routing platform. */
export type AudioAction = 'PATCH' | 'MUTE' | 'UNMUTE' | 'FOLLOW'

/**
 * One end of an audio route.
 *
 * On LivePremier's matrix: `unit` is the input, output or multiviewer number
 * — or, for Dante, the flat channel number, because Dante has no unit an
 * operator thinks in — and `channels` is the channel within a unit,
 * meaningless for Dante and `None`.
 *
 * On a routing platform (Midra 4K / Alta 4K) the same shape carries the
 * other vocabulary: a source is an `input`, a `dante` *group* (`Dante 1 Thru
 * 8`, `Dante Group 1`), a `lineIn`, the media `Player`, a `custom` mix or
 * `none`; a destination is a `screen` or `aux` (its preset's audio layer), an
 * `output`, a `lineOut`, a `dante` group or the `multiviewer`. `channels`
 * only ever qualifies a mute there.
 */
export interface AudioEndpoint {
  readonly kind:
    | 'input' | 'output' | 'dante' | 'multiviewer' | 'none'
    | 'screen' | 'aux' | 'lineIn' | 'lineOut' | 'media' | 'custom'
  readonly unit?: NumberSet
  readonly channels?: NumberSet
}

/**
 * What a routing point is told to follow instead of a fixed source.
 *
 * `layer` — the content of live layer `n` (a screen); `audioLayer` — the
 * preset's own audio layer (a screen or aux); `content` — the aux's video
 * content; `screen` — a screen's audio, numbered for a line out or Dante
 * group and unnumbered for a video output, which follows the screen it
 * shows; `widget` — a multiviewer widget.
 */
export interface AudioFollow {
  readonly what: 'layer' | 'audioLayer' | 'content' | 'screen' | 'widget'
  readonly n?: number
}

export interface AudioCommand {
  readonly action: AudioAction
  /** The source being patched. Absent on a mute or a follow. */
  readonly from?: AudioEndpoint
  /** The destination being patched or told what to follow, or the thing being muted. */
  readonly to?: AudioEndpoint
  /** Present on a FOLLOW. */
  readonly follow?: AudioFollow
}

export interface Command {
  readonly fn: FunctionName
  readonly scope: Scope
  readonly memory?: number
  readonly mode?: PresetMode
  readonly label?: string
  readonly filter?: Filter
  readonly set?: Assignment
  readonly audio?: AudioCommand
}

export interface ParseError {
  readonly message: string
  readonly start: number
  readonly end: number
}

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly errors: readonly ParseError[] }
