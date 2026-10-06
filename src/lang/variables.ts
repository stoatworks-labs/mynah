/**
 * Variables, and the arithmetic that combines them.
 *
 * ```text
 * Set Screen 1 Layer 2 Size ($S1.width / 2) $S1.height
 * Set Screen 1 Layer 2 Position (@gap * 3) 540
 * Recall Screen 1 Thru @screens Memory @opener
 * ```
 *
 * Two sigils, two owners:
 *
 * - **`$name` is a system variable** — something the host reads off the
 *   switcher: a canvas width, an input's rate, where a layer sits in program.
 *   Read-only, and only a host holding the device's state can answer it.
 * - **`@name` is a user variable** — something the operator defined: a gap,
 *   a column count, half a canvas.
 *
 * **This module knows no variable.** It has no table of names and no device
 * model; it asks the host's `Variables` and reports what it is told. Which
 * names exist, how they are matched (case, dots), and what each is worth is
 * the host's business, because it is the host that has the store.
 *
 * ## Where arithmetic is allowed, and why only there
 *
 * Outside brackets `+` and `-` already mean something: `1 Thru 8 - 5` is a
 * list of seven screens, and a `-` before a value is its sign. Giving the same
 * characters a second meaning in the same place would make `Screen 4 - 1`
 * mean screen 3 to one reader and screens 4-but-not-1 to another. So a sum
 * lives in brackets, `(4 - 1)`, and a bare variable stands on its own — the
 * same two things may appear wherever a number may.
 *
 * ## The rules, which LivePremier Plus's `core/expr.js` keeps too
 *
 * No `eval`, no `new Function`: a hand-written recursive-descent reader over
 * a closed set of tokens, which cannot reach anything outside itself. `+ - * /`
 * with the usual precedence, unary signs, brackets nested to a fixed depth.
 * **Division by zero is refused**, because `Infinity` survives a clamp and
 * arrives at the device as the parameter's maximum — a plausible wrong number
 * on air. A non-finite result is refused for the same reason. There is no `%`
 * operator (in a layout tool it reads as "percent" as often as "modulo"), no
 * `^`, and no scientific notation.
 *
 * A variable that the host does not know, that is text rather than a number,
 * or that the host refuses (a role mid-take, a store not loaded) is an error
 * naming the variable — never a zero, and never a guess.
 */

import { lex, type Token } from './lexer.ts'

/** `$` names what the host reads off the device; `@` what the operator defined. */
export type VariableKind = 'system' | 'user'

/** What a host answers for one name. */
export type VariableAnswer =
  | { readonly ok: true; readonly value: number | string }
  | { readonly ok: false; readonly error: string }

/**
 * Where variables come from — supplied by the host, like `DeviceFacts`.
 *
 * `resolve` gets the name without its sigil, exactly as typed, and answers
 * `undefined` for a name it has never heard of. An answer of `{ ok: false }`
 * is a name it knows and cannot give a value for right now; its sentence is
 * shown to the operator, so it should say why.
 */
export interface Variables {
  resolve(name: string, kind: VariableKind): VariableAnswer | undefined
}

/** The parentheses an expression may nest. Bounds the reader's recursion. */
export const MAX_DEPTH = 24

/** A failure inside an expression, with the span the operator should look at. */
export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly start: number,
    readonly end: number,
  ) {
    super(message)
  }
}

const kindOf = (sigil: '$' | '@'): VariableKind => (sigil === '$' ? 'system' : 'user')

/**
 * The value of one variable token, as a number, or an error naming it.
 *
 * Exported for the OSC dialect, which reads an argument as a whole
 * expression rather than as part of a command.
 */
export function variableValue(tok: Extract<Token, { kind: 'variable' }>, vars: Variables | undefined): number {
  if (!vars) {
    throw new ExpressionError(
      `Variables need a host that knows them — nothing here can say what ${tok.text} is`,
      tok.start,
      tok.end,
    )
  }
  const answer = vars.resolve(tok.name, kindOf(tok.sigil))
  if (answer === undefined || answer === null) {
    throw new ExpressionError(`Unknown variable ${tok.text}`, tok.start, tok.end)
  }
  if (!answer.ok) {
    throw new ExpressionError(`${tok.text}: ${answer.error}`, tok.start, tok.end)
  }
  if (typeof answer.value === 'string') {
    throw new ExpressionError(
      `${tok.text} is text ("${answer.value}"), not a number`,
      tok.start,
      tok.end,
    )
  }
  if (typeof answer.value !== 'number' || !Number.isFinite(answer.value)) {
    throw new ExpressionError(`${tok.text} is not a finite number`, tok.start, tok.end)
  }
  return answer.value
}

/**
 * Reads arithmetic off a token list, from a position, and says where it stopped.
 *
 *   expr    := term (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := ('+' | '-') factor | primary
 *   primary := number | variable | '(' expr ')'
 *
 * The command parser asks for one `primary` where it wants a number, so a
 * sum outside brackets is never read as one — see the head of this file.
 */
export class ExpressionReader {
  private depth = 0

  constructor(
    private readonly tokens: readonly Token[],
    public pos: number,
    private readonly vars: Variables | undefined,
    /** Where the line ends, for an error at "end of command". */
    private readonly inputLength: number,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private fail(message: string, tok: Token | undefined): never {
    throw new ExpressionError(message, tok?.start ?? this.inputLength, tok?.end ?? this.inputLength)
  }

  /** A whole sum: what a bracket holds, or an OSC argument. */
  expr(): number {
    if (++this.depth > MAX_DEPTH) this.fail('Brackets nested too deeply', this.peek())
    let left = this.term()
    for (;;) {
      const t = this.peek()
      if (t?.kind !== 'plus' && t?.kind !== 'minus') break
      this.pos++
      const right = this.term()
      left = t.kind === 'plus' ? left + right : left - right
    }
    this.depth--
    return left
  }

  private term(): number {
    let left = this.factor()
    for (;;) {
      const t = this.peek()
      if (t?.kind !== 'star' && t?.kind !== 'slash') break
      this.pos++
      const at = this.peek()
      const right = this.factor()
      if (t.kind === 'star') {
        left *= right
      } else {
        /* Infinity would survive to a clamp and land as a maximum. */
        if (right === 0) this.fail('Division by zero', at)
        left /= right
      }
    }
    return left
  }

  private factor(): number {
    const t = this.peek()
    if (t?.kind === 'minus') {
      this.pos++
      return -this.factor()
    }
    if (t?.kind === 'plus') {
      this.pos++
      return this.factor()
    }
    return this.primary()
  }

  /** One value: a number, a variable, or a bracketed sum. */
  primary(): number {
    const t = this.peek()
    if (t?.kind === 'number') {
      this.pos++
      return t.value
    }
    if (t?.kind === 'variable') {
      this.pos++
      return variableValue(t, this.vars)
    }
    if (t?.kind === 'lparen') {
      this.pos++
      const value = this.expr()
      const close = this.peek()
      if (close?.kind !== 'rparen') {
        if (close) this.fail('Expected ")" here', close)
        this.fail('Unclosed bracket', t)
      }
      this.pos++
      if (!Number.isFinite(value)) this.fail('Not a finite number', t)
      return value
    }
    if (t?.kind === 'percent') {
      this.fail('A percentage cannot go inside brackets — put the % after the closing bracket', t)
    }
    this.fail('Expected a number, a variable or a bracket', t)
  }
}

/** The outcome of evaluating a whole string. */
export type EvaluateResult =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string; readonly start?: number; readonly end?: number }

/**
 * Evaluate a string that is nothing but arithmetic — `$S1.width / 2`, `@gap*3`.
 *
 * For a value standing on its own, where there is no list for `+` and `-` to
 * mean, so the sum needs no brackets: an OSC argument, a host's own field.
 * Words are not allowed; a keyword here is an error, not a command.
 */
export function evaluateExpression(text: string, vars?: Variables): EvaluateResult {
  const { tokens, errors } = lex(text)
  if (errors.length > 0) {
    const e = errors[0]
    return { ok: false, error: e.message, start: e.start, end: e.end }
  }
  if (tokens.length === 0) return { ok: false, error: 'Empty expression' }
  const reader = new ExpressionReader(tokens, 0, vars, text.length)
  try {
    const value = reader.expr()
    const extra = tokens[reader.pos]
    if (extra) {
      throw new ExpressionError(`Unexpected "${extra.text}" in arithmetic`, extra.start, extra.end)
    }
    if (!Number.isFinite(value)) return { ok: false, error: 'Not a finite number' }
    return { ok: true, value }
  } catch (err) {
    if (err instanceof ExpressionError) return { ok: false, error: err.message, start: err.start, end: err.end }
    throw err
  }
}
