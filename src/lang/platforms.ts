/**
 * The two Analog Way platforms the grammar can be compiled for.
 *
 * `model.ts` is the LivePremier object model, and it stays exactly what it is:
 * every builder in it was read off an Aquilon and is referenced by name across
 * this repo. What this file adds is the *second* spelling — Midra 4K and
 * Alta 4K, which run the other Web RCS code family (`mng-platform`) — and one
 * interface over both, so the compiler and the OSC resolver can be told which
 * switcher is on the other end instead of assuming.
 *
 * ## The same grammar, a different tree
 *
 * An operator types `Recall Screen 1 Memory 5` on either box. What differs is
 * where that lands:
 *
 *   LivePremier  presetBank/control/load/$slot/@items/5/$screen/@items/S1/$preset/@items/PREVIEW/@props/xRequest
 *   Midra 4K     preset/bank/control/load/$slot/@items/5/$screen/@items/1/$preset/@items/PREVIEW/@props/xRequest
 *
 * The differences are not cosmetic renames, and each one below was read off a
 * live Pulse 4K (firmware 3.3.10) or the Midra 4K simulator (3.2.29), whose
 * stores have the identical shape for everything named here:
 *
 * - Screens are `1`..`4` and auxes `1`..`4`, in **two lists** — `$screen` and
 *   `$auxiliaryScreen` — where LivePremier keys both `S1`/`A1` and folds takes
 *   into one `$screenAuxGroup`. Screen 1 and aux 1 are both keyed `1`.
 * - Takes live under a top-level `transition` node, with one `takeTime`
 *   rather than a `takeUpTime`/`takeDownTime` pair.
 * - Memories: `preset/bank` (screens, 200 slots), `preset/auxBank` (auxes,
 *   200 — a bank of its own), `preset/masterBank` (50). **There is no layer
 *   bank.** Slot metadata is under `$slot`, not `$bank`.
 * - The preset buffers are literally `UP` and `DOWN`, not `A`/`B`/`C`, and
 *   which is program follows from the transition status alone.
 * - A layer is `$liveLayer/@items/1..8`, its source is `source/@props/input`
 *   (`INPUT_<n>`, `NONE`, `COLOR` — no stills), and size is its own node
 *   rather than part of `position`.
 * - A master store's record mask is spelled differently and split by kind:
 *   `screenCategoryFilter`/`auxCategoryFilter`, `screenLayerLiveFilter` plus
 *   two booleans for the top and background layers.
 * - One multiviewer, 20 layout memories, addressed without an output.
 * - No audio matrix of the LivePremier shape.
 *
 * ## Nothing here is gated on a model name
 *
 * A host says which platform it is talking to — it has the device store and
 * can tell — and gets paths spelled for it. `LIVEPREMIER` is the default
 * everywhere, so every existing caller compiles exactly what it always did.
 */

import {
  DIMS as LP_DIMS,
  SLOTS as LP_SLOTS,
  CATEGORIES as LP_CATEGORIES,
  LAYER as LP_LAYER,
  SOURCES as LP_SOURCES,
  auxKey,
  screenKey,
  layerKey,
  layerMemoryLoad,
  layerMemorySave,
  layerOpacity,
  layerParamPath,
  layerPosition,
  layerSource,
  masterMemoryLoad,
  masterMemorySave,
  masterSaveProp,
  memoryDelete,
  memoryLabel,
  monitoringMemoryLoad,
  monitoringMemorySave,
  screenGroupParamPath,
  screenMemoryLoad,
  screenMemorySave,
  takePath,
  type BankKind,
  type PresetMode,
  type Target,
} from './model.ts'
import { DeviceObject, Path } from './paths.ts'
import { BUILTIN_MIDRA_PARAMS, BUILTIN_PARAMS, type ParamTable } from './dialects/params.ts'

export type PlatformId = 'livepremier' | 'midra'

export interface Range {
  readonly min: number
  readonly max: number
}

/** One filter write of a master store, in the platform's own property. */
export interface MasterFilterWrite {
  readonly prop: string
  readonly value: unknown
  readonly describe: string
}

/** The `If` clause as the parser hands it over, already resolved to numbers. */
export interface MasterFilter {
  readonly screens?: readonly number[]
  readonly auxes?: readonly number[]
  readonly layers?: { readonly native: boolean; readonly numbers: readonly number[] }
  readonly categories?: readonly string[]
}

export type GeometryProp = 'posH' | 'posV' | 'sizeH' | 'sizeV'

export interface PlatformPaths {
  take(t: Target): Path
  /** A property of the take/transition group: `xCut`, `takeTime`… */
  transitionProp(t: Target, prop: string): Path
  /** The same, addressed by a store tail out of a parameter table. */
  transitionParam(t: Target, tail: readonly string[]): Path

  screenMemoryLoad(slot: number, t: Target, mode: PresetMode): Path
  screenMemorySave(slot: number, t: Target, mode: PresetMode): Path
  masterMemoryLoad(slot: number, mode: PresetMode): Path
  masterMemorySave(slot: number): Path
  masterSaveProp(prop: string): Path
  /** Undefined on a platform with no layer bank. */
  layerMemoryLoad?(slot: number, t: Target, mode: PresetMode, layer: number | 'NATIVE'): Path
  layerMemorySave?(slot: number, t: Target, mode: PresetMode, layer: number | 'NATIVE'): Path
  /** `output` is ignored on a platform with one multiviewer. */
  monitoringMemoryLoad(slot: number, output: number): Path
  monitoringMemorySave(slot: number, output: number): Path
  memoryLabel(bank: BankKind, slot: number): Path
  memoryDelete(bank: BankKind, slot: number): Path

  /** Which input a layer shows. `buffer` is a platform buffer key. */
  layerSource(t: Target, buffer: string, layer: number | 'NATIVE'): Path
  layerGeometry(t: Target, buffer: string, layer: number | 'NATIVE', prop: GeometryProp): Path
  layerOpacity(t: Target, buffer: string, layer: number | 'NATIVE'): Path
  /** A layer property addressed by a store tail out of a parameter table. */
  layerParam(t: Target, buffer: string, layer: number | 'NATIVE', tail: readonly string[]): Path
  /**
   * The source of a destination that has no layers to name — an auxiliary
   * screen on Midra, whose preset is a single background source. Undefined
   * where every destination has layers.
   */
  destinationSource?(t: Target, buffer: string): Path
}

export interface Platform {
  readonly id: PlatformId
  readonly name: string
  readonly dims: { readonly screen: Range; readonly aux: Range; readonly layer: Range; readonly multiviewer: Range }
  /** A bank absent here does not exist on this platform. */
  readonly slots: Readonly<Partial<Record<BankKind, Range>>>
  /** `NATIVE` is an addressable layer slot on LivePremier and nothing on Midra. */
  readonly nativeLayer: boolean
  /** The record-mask categories this platform's banks understand. */
  readonly categories: readonly string[]
  /** The preset buffer keys a live layer path takes. */
  readonly buffers: readonly string[]
  readonly layer: {
    readonly opacityMax: number
    readonly positionMin: number
    readonly positionMax: number
    readonly sizeMin: number
    readonly sizeMax: number
  }
  /** How many live inputs and stills a layer source can name. 0 = none. */
  readonly sources: { readonly live: number; readonly still: number }
  /** Whether the audio-matrix grammar addresses anything here. */
  readonly audio: boolean
  /** The parameter table the OSC resolver falls back to when a host passes none. */
  readonly builtinParams: ParamTable
  readonly paths: PlatformPaths
  /**
   * The filter writes a master store needs, wide open where the operator
   * masked nothing. The compiler owns the order — filters, then the trigger —
   * and the platform owns the spelling.
   */
  masterFilterWrites(filter: MasterFilter | undefined): readonly MasterFilterWrite[]
  /**
   * The source enum value for a family and number, or an error message
   * starting with `!`. Kept per platform because the families differ:
   * LivePremier has `LIVE_n` and `STILL_n`, Midra `INPUT_n` and no stills.
   */
  sourceValue(family: 'live' | 'still' | 'none' | 'colour', n?: number): string
}

/* ============================================================ LivePremier */

const range = (min: number, max: number, key: (n: number) => string): string[] => {
  const out: string[] = []
  for (let n = min; n <= max; n++) out.push(key(n))
  return out
}

/**
 * LivePremier — `model.ts`, wrapped. Every path here is the existing builder,
 * so a caller that names no platform gets what it always got.
 */
export const LIVEPREMIER: Platform = {
  id: 'livepremier',
  name: 'LivePremier',
  dims: LP_DIMS,
  slots: LP_SLOTS,
  nativeLayer: true,
  categories: LP_CATEGORIES,
  buffers: ['A', 'B', 'C'],
  layer: LP_LAYER,
  sources: { live: LP_SOURCES.live, still: LP_SOURCES.still },
  audio: true,
  builtinParams: BUILTIN_PARAMS,
  paths: {
    take: takePath,
    transitionProp: (t, prop) => DeviceObject.item('screenAuxGroup', targetKeyLp(t)).node('control').prop(prop),
    transitionParam: screenGroupParamPath,
    screenMemoryLoad,
    screenMemorySave,
    masterMemoryLoad,
    masterMemorySave,
    masterSaveProp: (prop) => masterSaveProp(prop as Parameters<typeof masterSaveProp>[0]),
    layerMemoryLoad,
    layerMemorySave,
    monitoringMemoryLoad,
    monitoringMemorySave,
    memoryLabel,
    memoryDelete,
    layerSource: (t, buffer, layer) => layerSource(t, buffer as 'A' | 'B' | 'C', layer),
    layerGeometry: (t, buffer, layer, prop) => layerPosition(t, buffer as 'A' | 'B' | 'C', layer, prop),
    layerOpacity: (t, buffer, layer) => layerOpacity(t, buffer as 'A' | 'B' | 'C', layer),
    layerParam: (t, buffer, layer, tail) => layerParamPath(t, buffer as 'A' | 'B' | 'C', layer, tail),
  },
  masterFilterWrites(filter) {
    const screens = filter?.screens ? filter.screens.map(screenKey) : range(LP_DIMS.screen.min, LP_DIMS.screen.max, screenKey)
    const auxes = filter?.auxes ? filter.auxes.map(auxKey) : range(LP_DIMS.aux.min, LP_DIMS.aux.max, auxKey)
    const layers = filter?.layers
      ? [...(filter.layers.native ? ['NATIVE'] : []), ...filter.layers.numbers.map(String)]
      : ['NATIVE', ...range(LP_DIMS.layer.min, LP_DIMS.layer.max, String)]
    const categories = filter?.categories ?? LP_CATEGORIES
    return [
      { prop: 'screenFilter', value: screens, describe: filter?.screens ? `Only ${screens.join(', ')}` : 'All screens' },
      { prop: 'auxFilter', value: auxes, describe: filter?.auxes ? `Only ${auxes.join(', ')}` : 'All auxes' },
      { prop: 'layerFilter', value: layers, describe: filter?.layers ? `Only layer ${layers.join(', ')}` : 'All layers' },
      { prop: 'categoryFilter', value: [...categories], describe: filter?.categories ? `Only ${categories.join(', ')}` : 'All categories' },
    ]
  },
  sourceValue(family, n) {
    switch (family) {
      case 'none':
        return 'NONE'
      case 'colour':
        return 'COLOR'
      case 'still':
        return n !== undefined && n >= 1 && n <= LP_SOURCES.still
          ? `STILL_${n}`
          : `!Still ${n} is out of range — stills are 1 to ${LP_SOURCES.still}`
      case 'live':
        return n !== undefined && n >= 1 && n <= LP_SOURCES.live
          ? `LIVE_${n}`
          : `!Source ${n} is out of range — live inputs are 1 to ${LP_SOURCES.live}`
    }
  },
}

const targetKeyLp = (t: Target) => (t.kind === 'screen' ? screenKey(t.n) : auxKey(t.n))

/* ================================================================= Midra */

/**
 * Midra 4K and Alta 4K.
 *
 * Verified on the Midra 4K simulator as a Pulse 4K and the Alta 4K simulator
 * as a Zenith 200 on 2026-09-12: every path below was written over AWJ and
 * the store read back showing the effect — a saved slot going `isValid`, a
 * take flipping `AT_DOWN` to `AT_UP`, a recall landing `memoryId` in the
 * buffer the rule names. The live Pulse 4K was read only.
 */

/** Live inputs on the range. QuickVu has fewer fitted, but the enum is 16. */
const MIDRA_INPUTS = 16

const MIDRA_CATEGORIES = [
  'SOURCE',
  'POS',
  'SIZE',
  'OPACITY',
  'CROPPING',
  'MASK',
  'BORDER',
  'TRANSITIONS',
  'EFFECTS',
  'FLYING_CURVE',
  'TIMING',
  'SPEED',
  'AUDIO',
] as const

/** The aux bank's own, smaller, category set. */
const MIDRA_AUX_CATEGORIES = ['SOURCE', 'ASPECT', 'TRANSITIONS', 'AUDIO'] as const

const MIDRA_DIMS = {
  screen: { min: 1, max: 4 },
  aux: { min: 1, max: 4 },
  layer: { min: 1, max: 8 },
  multiviewer: { min: 1, max: 1 },
} as const

const MIDRA_SLOTS = {
  screen: { min: 1, max: 200 },
  aux: { min: 1, max: 200 },
  master: { min: 1, max: 50 },
  multiviewer: { min: 1, max: 20 },
} as const

/** `$screen/@items/1` or `$auxiliaryScreen/@items/1`. */
const midraCollection = (t: Target) => (t.kind === 'screen' ? 'screen' : 'auxiliaryScreen')
const midraDest = (t: Target): Path => DeviceObject.item(midraCollection(t), t.n)

const midraPreset = DeviceObject.node('preset')
const midraBank = midraPreset.node('bank')
const midraAuxBank = midraPreset.node('auxBank')
const midraMasterBank = midraPreset.node('masterBank')
const midraMtvw = DeviceObject.node('multiviewer')
/*
 * The multiviewer's layout bank is a collection whose node ALSO carries the
 * load/save controls — `multiviewer/bankList/control/load/…` beside
 * `multiviewer/bankList/items/…`. A collection with a child that is not an
 * item has no builder, so the control root is read back from its store
 * spelling.
 */
const midraMtvwControl = Path.fromWs(['device', 'multiviewer', 'bankList', 'control'])

/** The bank a screen or aux memory lives in: two banks here, one on LivePremier. */
const midraBankFor = (t: Target): Path => (t.kind === 'screen' ? midraBank : midraAuxBank)

const midraBankRoot = (bank: BankKind): Path => {
  switch (bank) {
    case 'screen':
      return midraBank
    case 'aux':
      return midraAuxBank
    case 'master':
      return midraMasterBank
    case 'multiviewer':
      return midraMtvw
    case 'layer':
      throw new Error('Midra 4K has no layer memory bank')
  }
}

const midraLayer = (t: Target, buffer: string, layer: number | 'NATIVE'): Path =>
  midraDest(t).item('preset', buffer).item('liveLayer', layerKey(layer))

export const MIDRA: Platform = {
  id: 'midra',
  name: 'Midra 4K / Alta 4K',
  dims: MIDRA_DIMS,
  slots: MIDRA_SLOTS,
  nativeLayer: false,
  categories: MIDRA_CATEGORIES,
  buffers: ['UP', 'DOWN'],
  /*
   * Off the bundle's own attribute tables: a live layer's position spans
   * −67268..67268 and its size 0..65535, opacity 0..256 as on LivePremier.
   */
  layer: {
    opacityMax: 256,
    positionMin: -67_268,
    positionMax: 67_268,
    sizeMin: 0,
    sizeMax: 65_535,
  },
  sources: { live: MIDRA_INPUTS, still: 0 },
  audio: false,
  builtinParams: BUILTIN_MIDRA_PARAMS,
  paths: {
    take: (t) => DeviceObject.node('transition').item(midraCollection(t), t.n).node('control').prop('xTake'),
    transitionProp: (t, prop) =>
      DeviceObject.node('transition').item(midraCollection(t), t.n).node('control').prop(prop),
    transitionParam: (t, tail) => appendTail(DeviceObject.node('transition').item(midraCollection(t), t.n), tail),

    /* Slot first on a load, last on a save — the same asymmetry as LivePremier. */
    screenMemoryLoad: (slot, t, mode) =>
      midraBankFor(t).node('control').node('load').item('slot', slot).item(midraCollection(t), t.n).item('preset', mode).prop('xRequest'),
    screenMemorySave: (slot, t, mode) =>
      midraBankFor(t).node('control').node('save').item(midraCollection(t), t.n).item('preset', mode).item('slot', slot).prop('xRequest'),
    masterMemoryLoad: (slot, mode) =>
      midraMasterBank.node('control').node('load').item('slot', slot).item('preset', mode).prop('xRequest'),
    masterMemorySave: (slot) => midraMasterBank.node('control').node('save').item('slot', slot).prop('xRequest'),
    masterSaveProp: (prop) => midraMasterBank.node('control').node('save').prop(prop),
    /* One multiviewer, so no output in the path; the argument is accepted and ignored. */
    monitoringMemoryLoad: (slot) => midraMtvwControl.node('load').item('slot', slot).prop('xRequest'),
    monitoringMemorySave: (slot) => midraMtvwControl.node('save').item('slot', slot).prop('xRequest'),
    /* Slot metadata is `$slot/@items/n` in the preset banks and `$bank/@items/n`
       in the multiviewer's — the collection names differ. */
    memoryLabel: (bank, slot) =>
      (bank === 'multiviewer' ? midraMtvw.item('bank', slot) : midraBankRoot(bank).item('slot', slot)).node('control').prop('label'),
    memoryDelete: (bank, slot) =>
      (bank === 'multiviewer' ? midraMtvw.item('bank', slot) : midraBankRoot(bank).item('slot', slot)).node('control').prop('xDelete'),

    layerSource: (t, buffer, layer) => midraLayer(t, buffer, layer).node('source').prop('input'),
    /* Size is its own node here, where LivePremier keeps it under position. */
    layerGeometry: (t, buffer, layer, prop) =>
      midraLayer(t, buffer, layer).node(prop.startsWith('size') ? 'size' : 'position').prop(prop),
    layerOpacity: (t, buffer, layer) => midraLayer(t, buffer, layer).node('opacity').prop('opacity'),
    layerParam: (t, buffer, layer, tail) => appendTail(midraLayer(t, buffer, layer), tail),
    /* An aux preset is one background source, addressed without a layer. */
    destinationSource: (t, buffer) =>
      midraDest(t).item('preset', buffer).node('background').node('source').prop(t.kind === 'aux' ? 'content' : 'set'),
  },
  masterFilterWrites(filter) {
    const key = (n: number) => String(n)
    const screens = filter?.screens ? filter.screens.map(key) : range(MIDRA_DIMS.screen.min, MIDRA_DIMS.screen.max, key)
    const auxes = filter?.auxes ? filter.auxes.map(key) : range(MIDRA_DIMS.aux.min, MIDRA_DIMS.aux.max, key)
    const layers = filter?.layers ? filter.layers.numbers.map(key) : range(MIDRA_DIMS.layer.min, MIDRA_DIMS.layer.max, key)
    const categories = filter?.categories ?? MIDRA_CATEGORIES
    /* The aux bank has four categories of its own; a mask that names none of
       them leaves the aux side wide open rather than empty. */
    const auxCategories = filter?.categories
      ? filter.categories.filter((c) => (MIDRA_AUX_CATEGORIES as readonly string[]).includes(c))
      : MIDRA_AUX_CATEGORIES
    return [
      { prop: 'screenFilter', value: screens, describe: filter?.screens ? `Only screen ${screens.join(', ')}` : 'All screens' },
      { prop: 'auxFilter', value: auxes, describe: filter?.auxes ? `Only aux ${auxes.join(', ')}` : 'All auxes' },
      { prop: 'screenLayerLiveFilter', value: layers, describe: filter?.layers ? `Only layer ${layers.join(', ')}` : 'All layers' },
      /* The background and top planes are layers to this bank too; a mask
         that names live layers keeps them, because "only layer 2" does not
         mean "and drop the background". */
      { prop: 'screenLayerBackFilter', value: true, describe: 'Background layer' },
      { prop: 'screenLayerTopFilter', value: true, describe: 'Top layer' },
      { prop: 'screenCategoryFilter', value: [...categories], describe: filter?.categories ? `Only ${categories.join(', ')}` : 'All categories' },
      { prop: 'auxCategoryFilter', value: auxCategories.length ? [...auxCategories] : [...MIDRA_AUX_CATEGORIES], describe: filter?.categories ? `Aux: ${(auxCategories.length ? auxCategories : MIDRA_AUX_CATEGORIES).join(', ')}` : 'All aux categories' },
    ]
  },
  sourceValue(family, n) {
    switch (family) {
      case 'none':
        return 'NONE'
      case 'colour':
        return 'COLOR'
      case 'still':
        return '!This platform has no still store on a layer — stills are background frames here, set from the Images page'
      case 'live':
        return n !== undefined && n >= 1 && n <= MIDRA_INPUTS
          ? `INPUT_${n}`
          : `!Source ${n} is out of range — inputs are 1 to ${MIDRA_INPUTS}`
    }
  },
}

/**
 * Which of UP and DOWN a preset mode names, from the transition status.
 *
 * The vendor's own rule, read out of the Web RCS bundle and confirmed by
 * behaviour on the simulator: PROGRAM is `UP` while the status ends in `UP`
 * (`AT_UP`, `EFFECT_FROM_UP`, `COPY_FROM_UP`) and `DOWN` otherwise; PREVIEW
 * is the other. The same suffix rule LivePremier applies to its letters —
 * there the end names a letter through `presetUp`/`presetDown`, here the
 * buffers are named for the ends.
 */
export function midraBufferForMode(mode: PresetMode, transition: string): 'UP' | 'DOWN' {
  const up = String(transition ?? '').endsWith('UP')
  return mode === 'PROGRAM' ? (up ? 'UP' : 'DOWN') : up ? 'DOWN' : 'UP'
}

/** Walk a store-spelled tail onto a path — `pp` introduces a property. */
function appendTail(base: Path, tail: readonly string[]): Path {
  let path = base
  for (let i = 0; i < tail.length; i++) {
    if (tail[i] === 'pp') {
      const name = tail[++i]
      if (name === undefined) throw new Error('parameter tail ends at pp with no property')
      path = path.prop(name)
    } else {
      path = path.node(tail[i])
    }
  }
  return path
}

export const PLATFORMS: readonly Platform[] = [LIVEPREMIER, MIDRA]

/** The platform for an id, or LivePremier for anything unrecognised. */
export const platformFor = (id: string | undefined | null): Platform =>
  PLATFORMS.find((p) => p.id === id) ?? LIVEPREMIER
