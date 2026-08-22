/**
 * What every command language in this app has in common.
 *
 * Mynah's own grammar is one of four languages the command line accepts. The
 * other three — AWJ, raw store JSON and OSC — are not grammars so much as
 * spellings of a device write, and the point of this module is that the
 * console never learns which is which: it hands a line to `run()` and gets
 * back the same shape whatever the line turned out to be.
 *
 * ## Ops, and why reads are separate
 *
 * A Mynah command is always a write. AWJ is not — `{"op":"get",…}` is a read,
 * and a read is not an op with a missing value. Sending one as a write would
 * put `undefined` on the wire at a path an operator only wanted to look at,
 * which on a live frame is the difference between a question and an accident.
 * So reads come back in their own list and a transport that cannot perform
 * them says so rather than quietly doing something else.
 */

import type { FunctionName } from '../ast.ts'
import type { Op, Selection } from '../compile.ts'
import type { BankKind } from '../model.ts'
import type { Path } from '../paths.ts'

/** The languages the command line understands. */
export type LanguageId = 'mynah' | 'awj' | 'json' | 'osc'

/**
 * What the operator has chosen in settings.
 *
 * `all` is the default and means "work it out": a line may declare its own
 * language with a leading word, and is sniffed when it does not. Picking a
 * single language turns detection off entirely, which is what an operator
 * pasting machine-generated JSON wants — a payload that happens to look like
 * something else should be an error, not a surprise.
 */
export type LanguageChoice = LanguageId | 'all'

export const LANGUAGES: readonly LanguageId[] = ['mynah', 'awj', 'json', 'osc']

export const LANGUAGE_LABELS: Readonly<Record<LanguageId, string>> = {
  mynah: 'Mynah',
  awj: 'AWJ',
  json: 'JSON',
  osc: 'OSC',
}

/** A property the line asked to look at rather than change. */
export interface Read {
  readonly path: Path
  /** One line of plain English, shown the same way an op's is. */
  readonly describe: string
}

export interface LineError {
  readonly message: string
  /** Where in the line, when the language can say. */
  readonly start?: number
  readonly end?: number
}

export type RunResult =
  | {
      readonly ok: true
      readonly language: LanguageId
      /** True when a leading `AWJ`/`JSON`/`OSC`/`MYNAH` named the language. */
      readonly declared: boolean
      readonly ops: readonly Op[]
      readonly reads: readonly Read[]
      readonly summary: string
      readonly selection?: Selection
      readonly bank?: BankKind
      readonly slot?: number
      /**
       * The Mynah verb, when the line was Mynah.
       *
       * A console has two rules that key on the verb rather than on the ops —
       * `Clear` empties the command line before it empties the scope, and a
       * `Recall` is the one command worth checking for an empty memory slot
       * beforehand. Both are policy about the native grammar and neither has
       * a counterpart in a raw language, so this is absent for the other
       * three rather than faked.
       */
      readonly fn?: FunctionName
    }
  | {
      readonly ok: false
      readonly language: LanguageId
      readonly declared: boolean
      readonly errors: readonly LineError[]
    }

/** A line with any language prefix taken off it. */
export interface Declared {
  readonly language: LanguageId | null
  readonly body: string
  /** Offset of `body` within the original line, so spans stay honest. */
  readonly offset: number
}
