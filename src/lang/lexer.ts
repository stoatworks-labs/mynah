/**
 * Tokenizer for the command line.
 *
 * Every token carries its span so the UI can underline the offending word
 * rather than colouring the whole line red.
 *
 * Variables (`$S1.width`, `@gap`) and the arithmetic that combines them
 * (`(`, `)`, `*`, `/`) are tokens here and nothing more. What a variable is
 * worth is the host's to say and the parser's to ask — see `variables.ts`.
 */

import { resolveKeyword, type Keyword } from './keywords.ts'

export type Token =
  | { kind: 'keyword'; keyword: Keyword; text: string; start: number; end: number }
  | { kind: 'number'; value: number; text: string; start: number; end: number }
  /** `50%` — a proportion of the screen canvas, resolved at compile time. */
  | { kind: 'percent'; value: number; text: string; start: number; end: number }
  | { kind: 'string'; value: string; text: string; start: number; end: number }
  | { kind: 'plus'; text: string; start: number; end: number }
  | { kind: 'minus'; text: string; start: number; end: number }
  /**
   * `$S1.width` (a system variable — the host reads it off the device) or
   * `@gap` (a user variable — the operator defined it). `name` is without
   * the sigil and as typed; the host decides how to match it.
   */
  | { kind: 'variable'; sigil: '$' | '@'; name: string; text: string; start: number; end: number }
  | { kind: 'lparen'; text: string; start: number; end: number }
  | { kind: 'rparen'; text: string; start: number; end: number }
  | { kind: 'star'; text: string; start: number; end: number }
  | { kind: 'slash'; text: string; start: number; end: number }
  /**
   * A `%` straight after a variable or a closing bracket — `@third%`,
   * `($S1.width / 40)%`. A literal `50%` is still one `percent` token; this is
   * the same suffix for a value that is only known once it is resolved.
   */
  | { kind: 'pct'; text: string; start: number; end: number }

export interface LexError {
  message: string
  start: number
  end: number
}

export interface LexResult {
  tokens: Token[]
  errors: LexError[]
}

const isWordChar = (c: string) => /[A-Za-z]/.test(c)
const isDigit = (c: string) => /[0-9]/.test(c)

/** The one-character tokens arithmetic adds. `+` and `-` were already tokens. */
const SYMBOLS: Readonly<Record<string, 'lparen' | 'rparen' | 'star' | 'slash'>> = {
  '(': 'lparen',
  ')': 'rparen',
  '*': 'star',
  '/': 'slash',
}

/**
 * The name after a sigil: a letter or underscore, then letters, digits and
 * underscores, in dot-separated segments — `S1.PGM.L2.x`, `gap`, `wall_left`.
 *
 * A segment after a dot may start with a digit (`$OUT1.x` has none, but a
 * host is free to name `$preset.2`). A dot is only part of the name when a
 * name character follows it, so `@gap.` at the end of a sentence is `@gap`.
 * Returns the index just past the name, or `start` when there is no name.
 */
export function readVariableName(input: string, start: number): number {
  const first = /[A-Za-z_]/
  const rest = /[A-Za-z0-9_]/
  if (start >= input.length || !first.test(input[start])) return start
  let i = start + 1
  for (;;) {
    while (i < input.length && rest.test(input[i])) i++
    if (input[i] === '.' && i + 1 < input.length && rest.test(input[i + 1])) {
      i++
      continue
    }
    return i
  }
}

export function lex(input: string): LexResult {
  const tokens: Token[] = []
  const errors: LexError[] = []
  let i = 0

  while (i < input.length) {
    const c = input[i]

    if (c === ' ' || c === '\t') {
      i++
      continue
    }

    if (c === '+') {
      tokens.push({ kind: 'plus', text: '+', start: i, end: i + 1 })
      i++
      continue
    }

    // A minus is only an operator here; there are no negative quantities in
    // the language, so this never has to disambiguate against a sign.
    if (c === '-') {
      tokens.push({ kind: 'minus', text: '-', start: i, end: i + 1 })
      i++
      continue
    }

    if (c === '$' || c === '@') {
      const start = i
      const end = readVariableName(input, i + 1)
      if (end === i + 1) {
        errors.push({
          message: `${c} needs a name after it — ${c === '$' ? '$S1.width' : '@gap'}, say`,
          start,
          end: i + 1,
        })
        i++
        continue
      }
      tokens.push({
        kind: 'variable',
        sigil: c,
        name: input.slice(i + 1, end),
        text: input.slice(start, end),
        start,
        end,
      })
      i = end
      continue
    }

    if (SYMBOLS[c]) {
      tokens.push({ kind: SYMBOLS[c], text: c, start: i, end: i + 1 })
      i++
      continue
    }

    /* A `%` is a suffix, never a token of its own: on a literal it is read
       with the digits below, and here it follows something whose value is
       not known yet. Anywhere else it is still a stray character. */
    if (c === '%') {
      const prev = tokens[tokens.length - 1]
      if (prev && prev.end === i && (prev.kind === 'variable' || prev.kind === 'rparen')) {
        tokens.push({ kind: 'pct', text: '%', start: i, end: i + 1 })
        i++
        continue
      }
    }

    if (c === '"') {
      const start = i
      i++
      let value = ''
      let closed = false
      while (i < input.length) {
        if (input[i] === '"') {
          closed = true
          i++
          break
        }
        value += input[i]
        i++
      }
      const text = input.slice(start, i)
      if (!closed) {
        // Still worth emitting: a label being typed is unterminated for as
        // long as it takes to type it, and the parser should see the token so
        // the preview can show the label taking shape.
        errors.push({ message: 'Unterminated string', start, end: i })
      }
      tokens.push({ kind: 'string', value, text, start, end: i })
      continue
    }

    if (isDigit(c)) {
      const start = i
      while (i < input.length && isDigit(input[i])) i++
      // A decimal point is only part of a number when a digit follows it, so
      // "50." at the end of a sentence is still the number 50.
      if (input[i] === '.' && isDigit(input[i + 1])) {
        i++
        while (i < input.length && isDigit(input[i])) i++
      }
      const digits = input.slice(start, i)
      if (input[i] === '%') {
        i++
        tokens.push({ kind: 'percent', value: Number(digits), text: input.slice(start, i), start, end: i })
        continue
      }
      tokens.push({ kind: 'number', value: Number(digits), text: digits, start, end: i })
      continue
    }

    if (isWordChar(c)) {
      const start = i
      while (i < input.length && isWordChar(input[i])) i++
      const text = input.slice(start, i)
      const res = resolveKeyword(text)
      if (res.ok) {
        tokens.push({ kind: 'keyword', keyword: res.keyword, text, start, end: i })
      } else if (res.reason === 'ambiguous') {
        errors.push({
          message: `"${text}" is ambiguous — ${res.candidates.map((k) => k.word).join(', ')}`,
          start,
          end: i,
        })
      } else {
        errors.push({ message: `Unknown keyword "${text}"`, start, end: i })
      }
      continue
    }

    errors.push({ message: `Unexpected character "${c}"`, start: i, end: i + 1 })
    i++
  }

  return { tokens, errors }
}
