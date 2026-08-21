/**
 * Compile a parsed command into an ordered list of device writes.
 *
 * This is where policy lives: what an omitted preset mode means, how the
 * sticky scope fills in for an absent one, and the order the writes must go
 * out in. Everything the compiler emits is a `{path, value}` pair, which is
 * exactly what both transports carry — so the same output drives the live
 * WebSocket, an offline path listing, or an exported macro.
 */

import type { Amount, Assignment, Command, Filter, Scope } from './ast.ts'
import {
  CATEGORIES,
  DIMS,
  SLOTS,
  layerMemoryLoad,
  layerMemorySave,
  masterMemoryLoad,
  masterMemorySave,
  masterSaveProp,
  memoryDelete,
  memoryLabel,
  monitoringMemoryLoad,
  monitoringMemorySave,
  screenKey,
  auxKey,
  screenMemoryLoad,
  screenMemorySave,
  takePath,
  layerSource,
  layerPosition,
  layerOpacity,
  LAYER,
  SOURCES,
  type PresetBuffer,
  type BankKind,
  type PresetMode,
  type Target,
} from './model.ts'
import type { Path } from './paths.ts'

export interface Op {
  readonly path: Path
  readonly value: unknown
  /** One line of plain English, shown in the confirmation preview. */
  readonly describe: string
}

export interface CompileError {
  readonly message: string
}

export type CompileResult =
  | {
      readonly ok: true
      readonly ops: readonly Op[]
      readonly summary: string
      readonly selection?: Selection
      /** Which bank and slot the command addressed, for an existence check. */
      readonly bank?: BankKind
      readonly slot?: number
    }
  | { readonly ok: false; readonly errors: readonly CompileError[] }

/** The sticky scope a `Select` establishes and later commands inherit. */
export interface Selection {
  readonly targets: readonly Target[]
  readonly layers?: readonly (number | 'NATIVE')[]
}

/**
 * Defaults, stated once.
 *
 * The asymmetry is deliberate. A recall that did not say where it was going
 * goes to preview, so an under-specified command can never hit air. A store
 * takes from program, because that is the look you just made live and it is
 * also the device's own `SAVE_FROM_PGM` default. Reaching air always costs an
 * explicit word.
 */
const DEFAULT_RECALL_MODE: PresetMode = 'PREVIEW'
const DEFAULT_STORE_MODE: PresetMode = 'PROGRAM'

/**
 * What the compiler needs to know about the device, and cannot work out alone.
 *
 * Live layer parameters are addressed by buffer (`A`/`B`/`C`), while a command
 * says "preview" or "program" — names for whichever buffer is pending or live
 * right now. And a percentage is a percentage *of the canvas*, whose size the
 * device knows and a command does not.
 *
 * Both are answered from device state when it is known. When it is not, the
 * command is refused with the reason rather than guessed at, because guessing
 * would put a layer somewhere the operator did not ask for.
 */
export interface DeviceFacts {
  /** Which buffer a preset mode names on this screen, if known. */
  buffer(target: Target, mode: PresetMode): PresetBuffer | undefined
  /** The screen's canvas in pixels, if known. */
  canvas(target: Target): { readonly w: number; readonly h: number } | undefined
}

export interface CompileContext {
  /** The sticky scope, used when a command names no target of its own. */
  readonly selection?: Selection
  /** Live device state, needed only by `Set`. */
  readonly facts?: DeviceFacts
}

export function compile(cmd: Command, ctx: CompileContext = {}): CompileResult {
  const errors: CompileError[] = []
  const fail = (message: string): CompileResult => ({ ok: false, errors: [{ message }] })

  const targets = resolveTargets(cmd.scope, ctx.selection)
  const layers = resolveLayers(cmd.scope, ctx.selection)

  switch (cmd.fn) {
    // -----------------------------------------------------------------------
    case 'Clear':
      return { ok: true, ops: [], summary: 'Clear' }

    // -----------------------------------------------------------------------
    case 'Select': {
      if (targets.length === 0 && !layers) {
        return fail('Select needs a Screen, Aux or Layer')
      }
      const parts: string[] = []
      if (targets.length > 0) parts.push(targets.map(describeTarget).join(', '))
      if (layers) parts.push(`Layer ${layers.map(String).join(', ')}`)
      return {
        ok: true,
        ops: [],
        summary: `Select ${parts.join(' ')}`,
        selection: { targets, layers },
      }
    }

    // -----------------------------------------------------------------------
    case 'Take': {
      if (targets.length === 0) {
        return fail('Take needs a Screen or Aux, or a sticky scope to inherit')
      }
      const ops = targets.map((t) => ({
        path: takePath(t),
        value: true,
        describe: `Take ${describeTarget(t)}`,
      }))
      return { ok: true, ops, summary: summarise('Take', ops.length, targets) }
    }

    // -----------------------------------------------------------------------
    case 'Recall': {
      if (cmd.memory === undefined) return fail('Recall needs a Memory number')
      if (cmd.filter) return fail('If filters a Store, not a Recall')
      const mode = cmd.mode ?? DEFAULT_RECALL_MODE

      if (cmd.scope.master) {
        const err = checkSlot('master', cmd.memory)
        if (err) return fail(err)
        return {
          ok: true,
          ops: [
            {
              path: masterMemoryLoad(cmd.memory, mode),
              value: true,
              describe: `Recall Master memory ${cmd.memory} to ${describeMode(mode)}`,
            },
          ],
          summary: `Recall Master ${cmd.memory} → ${describeMode(mode)}`,
          bank: 'master',
          slot: cmd.memory,
        }
      }

      if (cmd.scope.multiviewers) {
        const err = checkSlot('multiviewer', cmd.memory)
        if (err) return fail(err)
        const ops = cmd.scope.multiviewers.values.map((n) => ({
          path: monitoringMemoryLoad(cmd.memory!, n),
          value: true,
          describe: `Recall Multiviewer memory ${cmd.memory} to output ${n}`,
        }))
        return { ok: true, ops, summary: `Recall Multiviewer ${cmd.memory} → ${ops.length} output(s)`, bank: 'multiviewer', slot: cmd.memory }
      }

      if (targets.length === 0) {
        return fail('Recall needs a Screen, Aux or Master, or a sticky scope to inherit')
      }

      // A layer in scope makes this a layer-memory recall rather than a
      // screen-memory one. Same verb, narrower object — which is the whole
      // point of scoping the command line.
      if (layers) {
        const err = checkSlot('layer', cmd.memory)
        if (err) return fail(err)
        const ops: Op[] = []
        for (const t of targets) {
          for (const l of layers) {
            ops.push({
              path: layerMemoryLoad(cmd.memory, t, mode, l),
              value: true,
              describe: `Recall Layer memory ${cmd.memory} to ${describeTarget(t)} layer ${l} ${describeMode(mode)}`,
            })
          }
        }
        return { ok: true, ops, summary: `Recall Layer ${cmd.memory} → ${ops.length} op(s), ${describeMode(mode)}`, bank: 'layer', slot: cmd.memory }
      }

      const err = checkSlot('screen', cmd.memory)
      if (err) return fail(err)
      const ops = targets.map((t) => ({
        path: screenMemoryLoad(cmd.memory!, t, mode),
        value: true,
        describe: `Recall memory ${cmd.memory} to ${describeTarget(t)} ${describeMode(mode)}`,
      }))
      return {
        ok: true,
        ops,
        summary: `Recall ${cmd.memory} → ${targets.map(describeTarget).join(', ')} ${describeMode(mode)}`,
        bank: targets[0].kind === 'aux' ? 'aux' : 'screen',
        slot: cmd.memory,
      }
    }

    // -----------------------------------------------------------------------
    case 'Store': {
      if (cmd.memory === undefined) return fail('Store needs a Memory number')
      const mode = cmd.mode ?? DEFAULT_STORE_MODE

      if (cmd.scope.master) {
        const err = checkSlot('master', cmd.memory)
        if (err) return fail(err)
        return compileMasterStore(cmd.memory, mode, cmd.filter)
      }

      // Screen and layer banks carry no filter properties on this firmware.
      // Ignoring a mask the operator typed would be worse than refusing it.
      if (cmd.filter) {
        return fail('If is only supported on Store Master — the screen and layer banks have no record mask')
      }

      if (cmd.scope.multiviewers) {
        const err = checkSlot('multiviewer', cmd.memory)
        if (err) return fail(err)
        const ops = cmd.scope.multiviewers.values.map((n) => ({
          path: monitoringMemorySave(cmd.memory!, n),
          value: true,
          describe: `Store output ${n} to Multiviewer memory ${cmd.memory}`,
        }))
        return { ok: true, ops, summary: `Store Multiviewer ${cmd.memory} ← ${ops.length} output(s)` }
      }

      if (targets.length === 0) {
        return fail('Store needs a Screen, Aux or Master, or a sticky scope to inherit')
      }

      if (layers) {
        const err = checkSlot('layer', cmd.memory)
        if (err) return fail(err)
        const ops: Op[] = []
        for (const t of targets) {
          for (const l of layers) {
            ops.push({
              path: layerMemorySave(cmd.memory, t, mode, l),
              value: true,
              describe: `Store ${describeTarget(t)} layer ${l} ${describeMode(mode)} to Layer memory ${cmd.memory}`,
            })
          }
        }
        return { ok: true, ops, summary: `Store Layer ${cmd.memory} ← ${ops.length} op(s), from ${describeMode(mode)}` }
      }

      const err = checkSlot('screen', cmd.memory)
      if (err) return fail(err)
      const ops = targets.map((t) => ({
        path: screenMemorySave(cmd.memory!, t, mode),
        value: true,
        describe: `Store ${describeTarget(t)} ${describeMode(mode)} to memory ${cmd.memory}`,
      }))
      return {
        ok: true,
        ops,
        summary: `Store ${cmd.memory} ← ${targets.map(describeTarget).join(', ')} from ${describeMode(mode)}`,
      }
    }

    // -----------------------------------------------------------------------
    case 'Set': {
      if (!cmd.set) return fail('Set needs something to set — Source, Size, Position or Opacity')
      if (targets.length === 0) {
        return fail('Set needs a Screen or Aux, or a sticky scope to inherit')
      }
      if (!layers) {
        return fail('Set needs a Layer — these are layer parameters, not screen ones')
      }
      // Live parameters are per-buffer, and preview is the safe default here
      // for the same reason it is on a recall: an under-specified command must
      // not change what is on air.
      const mode = cmd.mode ?? 'PREVIEW'
      const facts = ctx.facts
      if (!facts) {
        return fail('Set needs a live connection — layer parameters are addressed per buffer, which depends on the current take state')
      }

      const ops: Op[] = []
      for (const t of targets) {
        const buffer = facts.buffer(t, mode)
        if (!buffer) {
          return fail(
            `Cannot tell which buffer is ${describeMode(mode)} on ${describeTarget(t)} yet — the device has not reported its take state`,
          )
        }
        const canvas = facts.canvas(t)
        for (const l of layers) {
          const err = assignmentOps(ops, cmd.set, t, buffer, l, canvas)
          if (err) return fail(err)
        }
      }

      return {
        ok: true,
        ops,
        summary: `Set ${describeAssignment(cmd.set)} on ${targets.map(describeTarget).join(', ')} layer ${layers.join(', ')} ${describeMode(mode)}`,
      }
    }

    // -----------------------------------------------------------------------
    case 'Delete': {
      if (cmd.memory === undefined) return fail('Delete needs a Memory number')
      const bank = bankOf(cmd.scope, layers)
      const err = checkSlot(bank, cmd.memory)
      if (err) return fail(err)
      return {
        ok: true,
        ops: [
          {
            path: memoryDelete(bank, cmd.memory),
            value: true,
            describe: `Delete ${bank} memory ${cmd.memory}`,
          },
        ],
        summary: `Delete ${bank} memory ${cmd.memory}`,
      }
    }

    // -----------------------------------------------------------------------
    case 'Label': {
      if (cmd.memory === undefined) return fail('Label needs a Memory number')
      if (cmd.label === undefined) return fail('Label needs text in quotes, e.g. Label Memory 5 "Wide Open"')
      const bank = bankOf(cmd.scope, layers)
      const err = checkSlot(bank, cmd.memory)
      if (err) return fail(err)
      return {
        ok: true,
        ops: [
          {
            path: memoryLabel(bank, cmd.memory),
            value: cmd.label,
            describe: `Label ${bank} memory ${cmd.memory} "${cmd.label}"`,
          },
        ],
        summary: `Label ${bank} memory ${cmd.memory} "${cmd.label}"`,
      }
    }
  }

  return { ok: false, errors }
}

// ---------------------------------------------------------------------------

/**
 * A master store is the one compound command in the first pass: four filter
 * writes and then the trigger, in that order.
 *
 * Order is load-bearing. The filters are ordinary properties that persist on
 * the device, so the trigger uses whatever was last written — firing first
 * would store against the previous command's mask. Both transports preserve
 * ordering on a single connection, which is what makes this safe to send as
 * one burst rather than waiting for each echo.
 */
function compileMasterStore(slot: number, mode: PresetMode, filter?: Filter): CompileResult {
  const ops: Op[] = []

  const saveMode = mode === 'PROGRAM' ? 'SAVE_FROM_PGM' : 'SAVE_FROM_PVW'
  ops.push({
    path: masterSaveProp('mode'),
    value: saveMode,
    describe: `Store from ${describeMode(mode)}`,
  })

  // An absent filter is written wide open rather than left alone. The device
  // keeps the last mask that was set — by us or by someone in the vendor UI —
  // so an unfiltered Store must say so explicitly or it silently inherits.
  const screens = filter?.screens
    ? filter.screens.values.map(screenKey)
    : allKeys(DIMS.screen.min, DIMS.screen.max, screenKey)
  const auxes = filter?.auxes
    ? filter.auxes.values.map(auxKey)
    : allKeys(DIMS.aux.min, DIMS.aux.max, auxKey)
  const layerValues = filter?.layers
    ? layerFilterValues(filter.layers)
    : ['NATIVE', ...allKeys(DIMS.layer.min, DIMS.layer.max, String)]
  const categories = filter?.categories ?? CATEGORIES

  ops.push({
    path: masterSaveProp('screenFilter'),
    value: screens,
    describe: filter?.screens ? `Only ${screens.join(', ')}` : 'All screens',
  })
  ops.push({
    path: masterSaveProp('auxFilter'),
    value: auxes,
    describe: filter?.auxes ? `Only ${auxes.join(', ')}` : 'All auxes',
  })
  ops.push({
    path: masterSaveProp('layerFilter'),
    value: layerValues,
    describe: filter?.layers ? `Only layer ${layerValues.join(', ')}` : 'All layers',
  })
  ops.push({
    path: masterSaveProp('categoryFilter'),
    value: [...categories],
    describe: filter?.categories ? `Only ${categories.join(', ')}` : 'All categories',
  })

  ops.push({
    path: masterMemorySave(slot),
    value: true,
    describe: `Store Master memory ${slot}`,
  })

  const masked = filter ? ' (masked)' : ''
  return { ok: true, ops, summary: `Store Master ${slot} ← ${describeMode(mode)}${masked}` }
}

function layerFilterValues(layers: { native: boolean; numbers: { values: readonly number[] } }): string[] {
  const out: string[] = []
  if (layers.native) out.push('NATIVE')
  for (const n of layers.numbers.values) out.push(String(n))
  return out
}

function allKeys(min: number, max: number, key: (n: number) => string): string[] {
  const out: string[] = []
  for (let n = min; n <= max; n++) out.push(key(n))
  return out
}

/** The screens and auxes a command acts on: its own, or the sticky scope. */
function resolveTargets(scope: Scope, selection?: Selection): Target[] {
  const own: Target[] = []
  if (scope.screens) for (const n of scope.screens.values) own.push({ kind: 'screen', n })
  if (scope.auxes) for (const n of scope.auxes.values) own.push({ kind: 'aux', n })
  if (own.length > 0) return own
  return selection ? [...selection.targets] : []
}

function resolveLayers(scope: Scope, selection?: Selection): (number | 'NATIVE')[] | undefined {
  if (scope.layers) {
    const out: (number | 'NATIVE')[] = []
    if (scope.layers.native) out.push('NATIVE')
    for (const n of scope.layers.numbers.values) out.push(n)
    return out.length > 0 ? out : undefined
  }
  // A sticky layer only applies when the command named no scope of its own at
  // all. `Recall Screen 2 Memory 5` with a layer selected is a screen recall
  // on S2, not a layer recall — naming a screen replaces the selection.
  if (scope.screens || scope.auxes || scope.master || scope.multiviewers) return undefined
  return selection?.layers && selection.layers.length > 0 ? [...selection.layers] : undefined
}

function bankOf(scope: Scope, layers?: readonly unknown[]): BankKind {
  if (scope.master) return 'master'
  if (scope.multiviewers) return 'multiviewer'
  if (layers && layers.length > 0) return 'layer'
  if (scope.auxes && !scope.screens) return 'aux'
  return 'screen'
}

function checkSlot(bank: BankKind, slot: number): string | undefined {
  const { min, max } = SLOTS[bank]
  if (slot < min || slot > max) {
    return `Memory ${slot} is out of range — ${bank} memories are ${min} to ${max}`
  }
  return undefined
}

/**
 * Turn one assignment into writes, resolving percentages against the canvas.
 *
 * Position is anchored on the layer's centre — the device's default anchor is
 * `MIDDLE_CENTER` — so "a third of the way across" means the centre sits at a
 * third of the canvas, which is what someone asking for it means.
 */
function assignmentOps(
  ops: Op[],
  set: Assignment,
  t: Target,
  buffer: PresetBuffer,
  layer: number | 'NATIVE',
  canvas: { readonly w: number; readonly h: number } | undefined,
): string | undefined {
  const px = (a: Amount, axis: 'w' | 'h', what: string): number | string => {
    if (!a.percent) return Math.round(a.value)
    if (!canvas) {
      return `${what} was given as a percentage, but the canvas size of ${describeTarget(t)} is not known yet — give it in pixels, or connect and let the device report its size`
    }
    return Math.round((a.value / 100) * canvas[axis])
  }

  if (set.source) {
    const value = sourceValue(set.source)
    if (typeof value === 'string' && value.startsWith('!')) return value.slice(1)
    ops.push({
      path: layerSource(t, buffer, layer),
      value,
      describe: `Source ${value} on ${describeTarget(t)} layer ${layer}`,
    })
  }

  if (set.size) {
    const [hAmt, vAmt] = set.size.length === 1 ? [set.size[0], set.size[0]] : set.size
    const h = px(hAmt, 'w', 'Size')
    if (typeof h === 'string') return h
    const v = px(vAmt, 'h', 'Size')
    if (typeof v === 'string') return v
    for (const [axis, n] of [['Width', h], ['Height', v]] as const) {
      if (n < LAYER.sizeMin || n > LAYER.sizeMax) {
        return `${axis} ${n}px is out of range — a size must be between ${LAYER.sizeMin} and ${LAYER.sizeMax}. A layer cannot have a negative size, though it can be larger than the canvas.`
      }
    }
    ops.push(
      { path: layerPosition(t, buffer, layer, 'sizeH'), value: h, describe: `Width ${h}px` },
      { path: layerPosition(t, buffer, layer, 'sizeV'), value: v, describe: `Height ${v}px` },
    )
  }

  if (set.position) {
    const [hAmt, vAmt] = set.position.length === 1 ? [set.position[0], set.position[0]] : set.position
    const h = px(hAmt, 'w', 'Position')
    if (typeof h === 'string') return h
    const v = px(vAmt, 'h', 'Position')
    if (typeof v === 'string') return v
    for (const [axis, n] of [['X', h], ['Y', v]] as const) {
      if (n < LAYER.positionMin || n > LAYER.positionMax) {
        return `${axis} ${n}px is out of range — a position must be between ${LAYER.positionMin} and ${LAYER.positionMax}.`
      }
    }
    ops.push(
      { path: layerPosition(t, buffer, layer, 'posH'), value: h, describe: `X ${h}px (layer centre)` },
      { path: layerPosition(t, buffer, layer, 'posV'), value: v, describe: `Y ${v}px (layer centre)` },
    )
  }

  if (set.opacity) {
    // Opacity is 0-256 on this device, not 0-100. A percentage is scaled to
    // that; a plain number is taken as the device's own units.
    const raw = set.opacity.percent
      ? Math.round((set.opacity.value / 100) * LAYER.opacityMax)
      : Math.round(set.opacity.value)
    if (raw < 0 || raw > LAYER.opacityMax) {
      return `Opacity ${raw} is out of range — the device's scale is 0 to ${LAYER.opacityMax}`
    }
    ops.push({
      path: layerOpacity(t, buffer, layer),
      value: raw,
      describe: `Opacity ${raw} of ${LAYER.opacityMax}`,
    })
  }

  return undefined
}

/** An error is returned as a string prefixed with `!`, to keep one return type. */
function sourceValue(src: NonNullable<Assignment['source']>): string {
  switch (src.family) {
    case 'none':
      return 'NONE'
    case 'colour':
      return 'COLOR'
    case 'still':
      return src.n !== undefined && src.n >= 1 && src.n <= SOURCES.still
        ? `STILL_${src.n}`
        : `!Still ${src.n} is out of range — stills are 1 to ${SOURCES.still}`
    case 'live':
      return src.n !== undefined && src.n >= 1 && src.n <= SOURCES.live
        ? `LIVE_${src.n}`
        : `!Source ${src.n} is out of range — live inputs are 1 to ${SOURCES.live}`
  }
}

function describeAssignment(set: Assignment): string {
  const bits: string[] = []
  if (set.source) bits.push('source')
  if (set.size) bits.push('size')
  if (set.position) bits.push('position')
  if (set.opacity) bits.push('opacity')
  return bits.join(' + ')
}

const describeMode = (m: PresetMode) => (m === 'PREVIEW' ? 'Preview' : 'Program')

const describeTarget = (t: Target) => (t.kind === 'screen' ? `Screen ${t.n}` : `Aux ${t.n}`)

function summarise(verb: string, count: number, targets: readonly Target[]): string {
  if (count === 1) return `${verb} ${describeTarget(targets[0])}`
  return `${verb} ${targets.map(describeTarget).join(', ')} — ${count} ops`
}
