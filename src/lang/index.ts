/**
 * The public surface of the Mynah language.
 *
 * This is the entry point for consumers outside this repo — the Companion
 * module bundles it, so that a command string is compiled by exactly the same
 * parser and compiler the web tool uses rather than by a second, drifting
 * implementation of the grammar.
 *
 * Everything here is pure: no DOM, no network, no React.
 */

export { parse } from './parser.ts'
export { compile } from './compile.ts'
export { KEYWORDS, keywordTable, resolveKeyword, shortestForm, completions } from './keywords.ts'
export { AUDIO, CATEGORIES, DIMS, SLOTS, VERIFIED_FIRMWARE } from './model.ts'
export { Path } from './paths.ts'

/*
 * The other three command languages, and the OSC dictionary.
 *
 * `run()` is what a console should call: it takes a line in any of the four
 * languages and returns the same shape whichever it was. `parse`/`compile`
 * above remain the Mynah-only path, unchanged, for consumers that only ever
 * speak Mynah — the Stream Deck plugin among them.
 */
export {
  run,
  declared,
  sniff,
  oscDictionary,
  parseOsc,
  resolveOsc,
  OSC_ROOT,
  coerce,
  denormalise,
  paramAddress,
  paramId,
  BUILTIN_PARAMS,
  BUILTIN_LAYER_PARAMS,
  BUILTIN_GROUP_PARAMS,
  LANGUAGES,
  LANGUAGE_LABELS,
} from './dialects/index.ts'

export type { AudioAction, AudioCommand, AudioEndpoint, Command, ParseResult } from './ast.ts'
export type { Op, CompileResult, CompileContext, Selection } from './compile.ts'
export type { BankKind, PresetMode, Category, Target } from './model.ts'
export type {
  LanguageChoice,
  LanguageId,
  LineError,
  OscContext,
  OscEntry,
  OscMessage,
  ParamSpec,
  ParamTable,
  Read,
  RunResult,
} from './dialects/index.ts'
export type { RunContext } from './dialects/index.ts'
