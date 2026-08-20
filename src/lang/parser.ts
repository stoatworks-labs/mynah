/**
 * Parser: tokens to a `Command`.
 *
 * Recursive descent, one pass, no backtracking — the grammar is verb-first and
 * every object announces itself with a keyword, so a single token of lookahead
 * is always enough.
 *
 * The parser resolves ranges but applies no defaults. Deciding that an omitted
 * preset mode means Preview on a recall and Program on a store is a policy
 * question, and policy lives in the compiler where it can be stated once.
 */

import type { Command, Filter, FunctionName, NumberSet, ParseError, ParseResult, Scope } from './ast.ts'
import { CATEGORIES, DIMS, type Category } from './model.ts'
import { lex, type Token } from './lexer.ts'

const CATEGORY_BY_KEYWORD: Record<string, Category> = {
  Source: 'SOURCE',
  Position: 'POS',
  Size: 'SIZE',
  Opacity: 'OPACITY',
  Cropping: 'CROPPING',
  Border: 'BORDER',
  Transitions: 'TRANSITIONS',
  Effects: 'EFFECTS',
  FlyingCurve: 'FLYING_CURVE',
  Timing: 'TIMING',
  Speed: 'SPEED',
  CutAndFill: 'CUT_AND_FILL',
  Mask: 'MASK',
  Keyer: 'KEYER',
}

const FUNCTIONS: readonly string[] = [
  'Recall',
  'Store',
  'Take',
  'Delete',
  'Label',
  'Select',
  'Clear',
]

class Parser {
  private pos = 0
  readonly errors: ParseError[] = []

  constructor(
    private readonly tokens: readonly Token[],
    private readonly inputLength: number,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  private atEnd(): boolean {
    return this.pos >= this.tokens.length
  }

  private error(message: string, tok?: Token): void {
    const start = tok?.start ?? this.inputLength
    const end = tok?.end ?? this.inputLength
    this.errors.push({ message, start, end })
  }

  /** True if the next token is this keyword, without consuming it. */
  private atKeyword(word: string): boolean {
    const t = this.peek()
    return t?.kind === 'keyword' && t.keyword.word === word
  }

  private eatKeyword(word: string): boolean {
    if (this.atKeyword(word)) {
      this.pos++
      return true
    }
    return false
  }

  // -------------------------------------------------------------------------
  // Ranges
  // -------------------------------------------------------------------------

  /**
   * `range = term { ("+" | "-") term }`, where a term is a number, a closed
   * `a Thru b`, an open `a Thru`, or a leading `Thru b`.
   *
   * `+` unions and `-` subtracts, both binding left to right, so a `-` removes
   * from everything accumulated so far — which is what makes
   * `1 Thru 8 - 5 + 5` put S5 back rather than being a contradiction.
   */
  private parseRange(min: number, max: number, what: string): NumberSet | undefined {
    let values: number[] = []
    let openEnded = false

    const term = (): number[] | undefined => {
      // Leading `Thru`: from the dimension's floor.
      if (this.eatKeyword('Thru')) {
        const to = this.peek()
        if (to?.kind !== 'number') {
          this.error(`Expected a ${what} number after Thru`, to)
          return undefined
        }
        this.pos++
        openEnded = true
        return span(min, to.value)
      }

      const from = this.peek()
      if (from?.kind !== 'number') {
        this.error(`Expected a ${what} number`, from)
        return undefined
      }
      this.pos++

      if (this.eatKeyword('Thru')) {
        const to = this.peek()
        if (to?.kind === 'number') {
          this.pos++
          return span(from.value, to.value)
        }
        // Open-ended `1 Thru` runs to the top of the dimension.
        openEnded = true
        return span(from.value, max)
      }

      return [from.value]
    }

    const span = (a: number, b: number): number[] => {
      const lo = Math.min(a, b)
      const hi = Math.max(a, b)
      const out: number[] = []
      for (let n = lo; n <= hi; n++) out.push(n)
      return out
    }

    const first = term()
    if (!first) return undefined
    values = first

    for (;;) {
      const t = this.peek()
      if (t?.kind === 'plus') {
        this.pos++
        const more = term()
        if (!more) return undefined
        for (const n of more) if (!values.includes(n)) values.push(n)
        continue
      }
      if (t?.kind === 'minus') {
        this.pos++
        const less = term()
        if (!less) return undefined
        values = values.filter((n) => !less.includes(n))
        continue
      }
      break
    }

    // Range checking happens here, once, rather than at every use site. An
    // out-of-range member is an error even when the rest of the range is fine:
    // silently dropping S25 from `1 Thru 25` would execute a command the
    // operator did not type.
    const bad = values.filter((n) => n < min || n > max)
    if (bad.length > 0) {
      this.error(
        `${what} ${bad.join(', ')} out of range — valid range is ${min} to ${max}`,
        this.tokens[this.pos - 1],
      )
      return undefined
    }

    values.sort((a, b) => a - b)
    return { values, openEnded }
  }

  // -------------------------------------------------------------------------
  // Objects
  // -------------------------------------------------------------------------

  /** Layers are a range plus the out-of-band `Native` background layer. */
  private parseLayerRange(): { native: boolean; numbers: NumberSet } | undefined {
    if (this.eatKeyword('Native')) {
      return { native: true, numbers: { values: [], openEnded: false } }
    }
    const numbers = this.parseRange(DIMS.layer.min, DIMS.layer.max, 'Layer')
    if (!numbers) return undefined
    return { native: false, numbers }
  }

  private parseScopeInto(scope: Mutable<Scope>): boolean {
    if (this.eatKeyword('Screen')) {
      const r = this.parseRange(DIMS.screen.min, DIMS.screen.max, 'Screen')
      if (!r) return false
      scope.screens = r
      return true
    }
    if (this.eatKeyword('Aux')) {
      const r = this.parseRange(DIMS.aux.min, DIMS.aux.max, 'Aux')
      if (!r) return false
      scope.auxes = r
      return true
    }
    if (this.eatKeyword('Layer')) {
      const r = this.parseLayerRange()
      if (!r) return false
      scope.layers = r
      return true
    }
    if (this.eatKeyword('Multiviewer')) {
      const r = this.parseRange(DIMS.multiviewer.min, DIMS.multiviewer.max, 'Multiviewer')
      if (!r) return false
      scope.multiviewers = r
      return true
    }
    // `Master` is handled in parseCommand: alone among the objects it has no
    // instance number, so a number after it is the memory slot.
    return false
  }

  // -------------------------------------------------------------------------
  // If clause
  // -------------------------------------------------------------------------

  private parseCategories(): readonly Category[] | undefined {
    const out: Category[] = []
    for (;;) {
      const t = this.peek()
      if (t?.kind !== 'keyword' || t.keyword.kind !== 'category') {
        if (out.length === 0) {
          this.error(
            `Expected a category — one of ${CATEGORIES.length} record-mask categories`,
            t,
          )
          return undefined
        }
        break
      }
      this.pos++
      const cat = CATEGORY_BY_KEYWORD[t.keyword.word]
      if (cat && !out.includes(cat)) out.push(cat)

      // Categories are a set, so `+` between them is decoration. Accepting it
      // keeps the language consistent with every other list.
      if (this.peek()?.kind === 'plus') {
        this.pos++
        continue
      }
      break
    }
    return out
  }

  private parseFilter(): Filter | undefined {
    const filter: Mutable<Filter> = {}
    let any = false

    for (;;) {
      if (this.eatKeyword('Screen')) {
        const r = this.parseRange(DIMS.screen.min, DIMS.screen.max, 'Screen')
        if (!r) return undefined
        filter.screens = r
        any = true
        continue
      }
      if (this.eatKeyword('Aux')) {
        const r = this.parseRange(DIMS.aux.min, DIMS.aux.max, 'Aux')
        if (!r) return undefined
        filter.auxes = r
        any = true
        continue
      }
      if (this.eatKeyword('Layer')) {
        const r = this.parseLayerRange()
        if (!r) return undefined
        filter.layers = r
        any = true
        continue
      }
      if (this.eatKeyword('Category')) {
        const c = this.parseCategories()
        if (!c) return undefined
        filter.categories = c
        any = true
        continue
      }
      break
    }

    if (!any) {
      this.error('If needs at least one filter — Screen, Aux, Layer or Category', this.peek())
      return undefined
    }
    return filter
  }

  // -------------------------------------------------------------------------
  // Command
  // -------------------------------------------------------------------------

  parseCommand(): Command | undefined {
    const head = this.next()
    if (!head) {
      this.error('Empty command')
      return undefined
    }
    if (head.kind !== 'keyword' || !FUNCTIONS.includes(head.keyword.word)) {
      this.error(
        `A command starts with a function — ${FUNCTIONS.join(', ')}`,
        head,
      )
      return undefined
    }
    const fn = head.keyword.word as FunctionName

    const scope: Mutable<Scope> = {}
    let memory: number | undefined
    let mode: Command['mode']
    let label: string | undefined
    let filter: Filter | undefined

    while (!this.atEnd()) {
      if (this.atKeyword('If')) {
        this.pos++
        filter = this.parseFilter()
        if (!filter) return undefined
        continue
      }

      // `Master` has no instance number of its own, so a number following it
      // is the memory slot: `Store Master 12` is `Store Master Memory 12`.
      // Every other object owns its number, so none of them may do this.
      if (this.eatKeyword('Master')) {
        scope.master = true
        const t = this.peek()
        if (t?.kind === 'number') {
          this.pos++
          memory = t.value
        }
        continue
      }

      if (this.eatKeyword('Memory')) {
        const t = this.peek()
        if (t?.kind !== 'number') {
          this.error('Expected a memory number', t)
          return undefined
        }
        this.pos++
        memory = t.value
        continue
      }

      if (this.eatKeyword('Preview')) {
        mode = 'PREVIEW'
        continue
      }
      if (this.eatKeyword('Program')) {
        mode = 'PROGRAM'
        continue
      }

      const t = this.peek()
      if (t?.kind === 'string') {
        this.pos++
        label = t.value
        continue
      }

      if (this.parseScopeInto(scope)) continue

      this.error(`Unexpected ${describe(t)} here`, t)
      return undefined
    }

    return { fn, scope, memory, mode, label, filter }
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function describe(t: Token | undefined): string {
  if (!t) return 'end of command'
  switch (t.kind) {
    case 'keyword':
      return `keyword "${t.keyword.word}"`
    case 'number':
      return `number ${t.value}`
    case 'string':
      return 'text'
    case 'plus':
      return '"+"'
    case 'minus':
      return '"-"'
  }
}

export function parse(input: string): ParseResult {
  const { tokens, errors: lexErrors } = lex(input)
  if (lexErrors.length > 0) {
    return { ok: false, errors: lexErrors }
  }

  const parser = new Parser(tokens, input.length)
  const command = parser.parseCommand()
  if (!command || parser.errors.length > 0) {
    return {
      ok: false,
      errors: parser.errors.length > 0 ? parser.errors : [{ message: 'Invalid command', start: 0, end: input.length }],
    }
  }
  return { ok: true, command }
}
