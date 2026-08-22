/**
 * The parameter table an OSC address can reach, and how a value lands in it.
 *
 * ## Why this is pluggable
 *
 * There are two honest answers to "what can be set on a layer", and they come
 * from different places.
 *
 * The **built-in table below** is what this repo can vouch for: source,
 * geometry and opacity, every limit read off a running LivePremier and already
 * written down in `model.ts`. It is small, and it is the set a command line
 * needs.
 *
 * The **full table** is the device's own — sixty-seven layer parameters and
 * nineteen screen-group ones, generated from a switcher's Web RCS bundle into
 * `catalogue.json` by the control-surface tooling. A host that has it passes
 * it in and the address space widens to match; a host that does not gets the
 * built-ins and no lies about what it supports.
 *
 * That is the same discipline the rest of this file tree follows: a range is
 * either the device's statement about itself or it is not offered.
 *
 * ## Ids are the address, near enough
 *
 * A parameter's id is its dotted node path inside a layer — `position.posH`,
 * `cropping.classic.left`. Swap the dots for slashes and it is the tail of an
 * OSC address. That correspondence is the whole reason the ids are structural
 * rather than pretty, and it means a catalogue regenerated against a different
 * firmware changes the dictionary without anybody rewriting it.
 *
 * ## Normalised values, and why they are opt-in
 *
 * A fader sends 0..1. The device wants 0..256 for opacity, −2000000..2000000
 * for a position and an enum name for a source. Something has to bridge that,
 * and the dangerous way to do it is to guess from the value: `0.5` is a
 * perfectly good literal `posH`, half a pixel left of centre, *and* the middle
 * of a fader's throw. There is no way to tell them apart, and being wrong puts
 * a layer somewhere nobody asked for.
 *
 * So it is stated in the address. `/…/opacity/opacity` takes device units;
 * `/…/opacity/opacity/norm` takes 0..1 and scales. Two addresses, no guessing.
 */

/**
 * One settable property, in the shape `catalogue.json` already uses.
 *
 * `path` is the store tail *inside* the layer or group — `['position','pp',
 * 'posH']` — not a whole device path. Everything above it comes from the
 * address.
 */
export interface ParamSpec {
  readonly id: string
  readonly path: readonly string[]
  readonly type: 'number' | 'int' | 'bool' | 'enum' | 'map'
  readonly readOnly?: boolean
  readonly min?: number
  readonly max?: number
  /** The device's own name for the enum, for documentation. */
  readonly enum?: string
  readonly values?: readonly string[]
  /** One line of plain English, where this repo has one to offer. */
  readonly summary?: string
}

export interface ParamTable {
  readonly layer: readonly ParamSpec[]
  readonly screenGroup: readonly ParamSpec[]
}

const sourceValues = (): string[] => {
  /* The device's own INPUTLAYER_LOGIC enum, rebuilt from the family counts in
     model.ts. Kept as a list rather than a pattern because the dictionary is
     published and a reader wants to see the spelling, not infer it. */
  const out = ['NONE']
  const families: ReadonlyArray<readonly [string, number]> = [
    ['LIVE', 64],
    ['STILL', 48],
    ['SCREEN', 24],
    ['NATIVE', 8],
    ['SHARE', 32],
  ]
  for (const [name, n] of families) for (let i = 1; i <= n; i++) out.push(`${name}_${i}`)
  out.push('COLOR')
  return out
}

/**
 * What this repo can vouch for on a layer.
 *
 * Every figure here is `model.ts`'s, which read it off a device. Note the two
 * that surprise people: opacity is 0–256 rather than 0–100, and a position may
 * be negative because the anchor is the layer's centre.
 */
export const BUILTIN_LAYER_PARAMS: readonly ParamSpec[] = [
  {
    id: 'source.inputNum',
    path: ['source', 'pp', 'inputNum'],
    type: 'enum',
    enum: 'INPUTLAYER_LOGIC',
    values: sourceValues(),
    summary: 'Which input the layer shows. An enum name, not a number.',
  },
  {
    id: 'position.posH',
    path: ['position', 'pp', 'posH'],
    type: 'number',
    min: -2_000_000,
    max: 2_000_000,
    summary: 'Horizontal centre of the layer, in pixels. Negative is normal.',
  },
  {
    id: 'position.posV',
    path: ['position', 'pp', 'posV'],
    type: 'number',
    min: -2_000_000,
    max: 2_000_000,
    summary: 'Vertical centre of the layer, in pixels.',
  },
  {
    id: 'position.sizeH',
    path: ['position', 'pp', 'sizeH'],
    type: 'number',
    min: 0,
    max: 1_000_000,
    summary: 'Layer width in pixels.',
  },
  {
    id: 'position.sizeV',
    path: ['position', 'pp', 'sizeV'],
    type: 'number',
    min: 0,
    max: 1_000_000,
    summary: 'Layer height in pixels.',
  },
  {
    id: 'position.anchor',
    path: ['position', 'pp', 'anchor'],
    type: 'enum',
    enum: 'ANCHOR',
    values: [
      'TOP_LEFT', 'TOP_CENTER', 'TOP_RIGHT',
      'MIDDLE_LEFT', 'MIDDLE_CENTER', 'MIDDLE_RIGHT',
      'BOTTOM_LEFT', 'BOTTOM_CENTER', 'BOTTOM_RIGHT',
    ],
    summary: 'Which point of the layer the position refers to. Default MIDDLE_CENTER.',
  },
  {
    id: 'opacity.opacity',
    path: ['opacity', 'pp', 'opacity'],
    type: 'int',
    min: 0,
    max: 256,
    summary: 'Layer opacity. The range is 0–256, not 0–100.',
  },
]

/**
 * What this repo can vouch for on a screen's take group.
 *
 * Deliberately only the transitions and the take controls: those are the paths
 * `compile.ts` already emits for `Take`, so they are as verified as anything
 * here. The rest of the group is in the catalogue.
 */
export const BUILTIN_GROUP_PARAMS: readonly ParamSpec[] = [
  {
    id: 'control.xTake',
    path: ['control', 'pp', 'xTake'],
    type: 'bool',
    summary: 'Transition preview to program.',
  },
  {
    id: 'control.xCut',
    path: ['control', 'pp', 'xCut'],
    type: 'bool',
    summary: 'Swap preview and program with no transition.',
  },
  {
    id: 'control.xTakeUp',
    path: ['control', 'pp', 'xTakeUp'],
    type: 'bool',
    summary: 'Run the transition towards the up preset.',
  },
  {
    id: 'control.xTakeDown',
    path: ['control', 'pp', 'xTakeDown'],
    type: 'bool',
    summary: 'Run the transition towards the down preset.',
  },
  {
    id: 'control.xTakeAbort',
    path: ['control', 'pp', 'xTakeAbort'],
    type: 'bool',
    summary: 'Stop a transition in progress.',
  },
  {
    id: 'control.xStepBack',
    path: ['control', 'pp', 'xStepBack'],
    type: 'bool',
    summary: 'Undo the last take.',
  },
  {
    id: 'control.xCopyProgramToPreview',
    path: ['control', 'pp', 'xCopyProgramToPreview'],
    type: 'bool',
    summary: 'Copy what is on air back into preview.',
  },
  {
    id: 'control.takeUpTime',
    path: ['control', 'pp', 'takeUpTime'],
    type: 'int',
    min: 0,
    max: 3000,
    summary: 'Transition time towards the up preset, in tenths of a second.',
  },
  {
    id: 'control.takeDownTime',
    path: ['control', 'pp', 'takeDownTime'],
    type: 'int',
    min: 0,
    max: 3000,
    summary: 'Transition time towards the down preset, in tenths of a second.',
  },
  {
    id: 'control.tbarPosition',
    path: ['control', 'pp', 'tbarPosition'],
    type: 'int',
    min: 0,
    max: 65535,
    summary: 'T-bar position. Full throw completes the transition.',
  },
]

export const BUILTIN_PARAMS: ParamTable = {
  layer: BUILTIN_LAYER_PARAMS,
  screenGroup: BUILTIN_GROUP_PARAMS,
}

/** The address tail for a parameter: dots become slashes. */
export const paramAddress = (id: string): string => id.split('.').join('/')

/** And back again, so an address can be looked up in the table. */
export const paramId = (tail: readonly string[]): string => tail.join('.')

export const findParam = (table: readonly ParamSpec[], id: string): ParamSpec | undefined =>
  table.find((p) => p.id === id)

/**
 * Turn an OSC argument into the value the device expects.
 *
 * Refuses rather than approximates. An enum given a name it does not have is
 * an error, not the nearest match — a wrong source on a live layer is exactly
 * the sort of plausible mistake that is hard to spot on a multiviewer.
 */
export function coerce(spec: ParamSpec, arg: unknown): unknown {
  switch (spec.type) {
    case 'bool':
      if (typeof arg === 'boolean') return arg
      if (typeof arg === 'number') return arg !== 0
      if (arg === 'true' || arg === '1') return true
      if (arg === 'false' || arg === '0') return false
      throw new Error(`${spec.id} is a flag — send true/false or 1/0`)

    case 'enum': {
      const values = spec.values ?? []
      if (typeof arg === 'string') {
        const hit = values.find((v) => v.toUpperCase() === arg.toUpperCase())
        if (hit) return hit
        if (values.length === 0) return arg
        throw new Error(`${arg} is not a value of ${spec.enum ?? spec.id}`)
      }
      /* An index is allowed because a button on a surface sends a number and
         has nowhere to put a name. It is bounds-checked, unlike a name. */
      if (typeof arg === 'number' && Number.isInteger(arg)) {
        const hit = values[arg]
        if (hit !== undefined) return hit
        throw new Error(`${arg} is past the end of ${spec.enum ?? spec.id} (${values.length} values)`)
      }
      throw new Error(`${spec.id} takes a value name`)
    }

    case 'int':
    case 'number': {
      const n = typeof arg === 'number' ? arg : Number(arg)
      if (!Number.isFinite(n)) throw new Error(`${spec.id} takes a number`)
      const v = spec.type === 'int' ? Math.round(n) : n
      return clamp(spec, v)
    }

    default:
      /* `map` parameters carry structured values the device composes itself.
         Passing one through untouched is the only honest thing to do. */
      return arg
  }
}

/**
 * Map a 0..1 fader position onto the parameter's own range.
 *
 * A flag crosses at the halfway point, which is what a momentary control
 * sending 0 and 1 needs and what a fader sweep reads as. An enum walks its
 * values, so a knob over `position.anchor` steps through the nine anchors.
 */
export function denormalise(spec: ParamSpec, x: number): unknown {
  if (!Number.isFinite(x)) throw new Error(`${spec.id}: a normalised value must be a number`)
  const t = Math.min(1, Math.max(0, x))

  switch (spec.type) {
    case 'bool':
      return t >= 0.5
    case 'enum': {
      const values = spec.values ?? []
      if (values.length === 0) throw new Error(`${spec.id} has no published values to scale onto`)
      return values[Math.min(values.length - 1, Math.floor(t * values.length))]
    }
    case 'int':
    case 'number': {
      if (spec.min === undefined || spec.max === undefined) {
        throw new Error(`${spec.id} publishes no range, so a normalised value has nothing to scale onto`)
      }
      const v = spec.min + t * (spec.max - spec.min)
      return spec.type === 'int' ? Math.round(v) : v
    }
    default:
      throw new Error(`${spec.id} cannot take a normalised value`)
  }
}

function clamp(spec: ParamSpec, v: number): number {
  if (spec.min !== undefined && v < spec.min) return spec.min
  if (spec.max !== undefined && v > spec.max) return spec.max
  return v
}
