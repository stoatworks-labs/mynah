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

export interface Command {
  readonly fn: FunctionName
  readonly scope: Scope
  readonly memory?: number
  readonly mode?: PresetMode
  readonly label?: string
  readonly filter?: Filter
}

export interface ParseError {
  readonly message: string
  readonly start: number
  readonly end: number
}

export type ParseResult =
  | { readonly ok: true; readonly command: Command }
  | { readonly ok: false; readonly errors: readonly ParseError[] }
