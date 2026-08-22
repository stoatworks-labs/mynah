/**
 * One command line, four languages.
 *
 * A console hands a line to `run()` and gets ops back. Which language the line
 * was written in is worked out here, reported in the result so the UI can say
 * so, and otherwise nobody's business.
 *
 * ```text
 * Recall Screen 1 Memory 5                                    Mynah
 * AWJ DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
 * {"path":["device","screenAuxGroupList",…],"value":true}     JSON
 * /lp/screen/1/take                                           OSC
 * ```
 *
 * ## Why the three raw languages exist at all
 *
 * Mynah is the language for driving a show. The other three are for the times
 * a show is not going well: a path out of a packet capture, a frame out of a
 * browser's network panel, an address a lighting console is already sending.
 * Each of them is something an operator or an integrator *already has in front
 * of them*, and the cost of translating it by hand is a typo on a live frame.
 *
 * They are also how this app's own object-model knowledge gets checked. A path
 * typed raw and a path the compiler produced go out over the same transport
 * and land in the same place, so "does the grammar agree with the protocol
 * guide" stops being a question about the code and becomes something anyone
 * can try in one line.
 *
 * ## `all` is not a language
 *
 * It is the absence of a choice: declare the language on the line, or let it
 * be sniffed. Choosing one language explicitly turns detection off, which is
 * what someone pasting generated JSON wants — a payload that happens to start
 * with a slash should be a JSON error, not silently an OSC command.
 */

import { compile, type CompileContext } from '../compile.ts'
import { parse } from '../parser.ts'

import * as awj from './awj.ts'
import { declared, sniff } from './detect.ts'
import * as json from './json.ts'
import * as osc from './osc.ts'
import type { LanguageChoice, LanguageId, RunResult } from './types.ts'

export interface RunContext extends CompileContext {
  /** What the operator has chosen. `all` — detect — is the default. */
  readonly language?: LanguageChoice
  /** Extra facts the OSC resolver needs. See `osc.ts`. */
  readonly osc?: osc.OscContext
}

/**
 * Parse and compile one line in whichever language it turns out to be.
 *
 * Never throws. A language that cannot make sense of the line returns its own
 * error, which is the useful one: a nearly-valid Mynah command should get
 * Mynah's complaint about the word that is wrong, not JSON's complaint about
 * a missing brace.
 */
export function run(line: string, ctx: RunContext = {}): RunResult {
  const choice: LanguageChoice = ctx.language ?? 'all'

  /* A declared prefix is honoured even when a single language is selected.
     Someone who has pinned the console to JSON and then types `MYNAH Take
     Screen 1` has said what they want plainly, and refusing it would be
     pedantry. Pinning still switches off *guessing*, which is the part that
     can surprise. */
  const head = declared(line)
  const language: LanguageId =
    head.language ?? (choice === 'all' ? sniff(head.body) : choice)

  const result = dispatch(language, head.body, ctx)

  /* `declared` is threaded through here rather than inside each dialect,
     because whether the language was named is a fact about the line and not
     about the language. */
  return { ...result, language, declared: head.language !== null } as RunResult
}

function dispatch(language: LanguageId, body: string, ctx: RunContext): RunResult {
  switch (language) {
    case 'awj':
      return awj.run(body)
    case 'json':
      return json.run(body)
    case 'osc':
      return osc.run(body, ctx.osc)
    case 'mynah':
      return mynah(body, ctx)
  }
}

/**
 * The native grammar, wrapped in the common shape.
 *
 * `parse` and `compile` stay exactly as they are — this only widens their
 * result so a console does not need two code paths. Note that a Mynah command
 * never produces reads: every one of them is a write.
 */
function mynah(body: string, ctx: RunContext): RunResult {
  const parsed = parse(body)
  if (!parsed.ok) {
    return {
      ok: false,
      language: 'mynah',
      declared: false,
      errors: parsed.errors.map((e) => ({ message: e.message, start: e.start, end: e.end })),
    }
  }

  const compiled = compile(parsed.command, ctx)
  if (!compiled.ok) {
    return {
      ok: false,
      language: 'mynah',
      declared: false,
      errors: compiled.errors.map((e) => ({ message: e.message })),
    }
  }

  return {
    ok: true,
    language: 'mynah',
    declared: false,
    ops: compiled.ops,
    reads: [],
    summary: compiled.summary,
    selection: compiled.selection,
    bank: compiled.bank,
    slot: compiled.slot,
    fn: parsed.command.fn,
  }
}

export { declared, sniff } from './detect.ts'
export {
  BUILTIN_GROUP_PARAMS,
  BUILTIN_LAYER_PARAMS,
  BUILTIN_PARAMS,
  coerce,
  denormalise,
  paramAddress,
  paramId,
} from './params.ts'
export { ROOT as OSC_ROOT, dictionary as oscDictionary, parseLine as parseOsc, resolve as resolveOsc } from './osc.ts'
export { LANGUAGES, LANGUAGE_LABELS } from './types.ts'

export type { ParamSpec, ParamTable } from './params.ts'
export type { OscContext, OscEntry, OscMessage } from './osc.ts'
export type { LanguageChoice, LanguageId, LineError, Read, RunResult } from './types.ts'
