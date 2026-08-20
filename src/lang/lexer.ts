/**
 * Tokenizer for the command line.
 *
 * Every token carries its span so the UI can underline the offending word
 * rather than colouring the whole line red.
 */

import { resolveKeyword, type Keyword } from './keywords.ts'

export type Token =
  | { kind: 'keyword'; keyword: Keyword; text: string; start: number; end: number }
  | { kind: 'number'; value: number; text: string; start: number; end: number }
  | { kind: 'string'; value: string; text: string; start: number; end: number }
  | { kind: 'plus'; text: string; start: number; end: number }
  | { kind: 'minus'; text: string; start: number; end: number }

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
      const text = input.slice(start, i)
      tokens.push({ kind: 'number', value: Number(text), text, start, end: i })
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
