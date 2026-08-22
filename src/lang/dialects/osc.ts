/**
 * OSC — the address space this app publishes, and the resolver behind it.
 *
 * This is the dictionary a control surface targets. It exists because the MIDI
 * mapping already needed one: a fader is bound to *a screen, a preset, a layer
 * and a parameter*, and that four-part address is the same thing whether it
 * arrives as a MIDI control change or as an OSC packet. Writing it down as OSC
 * turns an internal binding shape into something QLab, TouchOSC, Companion or
 * a show-control system can send at, with no code on either side.
 *
 * ```text
 * /lp/screen/1/take
 * /lp/screen/1/memory/5/recall/preview
 * /lp/master/memory/12/store
 * /lp/screen/1/preset/program/layer/2/opacity/opacity 128
 * /lp/screen/1/preset/program/layer/2/opacity/opacity/norm 0.5
 * /lp/screen/1/group/control/takeUpTime 20
 * ```
 *
 * ## The five rules the whole space follows
 *
 * **1. The address is the target; the argument is only the value.** Everything
 * about *what* is being addressed is in the path, so a button on a surface
 * with a fixed address and no argument still means something specific. This is
 * the opposite of a protocol like `/set <screen> <layer> <param> <value>`, and
 * it is the difference between a TouchOSC layout that can be drawn once and
 * one that needs logic behind every control.
 *
 * **2. A trigger fires on a non-zero argument, and on no argument at all.**
 * Surfaces send a button press as `1` and its release as `0`. A take that
 * fired on both would fire twice per press, and the second one would be the
 * one nobody meant. With no argument it always fires, which is what a bare
 * `/lp/screen/1/take` from a script should do.
 *
 * **3. A recall never defaults to program.** Exactly the rule the Mynah
 * grammar keeps, for exactly the reason: an under-specified command must not
 * be able to reach air. `/lp/screen/1/memory/5/recall` goes to preview. Air
 * costs the extra word, here as everywhere else.
 *
 * **4. Units are the device's, unless the address says `/norm`.** See
 * `params.ts` — the ambiguity between "0.5 is half a fader" and "0.5 is half a
 * pixel" cannot be resolved from the value, so it is resolved in the address.
 *
 * **5. `preview` and `program` are resolved, never assumed.** They are names
 * for whichever preset buffer is pending or live right now, and a take swaps
 * them. An address that says `preview` is refused when the device state needed
 * to resolve it is unknown, rather than guessed at. `a`, `b` and `c` address
 * the buffers directly and need no device state.
 *
 * ## What is not here, and deliberately
 *
 * There is no relative form (`/norm/rel +0.01`). A relative move needs the
 * current value, which makes it a property of the surface holding the encoder
 * rather than of the address space — the MIDI engine's soft-pickup logic is
 * where that belongs, and duplicating it in an address would give two
 * implementations of one idea. The tail is reserved so it cannot mean anything
 * else later.
 */

import type { Op } from '../compile.ts'
import {
  DIMS,
  SLOTS,
  layerMemoryLoad,
  layerMemorySave,
  layerParamPath,
  masterMemoryLoad,
  masterMemorySave,
  memoryDelete,
  memoryLabel,
  monitoringMemoryLoad,
  monitoringMemorySave,
  screenGroupParamPath,
  screenMemoryLoad,
  screenMemorySave,
  takePath,
  type BankKind,
  type PresetBuffer,
  type PresetMode,
  type Target,
} from '../model.ts'
import type { Path } from '../paths.ts'

import {
  BUILTIN_PARAMS,
  coerce,
  denormalise,
  findParam,
  paramAddress,
  paramId,
  type ParamSpec,
  type ParamTable,
} from './params.ts'
import type { LineError, RunResult } from './types.ts'

/** The root every address in this dictionary starts with. */
export const ROOT = '/lp'

/**
 * What the resolver needs from the device and cannot work out alone.
 *
 * The same shape as the compiler's `DeviceFacts` and for the same reason —
 * `preview` and `program` name a buffer only in the light of the current take
 * state. A host that has the device store implements it; one that does not
 * passes nothing and gets a refusal with the reason on any address that needs
 * it, which is better than a layer move landing in the wrong buffer.
 */
export interface OscContext {
  readonly buffer?: (target: Target, mode: PresetMode) => PresetBuffer | undefined
  /** The parameter table to resolve against. Defaults to the built-ins. */
  readonly params?: ParamTable
}

export interface OscMessage {
  readonly address: string
  readonly args: readonly unknown[]
}

const fail = (message: string): RunResult => ({
  ok: false,
  language: 'osc',
  declared: false,
  errors: [{ message }],
})

// ---------------------------------------------------------------------------
// Typing an OSC message
// ---------------------------------------------------------------------------

/**
 * Read a typed line as an address and its arguments.
 *
 * OSC on the wire is binary and typed; typed at a console it is text, so the
 * arguments are read the same way AWJ reads a value — JSON if it parses, the
 * bare word otherwise. That gets numbers, `true`/`false` and quoted strings
 * right, and lets `LIVE_3` be written as itself.
 *
 * A quoted string may contain spaces; nothing else may.
 */
export function parseLine(body: string): OscMessage {
  const text = body.trim()
  if (!text.startsWith('/')) throw new Error('an OSC address starts with /')

  const parts = text.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? []
  const address = parts[0] ?? ''
  const args = parts.slice(1).map((token) => {
    try {
      return JSON.parse(token) as unknown
    } catch {
      return token
    }
  })
  return { address, args }
}

export function run(body: string, ctx: OscContext = {}): RunResult {
  let msg: OscMessage
  try {
    msg = parseLine(body)
  } catch (err) {
    return fail((err as Error).message)
  }
  return resolve(msg, ctx)
}

// ---------------------------------------------------------------------------
// Resolving an address
// ---------------------------------------------------------------------------

export function resolve(msg: OscMessage, ctx: OscContext = {}): RunResult {
  const errors: LineError[] = []
  try {
    const ops = dispatch(msg, ctx)
    if (ops === SKIPPED) {
      /* A trigger whose argument was zero. Not an error — it is the release
         half of a button press, and saying nothing is the correct response. */
      return {
        ok: true,
        language: 'osc',
        declared: false,
        ops: [],
        reads: [],
        summary: `${msg.address} — released, nothing sent`,
      }
    }
    return {
      ok: true,
      language: 'osc',
      declared: false,
      ops,
      reads: [],
      summary: `${msg.address} — ${ops.length} write${ops.length === 1 ? '' : 's'}`,
    }
  } catch (err) {
    errors.push({ message: (err as Error).message })
    return { ok: false, language: 'osc', declared: false, errors }
  }
}

/** Returned instead of ops when a trigger was told to release. */
const SKIPPED = Symbol('released')

function dispatch(msg: OscMessage, ctx: OscContext): Op[] | typeof SKIPPED {
  const segs = msg.address.split('/').filter((s) => s !== '')
  if (segs.length === 0) throw new Error('empty address')
  if (`/${segs[0]}` !== ROOT) {
    throw new Error(`addresses in this dictionary start with ${ROOT}/ (got /${segs[0]})`)
  }

  const rest = segs.slice(1)
  const head = rest.shift()

  switch (head) {
    case 'screen':
      return target({ kind: 'screen' }, rest, msg, ctx)
    case 'aux':
      return target({ kind: 'aux' }, rest, msg, ctx)
    case 'master':
      return master(rest, msg)
    case 'multiviewer':
      return multiviewer(rest, msg)
    default:
      throw new Error(
        `unknown address ${msg.address} — after ${ROOT} comes screen, aux, master or multiviewer`,
      )
  }
}

// ---------------------------------------------------------------------------

function target(
  kind: { kind: 'screen' | 'aux' },
  segs: string[],
  msg: OscMessage,
  ctx: OscContext,
): Op[] | typeof SKIPPED {
  const n = index(segs.shift(), kind.kind, DIMS[kind.kind].min, DIMS[kind.kind].max)
  const t: Target = { kind: kind.kind, n }
  const what = segs.shift()

  switch (what) {
    /* The shorthands. `take` and `cut` are named separately from the group
       parameters they compile to because they are what an operator reaches
       for, and `/lp/screen/1/take` reads better on a button than
       `/lp/screen/1/group/control/xTake`. Both work. */
    case 'take':
      return trigger(msg, () => [op(takePath(t), true, `Take ${label(t)}`)])
    case 'cut':
      return trigger(msg, () => [
        op(groupPath(t, 'control.xCut', ctx), true, `Cut ${label(t)}`),
      ])

    case 'memory':
      return memory(t, kind.kind, segs, msg)

    case 'layer':
      return layer(t, segs, msg)

    case 'preset':
      return preset(t, segs, msg, ctx)

    case 'group': {
      const found = lookup(table(ctx).screenGroup, segs, 'screen group')
      const path = screenGroupParamPath(t, found.spec.path)
      return parameter(found.spec, path, found.normalised, msg, label(t))
    }

    default:
      throw new Error(
        `unknown address after ${ROOT}/${kind.kind}/${n} — expected take, cut, memory, layer, preset or group`,
      )
  }
}

/** A memory on a screen or aux: recall, store, label, delete. */
function memory(t: Target, bank: BankKind, segs: string[], msg: OscMessage): Op[] | typeof SKIPPED {
  const slot = index(segs.shift(), 'memory', SLOTS[bank].min, SLOTS[bank].max)
  const verb = segs.shift()

  switch (verb) {
    case 'recall': {
      const mode = presetMode(segs.shift(), msg, 'PREVIEW')
      return trigger(msg, () => [
        op(screenMemoryLoad(slot, t, mode), true, `Recall memory ${slot} → ${label(t)} ${mode.toLowerCase()}`),
      ])
    }
    case 'store': {
      const mode = presetMode(segs.shift(), msg, 'PROGRAM')
      return trigger(msg, () => [
        op(screenMemorySave(slot, t, mode), true, `Store memory ${slot} ← ${label(t)} ${mode.toLowerCase()}`),
      ])
    }
    case 'label': {
      const text = msg.args[0]
      if (typeof text !== 'string') throw new Error('a label needs a string argument')
      return [op(memoryLabel(bank, slot), text, `Label ${bank} memory ${slot} "${text}"`)]
    }
    case 'delete':
      return trigger(msg, () => [
        op(memoryDelete(bank, slot), true, `Delete ${bank} memory ${slot}`),
      ])
    default:
      throw new Error(`unknown memory action ${verb ?? '(missing)'} — expected recall, store, label or delete`)
  }
}

/** `/screen/<n>/layer/<l>/memory/<slot>/…` — the layer memory bank. */
function layer(t: Target, segs: string[], msg: OscMessage): Op[] | typeof SKIPPED {
  const l = layerKeyOf(segs.shift())
  if (segs.shift() !== 'memory') {
    throw new Error(
      `after ${ROOT}/${t.kind}/${t.n}/layer/${l} comes memory — a live layer parameter is addressed through /preset/<mode>/layer/${l}`,
    )
  }
  const slot = index(segs.shift(), 'memory', SLOTS.layer.min, SLOTS.layer.max)
  const verb = segs.shift()

  if (verb === 'recall') {
    const mode = presetMode(segs.shift(), msg, 'PREVIEW')
    return trigger(msg, () => [
      op(layerMemoryLoad(slot, t, mode, l), true, `Recall layer memory ${slot} → ${label(t)} layer ${l} ${mode.toLowerCase()}`),
    ])
  }
  if (verb === 'store') {
    const mode = presetMode(segs.shift(), msg, 'PROGRAM')
    return trigger(msg, () => [
      op(layerMemorySave(slot, t, mode, l), true, `Store layer memory ${slot} ← ${label(t)} layer ${l} ${mode.toLowerCase()}`),
    ])
  }
  throw new Error(`unknown layer memory action ${verb ?? '(missing)'} — expected recall or store`)
}

/** `/screen/<n>/preset/<mode>/layer/<l>/<param…>` — a live layer parameter. */
function preset(t: Target, segs: string[], msg: OscMessage, ctx: OscContext): Op[] | typeof SKIPPED {
  const buffer = presetBuffer(t, segs.shift(), ctx)
  if (segs.shift() !== 'layer') {
    throw new Error(`after ${ROOT}/${t.kind}/${t.n}/preset/<mode> comes layer/<n>`)
  }
  const l = layerKeyOf(segs.shift())

  const spec = lookup(table(ctx).layer, segs, 'layer')
  const path = layerParamPath(t, buffer, l, spec.spec.path)
  return parameter(spec.spec, path, spec.normalised, msg, `${label(t)} preset ${buffer} layer ${l}`)
}

function master(segs: string[], msg: OscMessage): Op[] | typeof SKIPPED {
  if (segs.shift() !== 'memory') throw new Error(`after ${ROOT}/master comes memory/<slot>`)
  const slot = index(segs.shift(), 'memory', SLOTS.master.min, SLOTS.master.max)
  const verb = segs.shift()

  switch (verb) {
    case 'recall': {
      const mode = presetMode(segs.shift(), msg, 'PREVIEW')
      return trigger(msg, () => [
        op(masterMemoryLoad(slot, mode), true, `Recall master memory ${slot} → ${mode.toLowerCase()}`),
      ])
    }
    case 'store':
      /* Master store takes no mode: the device's own save carries a record
         mask instead, and the grammar writes it before firing. An OSC store
         fires the bank's default mask rather than composing one. */
      return trigger(msg, () => [
        op(masterMemorySave(slot), true, `Store master memory ${slot}`),
      ])
    case 'label': {
      const text = msg.args[0]
      if (typeof text !== 'string') throw new Error('a label needs a string argument')
      return [op(memoryLabel('master', slot), text, `Label master memory ${slot} "${text}"`)]
    }
    case 'delete':
      return trigger(msg, () => [op(memoryDelete('master', slot), true, `Delete master memory ${slot}`)])
    default:
      throw new Error(`unknown master action ${verb ?? '(missing)'} — expected recall, store, label or delete`)
  }
}

function multiviewer(segs: string[], msg: OscMessage): Op[] | typeof SKIPPED {
  const out = index(segs.shift(), 'output', DIMS.multiviewer.min, DIMS.multiviewer.max)
  if (segs.shift() !== 'memory') throw new Error(`after ${ROOT}/multiviewer/<n> comes memory/<slot>`)
  const slot = index(segs.shift(), 'memory', SLOTS.multiviewer.min, SLOTS.multiviewer.max)
  const verb = segs.shift()

  if (verb === 'recall') {
    return trigger(msg, () => [
      op(monitoringMemoryLoad(slot, out), true, `Recall multiviewer memory ${slot} → output ${out}`),
    ])
  }
  if (verb === 'store') {
    return trigger(msg, () => [
      op(monitoringMemorySave(slot, out), true, `Store multiviewer memory ${slot} ← output ${out}`),
    ])
  }
  throw new Error(`unknown multiviewer action ${verb ?? '(missing)'} — expected recall or store`)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const op = (path: Path, value: unknown, describe: string): Op => ({ path, value, describe })

const label = (t: Target) => `${t.kind === 'screen' ? 'screen' : 'aux'} ${t.n}`

const table = (ctx: OscContext): ParamTable => ctx.params ?? BUILTIN_PARAMS

/**
 * Fire, or do nothing, depending on the argument.
 *
 * Rule 2 at the top of this file. Note that the ops are built inside the
 * callback, so a released button does not pay for path construction and, more
 * importantly, cannot fail validation on a path it was never going to send.
 */
function trigger(msg: OscMessage, build: () => Op[]): Op[] | typeof SKIPPED {
  const arg = msg.args[0]
  if (arg === undefined) return build()
  if (arg === 0 || arg === false || arg === '0' || arg === 'false') return SKIPPED
  return build()
}

function index(raw: string | undefined, what: string, min: number, max: number): number {
  if (raw === undefined) throw new Error(`missing ${what} number`)
  const n = Number(raw)
  if (!Number.isInteger(n)) throw new Error(`${what} must be a whole number, got ${raw}`)
  if (n < min || n > max) throw new Error(`${what} ${n} is out of range — ${min} to ${max}`)
  return n
}

/** `NATIVE` is a layer too, and it is spelled out rather than numbered. */
function layerKeyOf(raw: string | undefined): number | 'NATIVE' {
  if (raw === undefined) throw new Error('missing layer')
  if (raw.toUpperCase() === 'NATIVE') return 'NATIVE'
  return index(raw, 'layer', DIMS.layer.min, DIMS.layer.max)
}

/**
 * Read a preset mode off the address, or off the first argument, or default.
 *
 * Both spellings exist because both kinds of sender exist: a surface with
 * fixed addresses puts the mode in the path, and a script that already
 * computes the address puts it in an argument. The default is the caller's,
 * and for a recall it is always preview — rule 3.
 */
function presetMode(seg: string | undefined, msg: OscMessage, fallback: PresetMode): PresetMode {
  const raw = seg ?? (typeof msg.args[0] === 'string' ? (msg.args[0] as string) : undefined)
  if (raw === undefined) return fallback
  const up = raw.toUpperCase()
  if (up === 'PREVIEW' || up === 'PVW') return 'PREVIEW'
  if (up === 'PROGRAM' || up === 'PGM') return 'PROGRAM'
  throw new Error(`${raw} is not a preset — expected preview or program`)
}

/**
 * Resolve the `preset` segment of a live-parameter address to a buffer.
 *
 * `a`/`b`/`c` are the buffers themselves and need nothing. `preview` and
 * `program` are names for whichever buffer is pending or live, so they need
 * the device's take state, and the refusal when it is missing says which fact
 * is missing rather than "cannot compile".
 */
function presetBuffer(t: Target, raw: string | undefined, ctx: OscContext): PresetBuffer {
  if (raw === undefined) throw new Error('missing preset — expected preview, program, a, b or c')
  const up = raw.toUpperCase()
  if (up === 'A' || up === 'B' || up === 'C') return up
  const mode = presetMode(raw, { address: '', args: [] }, 'PREVIEW')
  const buffer = ctx.buffer?.(t, mode)
  if (!buffer) {
    throw new Error(
      `cannot tell which buffer is ${mode.toLowerCase()} on ${label(t)} — the device's take state is not known here. Address the buffer directly with /a, /b or /c.`,
    )
  }
  return buffer
}

/**
 * Look a parameter up from the remaining address segments.
 *
 * A trailing `norm` is stripped first and reported separately, because it is a
 * modifier on the value rather than part of the parameter's name. `rel` is
 * refused by name rather than falling through to "unknown parameter", so that
 * the reserved tail explains itself instead of looking like a typo.
 */
function lookup(
  specs: readonly ParamSpec[],
  segs: string[],
  what: string,
): { spec: ParamSpec; normalised: boolean } {
  if (segs.length === 0) throw new Error(`missing ${what} parameter`)

  const tail = [...segs]
  let normalised = false
  if (tail[tail.length - 1] === 'rel') {
    throw new Error(
      'relative moves are reserved and not implemented — a relative step needs the current value, which belongs to the surface holding the encoder',
    )
  }
  if (tail[tail.length - 1] === 'norm') {
    normalised = true
    tail.pop()
  }

  const id = paramId(tail)
  const spec = findParam(specs, id)
  if (!spec) {
    throw new Error(`no ${what} parameter ${paramAddress(id)} in this dictionary`)
  }
  if (spec.readOnly) throw new Error(`${paramAddress(id)} is read-only on this device`)
  return { spec, normalised }
}

function parameter(
  spec: ParamSpec,
  path: Path,
  normalised: boolean,
  msg: OscMessage,
  where: string,
): Op[] | typeof SKIPPED {
  const arg = msg.args[0]

  /* A flag with no argument is a trigger: `/…/control/xTake` fires. Anything
     else with no argument is a mistake, not a default. */
  if (arg === undefined) {
    if (spec.type === 'bool') return [op(path, true, `${where} ${spec.id} = true`)]
    throw new Error(`${paramAddress(spec.id)} needs a value`)
  }

  if (spec.type === 'bool' && !normalised) {
    const value = coerce(spec, arg)
    /* A momentary control's release must not fire an `x`-prefixed command:
       those are edge-triggered on the device and writing false is either a
       no-op or a second event. Suppressed, not written. */
    if (value === false && spec.id.includes('.x')) return SKIPPED
    return [op(path, value, `${where} ${spec.id} = ${String(value)}`)]
  }

  const value = normalised ? denormalise(spec, Number(arg)) : coerce(spec, arg)
  return [op(path, value, `${where} ${spec.id} = ${String(value)}`)]
}

function groupPath(t: Target, id: string, ctx: OscContext): Path {
  const spec = findParam(table(ctx).screenGroup, id)
  if (!spec) throw new Error(`this dictionary has no screen group parameter ${id}`)
  return screenGroupParamPath(t, spec.path)
}

// ---------------------------------------------------------------------------
// The published dictionary
// ---------------------------------------------------------------------------

export interface OscEntry {
  readonly group: string
  readonly address: string
  readonly args: string
  readonly summary: string
}

/**
 * Every address this dictionary answers, as a list.
 *
 * Generated from the same tables the resolver uses, which is the point: the
 * document that goes out to integrators cannot describe an address the code
 * does not implement, and cannot miss one it does. `{n}` and `{slot}` are
 * placeholders, with their ranges in the summary.
 */
export function dictionary(params: ParamTable = BUILTIN_PARAMS): OscEntry[] {
  const out: OscEntry[] = []
  const push = (group: string, address: string, args: string, summary: string) =>
    out.push({ group, address, args, summary })

  for (const kind of ['screen', 'aux'] as const) {
    const g = kind === 'screen' ? 'Screens' : 'Auxiliary screens'
    const d = DIMS[kind]
    const s = SLOTS[kind]
    const range = `${kind} is ${d.min}–${d.max}`

    push(g, `${ROOT}/${kind}/{n}/take`, 'none, or 1 to fire', `Transition preview to program. ${range}.`)
    push(g, `${ROOT}/${kind}/{n}/cut`, 'none, or 1 to fire', `Swap preview and program with no transition. ${range}.`)
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/recall`, 'none, or 1 to fire',
      `Recall a memory into preview. Slots ${s.min}–${s.max}.`)
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/recall/{preview|program}`, 'none, or 1 to fire',
      'The same, saying which preset. Without it, preview — never program.')
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/store`, 'none, or 1 to fire',
      'Store the program preset into a memory.')
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/store/{preview|program}`, 'none, or 1 to fire',
      'The same, saying which preset to take the look from.')
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/label`, 'string', 'Rename a memory.')
    push(g, `${ROOT}/${kind}/{n}/memory/{slot}/delete`, 'none, or 1 to fire', 'Empty a memory slot.')
    push(g, `${ROOT}/${kind}/{n}/layer/{l}/memory/{slot}/recall`, 'none, or 1 to fire',
      `Recall a layer memory. Layers ${DIMS.layer.min}–${DIMS.layer.max} or NATIVE; slots ${SLOTS.layer.min}–${SLOTS.layer.max}.`)
    push(g, `${ROOT}/${kind}/{n}/layer/{l}/memory/{slot}/store`, 'none, or 1 to fire', 'Store a layer memory.')
  }

  push('Master', `${ROOT}/master/memory/{slot}/recall`, 'none, or 1 to fire',
    `Recall a master memory into preview. Slots ${SLOTS.master.min}–${SLOTS.master.max}.`)
  push('Master', `${ROOT}/master/memory/{slot}/recall/{preview|program}`, 'none, or 1 to fire',
    'The same, saying which preset.')
  push('Master', `${ROOT}/master/memory/{slot}/store`, 'none, or 1 to fire',
    'Store a master memory with the bank’s own record mask.')
  push('Master', `${ROOT}/master/memory/{slot}/label`, 'string', 'Rename a master memory.')
  push('Master', `${ROOT}/master/memory/{slot}/delete`, 'none, or 1 to fire', 'Empty a master memory slot.')

  push('Multiviewer', `${ROOT}/multiviewer/{out}/memory/{slot}/recall`, 'none, or 1 to fire',
    `Recall a multiviewer layout onto an output. Outputs ${DIMS.multiviewer.min}–${DIMS.multiviewer.max}, slots ${SLOTS.multiviewer.min}–${SLOTS.multiviewer.max}.`)
  push('Multiviewer', `${ROOT}/multiviewer/{out}/memory/{slot}/store`, 'none, or 1 to fire',
    'Store a multiviewer layout.')

  for (const spec of params.layer) {
    if (spec.readOnly) continue
    const address = `${ROOT}/screen/{n}/preset/{preview|program|a|b|c}/layer/{l}/${paramAddress(spec.id)}`
    push('Layer parameters', address, argsFor(spec), spec.summary ?? describe(spec))
    if (scalable(spec)) {
      push('Layer parameters', `${address}/norm`, 'float 0–1',
        `The same, as a fader position over ${rangeOf(spec)}.`)
    }
  }

  for (const spec of params.screenGroup) {
    if (spec.readOnly) continue
    const address = `${ROOT}/screen/{n}/group/${paramAddress(spec.id)}`
    push('Screen group', address, argsFor(spec), spec.summary ?? describe(spec))
    if (scalable(spec)) {
      push('Screen group', `${address}/norm`, 'float 0–1',
        `The same, as a fader position over ${rangeOf(spec)}.`)
    }
  }

  return out
}

/** Whether `/norm` means anything for this parameter — see `denormalise`. */
function scalable(spec: ParamSpec): boolean {
  if (spec.type === 'int' || spec.type === 'number') {
    return spec.min !== undefined && spec.max !== undefined
  }
  return spec.type === 'enum' && (spec.values?.length ?? 0) > 0
}

const rangeOf = (spec: ParamSpec): string =>
  spec.type === 'enum'
    ? `${spec.values?.length ?? 0} values`
    : `${spec.min ?? '?'} to ${spec.max ?? '?'}`

function argsFor(spec: ParamSpec): string {
  switch (spec.type) {
    case 'bool':
      return 'none, or 1 to fire'
    case 'enum':
      return `value name${spec.enum ? ` from ${spec.enum}` : ''}, or an index`
    case 'int':
      return `int ${spec.min ?? '?'}–${spec.max ?? '?'}`
    case 'number':
      return `number ${spec.min ?? '?'}–${spec.max ?? '?'}`
    default:
      return 'structured value'
  }
}

const describe = (spec: ParamSpec): string =>
  spec.type === 'enum'
    ? `Set ${spec.id}. ${spec.values?.length ?? 0} values.`
    : `Set ${spec.id}.`
