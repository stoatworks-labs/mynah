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
export { CATEGORIES, DIMS, SLOTS, VERIFIED_FIRMWARE } from './model.ts'
export { Path } from './paths.ts'

export type { Command, ParseResult } from './ast.ts'
export type { Op, CompileResult, CompileContext, Selection } from './compile.ts'
export type { BankKind, PresetMode, Category, Target } from './model.ts'
