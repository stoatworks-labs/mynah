/**
 * Which language a line is written in.
 *
 * Two mechanisms, in this order, and the order is the whole design:
 *
 *  1. **A declared prefix wins.** `AWJ {"op":"replace",…}` is AWJ because it
 *     says so. Nothing is guessed about a line that has told you.
 *  2. **Otherwise sniff it**, using only the first non-blank character and a
 *     couple of unmistakable shapes.
 *
 * ## Why the four prefixes are safe
 *
 * `AWJ`, `JSON`, `OSC` and `MYNAH` are not keywords in Mynah's grammar and
 * must never become them — `dialects.test.ts` asserts it against the live
 * keyword table, because the day one of them is added is the day
 * `Osc Screen 1` stops meaning what it says. That test has already earned its
 * keep once: `STORE` was briefly an alias for `JSON` here, which quietly
 * turned every `Store Master 12` into a JSON parse error.
 *
 * A prefix is only taken as a prefix when something follows it, so a bare
 * `OSC` on its own line is an ordinary parse error in whatever language is
 * selected rather than an empty OSC command.
 *
 * ## Why sniffing is this conservative
 *
 * Every rule below keys on a character that cannot begin a Mynah command:
 * `/`, `{`, `[`. Mynah commands begin with a verb or an object, always a
 * letter. So the fallback is Mynah, and a line that is *nearly* valid Mynah
 * gets Mynah's error message rather than JSON's — which is the one an operator
 * who mistyped `Recal` needs to read.
 */

import type { Declared, LanguageId } from './types.ts'

const PREFIXES: ReadonlyArray<readonly [RegExp, LanguageId]> = [
  [/^mynah$/i, 'mynah'],
  [/^awj$/i, 'awj'],
  [/^json$/i, 'json'],
  [/^osc$/i, 'osc'],
]

/**
 * Split a declared language off the front of a line.
 *
 * Only the four language names. `STORE` was offered as an alias for `JSON`
 * for about ten minutes, because that is what the payload is called elsewhere
 * in this codebase — and `Store Master 12` promptly stopped being a Mynah
 * command, silently, because `Store` is a verb. The prefix set has to stay
 * disjoint from the vocabulary, and the smallest set that can be is the one
 * with no aliases in it at all.
 */
export function declared(line: string): Declared {
  const m = /^(\s*)([A-Za-z]+)(\s+)(?=\S)/.exec(line)
  if (!m) return { language: null, body: line, offset: 0 }
  for (const [re, id] of PREFIXES) {
    if (re.test(m[2])) {
      return { language: id, body: line.slice(m[0].length), offset: m[0].length }
    }
  }
  return { language: null, body: line, offset: 0 }
}

/**
 * Guess the language of a line that did not declare one.
 *
 * Never returns null: an unrecognised shape is Mynah's problem to report,
 * because Mynah is the language an operator is typing when they are not
 * deliberately typing one of the others.
 */
export function sniff(body: string): LanguageId {
  const text = body.trim()
  if (text === '') return 'mynah'

  /* An OSC address is the only thing here that starts with a slash. */
  if (text.startsWith('/')) return 'osc'

  /* Both JSON-shaped languages start with a brace or a bracket. Telling them
     apart needs the content: AWJ messages carry an `op`, and their paths are
     slash-joined strings rooted at DeviceObject, where the store's are arrays
     rooted at "device". Checked by substring rather than by parsing, so a
     half-typed object still gets the right error message. */
  if (text.startsWith('{') || text.startsWith('[')) {
    if (/"op"\s*:/.test(text)) return 'awj'
    if (/"path"\s*:\s*"(?:DeviceObject)?\/?\$?[A-Za-z]/.test(text)) return 'awj'
    return 'json'
  }

  /* AWJ's shorthand, and a bare AWJ path with an assignment. */
  if (/^(replace|get)\s+/i.test(text)) return 'awj'
  if (/^DeviceObject(\/|$)/.test(text)) return 'awj'
  if (text.includes('@props/') || text.includes('@items/')) return 'awj'

  return 'mynah'
}
