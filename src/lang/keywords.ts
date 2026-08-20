/**
 * The keyword table, and prefix abbreviation.
 *
 * grandMA3's rule is that any unambiguous prefix of a keyword is that keyword.
 * Ambiguity is resolved across the whole vocabulary at once, so the short form
 * of a word is a property of the *table*, not of the word — adding `Mask`
 * lengthens `Master` from `Ma` to `Mast`. Shorts are therefore computed here
 * rather than hand-written, because a hand-written table drifts silently the
 * first time a keyword is added.
 */

export type KeywordKind = 'function' | 'object' | 'mode' | 'category' | 'operator' | 'clause'

export interface Keyword {
  readonly word: string
  readonly kind: KeywordKind
}

const kw = (word: string, kind: KeywordKind): Keyword => ({ word, kind })

export const KEYWORDS: readonly Keyword[] = [
  // Functions
  kw('Recall', 'function'),
  kw('Store', 'function'),
  kw('Take', 'function'),
  kw('Delete', 'function'),
  kw('Label', 'function'),
  kw('Select', 'function'),
  kw('Clear', 'function'),

  // Objects
  kw('Screen', 'object'),
  kw('Aux', 'object'),
  kw('Layer', 'object'),
  kw('Master', 'object'),
  kw('Multiviewer', 'object'),
  kw('Memory', 'object'),
  kw('Native', 'object'),

  // Preset modes
  kw('Preview', 'mode'),
  kw('Program', 'mode'),

  // Clause
  kw('If', 'clause'),
  kw('Category', 'clause'),

  // Range operator that is a word rather than a symbol
  kw('Thru', 'operator'),

  // Record-mask categories
  kw('Source', 'category'),
  kw('Position', 'category'),
  kw('Size', 'category'),
  kw('Opacity', 'category'),
  kw('Cropping', 'category'),
  kw('Border', 'category'),
  kw('Transitions', 'category'),
  kw('Effects', 'category'),
  kw('FlyingCurve', 'category'),
  kw('Timing', 'category'),
  kw('Speed', 'category'),
  kw('CutAndFill', 'category'),
  kw('Mask', 'category'),
  kw('Keyer', 'category'),
]

const BY_WORD = new Map(KEYWORDS.map((k) => [k.word.toLowerCase(), k]))

/**
 * The shortest prefix that resolves to this keyword and nothing else.
 *
 * When one keyword is a prefix of another — `Mask` inside no other word, but
 * `Mas` shared with `Master` — the shorter word has no abbreviation at all and
 * must be typed in full. That is reported honestly as the whole word rather
 * than as a prefix that would resolve to its neighbour.
 */
export function shortestForm(word: string): string {
  const lower = word.toLowerCase()
  for (let i = 1; i < lower.length; i++) {
    const prefix = lower.slice(0, i)
    const hits = KEYWORDS.filter((k) => k.word.toLowerCase().startsWith(prefix))
    if (hits.length === 1 && hits[0].word.toLowerCase() === lower) {
      return word.slice(0, i)
    }
  }
  return word
}

/** Every keyword with its computed short form, for docs and the help panel. */
export function keywordTable(): readonly { keyword: Keyword; short: string }[] {
  return KEYWORDS.map((keyword) => ({ keyword, short: shortestForm(keyword.word) }))
}

export type Resolution =
  | { ok: true; keyword: Keyword }
  | { ok: false; reason: 'unknown' }
  | { ok: false; reason: 'ambiguous'; candidates: readonly Keyword[] }

/**
 * Resolve a typed word to a keyword.
 *
 * An exact match always wins, even when the word is also a prefix of something
 * longer — otherwise `Mask` could never be typed at all while `Master` exists.
 * Failing that, a prefix matching exactly one keyword resolves to it. A prefix
 * matching several is reported as ambiguous *with its candidates*, because
 * "unknown keyword" would be a lie and the operator needs to know which extra
 * letter to type.
 */
export function resolveKeyword(word: string): Resolution {
  const lower = word.toLowerCase()

  const exact = BY_WORD.get(lower)
  if (exact) return { ok: true, keyword: exact }

  const hits = KEYWORDS.filter((k) => k.word.toLowerCase().startsWith(lower))
  if (hits.length === 1) return { ok: true, keyword: hits[0] }
  if (hits.length > 1) return { ok: false, reason: 'ambiguous', candidates: hits }
  return { ok: false, reason: 'unknown' }
}

/** Every keyword a partial word could still become, for live completion. */
export function completions(partial: string): readonly Keyword[] {
  if (partial === '') return KEYWORDS
  const lower = partial.toLowerCase()
  return KEYWORDS.filter((k) => k.word.toLowerCase().startsWith(lower))
}
