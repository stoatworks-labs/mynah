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

export type KeywordKind =
  | 'function'
  | 'object'
  | 'mode'
  | 'category'
  | 'operator'
  | 'clause'
  | 'attribute'

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
  kw('Set', 'function'),

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

  // Live layer attributes, and — inside an If clause — record-mask categories.
  kw('Source', 'attribute'),
  kw('Position', 'attribute'),
  kw('Size', 'attribute'),
  kw('Opacity', 'attribute'),

  // Source families, for anything that is not a live input
  kw('Still', 'object'),
  kw('None', 'object'),
  kw('Colour', 'object'),

  // Audio routing. `Audio` introduces a sub-grammar of its own after `Set`.
  //
  // ⚠️ Adding `Audio` lengthens `Aux` from `Au` to `Aux`, because the short
  // form of a word is a property of the whole table and the two now share a
  // prefix. That is the documented cost of prefix abbreviation, and it is
  // worth paying: audio routing is a whole half of the device that the command
  // line could not reach at all.
  kw('Audio', 'object'),
  kw('Patch', 'attribute'),
  kw('Mute', 'attribute'),
  kw('Unmute', 'attribute'),
  kw('Input', 'object'),
  kw('Output', 'object'),
  kw('Dante', 'object'),
  kw('Channel', 'object'),

  // Clause
  kw('If', 'clause'),
  kw('Category', 'clause'),

  // Range operator that is a word rather than a symbol
  kw('Thru', 'operator'),
  // Assignment, borrowed from grandMA3 and Titan. Optional noise before a
  // value, so both "Set … Source 1" and "… Source At 1" read naturally.
  kw('At', 'operator'),
  // `To` is the same operator, spelled the way a patch reads out loud:
  // "Patch Input 1 Channel 1 To Dante 1". Both are accepted everywhere.
  kw('To', 'operator'),

  // Record-mask categories. Source, Position, Size and Opacity are NOT repeated
  // here: they are declared once above as attributes, and the parser reads them
  // as categories when they appear inside an If clause. A keyword may only
  // appear once in this table, or it has no abbreviation and resolves to
  // whichever copy comes first.
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
