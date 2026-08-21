/**
 * The slice of the LivePremier object model the command line addresses.
 *
 * Every limit here was confirmed against firmware 6.2.73, leaf by leaf, on a
 * running device. Do not infer a limit by probing AWJ for an `E12` error: that
 * finds the *model's* maximum, not what a given chassis has configured, and the
 * two disagree.
 */

import { DeviceObject, Path } from './paths.ts'

/** Firmware this table was verified against. */
export const VERIFIED_FIRMWARE = '6.2.73'

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const DIMS = {
  screen: { min: 1, max: 24 },
  aux: { min: 1, max: 96 },
  /** `NATIVE` is a layer too, and is handled out of band from this range. */
  layer: { min: 1, max: 128 },
  multiviewer: { min: 1, max: 8 },
} as const

/** Memory slot ranges, which differ per bank. */
export const SLOTS = {
  screen: { min: 1, max: 1000 },
  aux: { min: 1, max: 1000 },
  master: { min: 1, max: 500 },
  layer: { min: 1, max: 50 },
  multiviewer: { min: 1, max: 50 },
} as const

export type BankKind = keyof typeof SLOTS

export type PresetMode = 'PREVIEW' | 'PROGRAM'

/**
 * The record-mask categories, in the device's own order.
 *
 * `categoryFilter` is a record mask in everything but name — the same idea as
 * a lighting desk masking a store to position or colour only.
 */
export const CATEGORIES = [
  'SOURCE',
  'POS',
  'SIZE',
  'OPACITY',
  'CROPPING',
  'BORDER',
  'TRANSITIONS',
  'EFFECTS',
  'FLYING_CURVE',
  'TIMING',
  'SPEED',
  'CUT_AND_FILL',
  'MASK',
  'KEYER',
] as const

export type Category = (typeof CATEGORIES)[number]

/** Where a master store draws its values from. */
export type SaveMode = 'SAVE_FROM_PGM' | 'SAVE_FROM_PVW'

/**
 * The three fixed preset buffers.
 *
 * Live layer parameters are addressed by these, **not** by preview/program —
 * unlike the memory banks, which use `PREVIEW`/`PROGRAM`. Preview and program
 * are names for whichever buffer is pending or live at the moment, so reaching
 * a live parameter means resolving the name to a letter first.
 */
export type PresetBuffer = 'A' | 'B' | 'C'

/** How many of each source family a LivePremier offers. */
export const SOURCES = {
  live: 64,
  still: 48,
  screen: 24,
  native: 8,
  share: 32,
} as const

/**
 * Layer parameter limits, in the units the device actually uses.
 *
 * Straight from the device's own attribute table. Note the asymmetry: a
 * position may be **negative** — pushing a layer off the edge of the canvas is
 * a normal thing to do, and since the anchor is the layer's centre it is
 * routine — while a size may not.
 */
export const LAYER = {
  /** Opacity is 0–256, not 0–100. */
  opacityMax: 256,
  /** Position and size are in pixels, anchored on the layer's centre. */
  anchorDefault: 'MIDDLE_CENTER',
  positionMin: -2_000_000,
  positionMax: 2_000_000,
  sizeMin: 0,
  sizeMax: 1_000_000,
} as const

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

export const screenKey = (n: number) => `S${n}`
export const auxKey = (n: number) => `A${n}`
/** `NATIVE` is the background layer; the rest are plain numbers. */
export const layerKey = (n: number | 'NATIVE') => String(n)

/** A screen or an auxiliary screen. They share a key shape, not a namespace. */
export type Target =
  | { kind: 'screen'; n: number }
  | { kind: 'aux'; n: number }

export const targetKey = (t: Target) =>
  t.kind === 'screen' ? screenKey(t.n) : auxKey(t.n)

/** The collection a target lives in, which differs between load and save. */
const targetCollection = (t: Target) =>
  t.kind === 'screen' ? 'screen' : 'auxiliary'

// ---------------------------------------------------------------------------
// Path builders
// ---------------------------------------------------------------------------

const presetBank = DeviceObject.node('presetBank')
const masterBank = DeviceObject.node('masterPresetBank')
const layerBank = DeviceObject.node('layerBank')
const monitoringBank = DeviceObject.node('monitoringBank')

/**
 * Note the asymmetry, which is the device's and not ours: a load is addressed
 * slot-first, a save target-first. Getting this backwards yields an E12 on
 * AWJ and silence on the WebSocket.
 */

/** Recall a screen or aux memory into a preset. */
export const screenMemoryLoad = (slot: number, t: Target, mode: PresetMode): Path =>
  presetBank
    .node('control')
    .node('load')
    .item('slot', slot)
    .item(targetCollection(t), targetKey(t))
    .item('preset', mode)
    .prop('xRequest')

/** Store a preset into a screen or aux memory. */
export const screenMemorySave = (slot: number, t: Target, mode: PresetMode): Path =>
  presetBank
    .node('control')
    .node('save')
    .item(targetCollection(t), targetKey(t))
    .item('preset', mode)
    .item('slot', slot)
    .prop('xRequest')

/** Recall a master memory. Master has no target: it is the whole desk. */
export const masterMemoryLoad = (slot: number, mode: PresetMode): Path =>
  masterBank.node('control').node('load').item('slot', slot).item('preset', mode).prop('xRequest')

/** Fire a master store. The filters below must be written first. */
export const masterMemorySave = (slot: number): Path =>
  masterBank.node('control').node('save').item('slot', slot).prop('xRequest')

/** The master store's record mask. */
export const masterSaveProp = (
  prop: 'mode' | 'screenFilter' | 'auxFilter' | 'layerFilter' | 'categoryFilter',
): Path => masterBank.node('control').node('save').prop(prop)

/** Recall a layer memory. */
export const layerMemoryLoad = (
  slot: number,
  t: Target,
  mode: PresetMode,
  layer: number | 'NATIVE',
): Path =>
  layerBank
    .node('control')
    .node('load')
    .item('slot', slot)
    .item(targetCollection(t), targetKey(t))
    .item('preset', mode)
    .item('layer', layerKey(layer))
    .prop('xRequest')

/** Store a layer memory. */
export const layerMemorySave = (
  slot: number,
  t: Target,
  mode: PresetMode,
  layer: number | 'NATIVE',
): Path =>
  layerBank
    .node('control')
    .node('save')
    .item(targetCollection(t), targetKey(t))
    .item('preset', mode)
    .item('layer', layerKey(layer))
    .item('slot', slot)
    .prop('xRequest')

/** Recall a multiviewer layout onto an output. */
export const monitoringMemoryLoad = (slot: number, output: number): Path =>
  monitoringBank.node('control').node('load').item('slot', slot).item('output', output).prop('xRequest')

/** Store a multiviewer layout. */
export const monitoringMemorySave = (slot: number, output: number): Path =>
  monitoringBank.node('control').node('save').item('output', output).item('slot', slot).prop('xRequest')

/** Take: transition preview to program on one screen or aux. */
export const takePath = (t: Target): Path =>
  DeviceObject.item('screenAuxGroup', targetKey(t)).node('control').prop('xTake')

/** The bank root for a memory's own metadata — its label, and its eraser. */
const bankRoot = (bank: BankKind): Path => {
  switch (bank) {
    case 'screen':
    case 'aux':
      return presetBank
    case 'master':
      return masterBank
    case 'layer':
      return layerBank
    case 'multiviewer':
      return monitoringBank
  }
}

export const memoryLabel = (bank: BankKind, slot: number): Path =>
  bankRoot(bank).item('bank', slot).node('control').prop('label')

export const memoryDelete = (bank: BankKind, slot: number): Path =>
  bankRoot(bank).item('bank', slot).node('control').prop('xDelete')

/** Whether a memory slot holds anything. */
export const memoryIsValid = (bank: BankKind, slot: number): Path =>
  bankRoot(bank).item('bank', slot).node('status').prop('isValid')

// ---------------------------------------------------------------------------
// Live layer parameters
// ---------------------------------------------------------------------------

/**
 * Note the buffer key. These paths take `A`/`B`/`C`, and a command that says
 * "preview" has to be resolved against the current take state before it can
 * name one — see `bufferForMode`.
 */
const layerRoot = (t: Target, buffer: PresetBuffer, layer: number | 'NATIVE'): Path =>
  DeviceObject.item(targetCollection(t), targetKey(t))
    .item('preset', buffer)
    .item('layer', layerKey(layer))

/** Which input a layer is showing. */
export const layerSource = (t: Target, buffer: PresetBuffer, layer: number | 'NATIVE'): Path =>
  layerRoot(t, buffer, layer).node('source').prop('inputNum')

export type PositionProp = 'posH' | 'posV' | 'sizeH' | 'sizeV' | 'anchor'

/** Where a layer is and how big, in pixels, anchored on its centre. */
export const layerPosition = (
  t: Target,
  buffer: PresetBuffer,
  layer: number | 'NATIVE',
  prop: PositionProp,
): Path => layerRoot(t, buffer, layer).node('position').prop(prop)

/** Layer opacity, 0–256. */
export const layerOpacity = (t: Target, buffer: PresetBuffer, layer: number | 'NATIVE'): Path =>
  layerRoot(t, buffer, layer).node('opacity').prop('opacity')

/**
 * Resolve a preset mode to the buffer it currently names.
 *
 * This is the vendor UI's own rule. `transition` says where the group is, and
 * `presetUp`/`presetDown` say which buffer sits at each end — so program is
 * whichever end is currently up, and preview is the other. A take swaps them,
 * and the mapping differs between screens on the same device.
 */
export function bufferForMode(
  mode: PresetMode,
  transition: string,
  presetUp: PresetBuffer,
  presetDown: PresetBuffer,
): PresetBuffer {
  const atUp = transition === 'AT_UP' || transition === 'EFFECT_FROM_UP'
  return mode === 'PROGRAM' ? (atUp ? presetUp : presetDown) : atUp ? presetDown : presetUp
}

// ---------------------------------------------------------------------------
// Screen facts
// ---------------------------------------------------------------------------

/** The screen's canvas in pixels — what a percentage is a percentage of. */
export const screenCanvas = (t: Target, axis: 'sizeH' | 'sizeV'): Path =>
  DeviceObject.item(targetCollection(t), targetKey(t)).node('status').node('size').prop(axis)

export const groupTransition = (t: Target): Path =>
  DeviceObject.item('screenAuxGroup', targetKey(t)).node('status').prop('transition')

export const groupPreset = (t: Target, end: 'presetUp' | 'presetDown'): Path =>
  DeviceObject.item('screenAuxGroup', targetKey(t)).node('control').prop(end)

// ---------------------------------------------------------------------------
// Feedback paths
// ---------------------------------------------------------------------------

/**
 * A recall in flight. The device raises this true then false around the load,
 * which is the only positive confirmation either transport offers.
 */
export const loadIsLoading = (slot: number, t: Target, mode: PresetMode): Path =>
  presetBank
    .node('control')
    .node('load')
    .item('slot', slot)
    .item(targetCollection(t), targetKey(t))
    .item('preset', mode)
    .prop('isLoading')

/**
 * Which memory a preset buffer currently holds.
 *
 * The buffer is keyed `A`/`B`/`C` here, *not* `PREVIEW`/`PROGRAM` — the device
 * keeps three fixed buffers and preview/program are names for whichever is
 * pending or live at the moment. A take swaps which is which, so this must be
 * resolved through the take state before it can be shown against a preset
 * mode the operator typed.
 */
export const presetIdOfBuffer = (t: Target, buffer: 'A' | 'B' | 'C'): Path =>
  presetBank
    .node('status')
    .node('presetId')
    .item(targetCollection(t), targetKey(t))
    .item('preset', buffer)
    .prop('id')

export const presetUnmodified = (t: Target, buffer: 'A' | 'B' | 'C'): Path =>
  presetBank
    .node('status')
    .node('presetId')
    .item(targetCollection(t), targetKey(t))
    .item('preset', buffer)
    .prop('isNotModified')
