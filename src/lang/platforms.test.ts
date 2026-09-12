/**
 * The grammar compiled for the other platform.
 *
 * Every Midra path asserted here was written to the Midra 4K simulator (as a
 * Pulse 4K) or the Alta 4K simulator (as a Zenith 200) over AWJ on 2026-09-12
 * and the store read back showing the effect — a slot going `isValid`, a take
 * flipping `AT_DOWN` to `AT_UP`, a recall landing `memoryId` in the buffer the
 * rule names. The live Pulse 4K (firmware 3.3.10) was read only; its store has
 * the identical shape.
 *
 * The first block pins the thing that matters most: with no platform named,
 * or with LivePremier named, nothing about the existing output moves.
 */

import { describe, expect, it } from 'vitest'

import { compile, type DeviceFacts } from './compile.ts'
import { LIVEPREMIER, MIDRA, midraBufferForMode, platformFor } from './platforms.ts'
import { parse } from './parser.ts'
import { run } from './dialects/index.ts'
import { oscDictionary } from './index.ts'

const awj = (line: string, platform = MIDRA, facts?: DeviceFacts) => {
  const parsed = parse(line, { platform })
  if (!parsed.ok) throw new Error(parsed.errors.map((e) => e.message).join('; '))
  const out = compile(parsed.command, { platform, facts })
  if (!out.ok) throw new Error(out.errors.map((e) => e.message).join('; '))
  return out.ops.map((o) => `${o.path.toAwj()} = ${JSON.stringify(o.value)}`)
}

const refusal = (line: string, platform = MIDRA, facts?: DeviceFacts) => {
  const parsed = parse(line, { platform })
  if (!parsed.ok) return parsed.errors.map((e) => e.message).join('; ')
  const out = compile(parsed.command, { platform, facts })
  if (out.ok) throw new Error(`expected a refusal for ${line}, got ${out.summary}`)
  return out.errors.map((e) => e.message).join('; ')
}

const midraFacts: DeviceFacts = {
  /* Screen 1 at AT_DOWN: program DOWN, preview UP. Screen 2 at AT_UP. */
  buffer: (t, mode) => midraBufferForMode(mode, t.n === 2 ? 'AT_UP' : 'AT_DOWN'),
  canvas: () => ({ w: 1920, h: 1080 }),
}

describe('LivePremier is unchanged by the existence of a second platform', () => {
  const corpus = [
    'Take Screen 1',
    'Take Aux 3',
    'Recall Screen 1 Memory 5',
    'Recall Aux 2 Memory 7 Program',
    'Recall Master Memory 3',
    'Recall Screen 1 Layer 2 Memory 4',
    'Recall Multiviewer 2 Memory 6',
    'Store Screen 1 Memory 5',
    'Store Master 12 If Screen 1 Thru 3 Category Source + Position',
    'Store Master Memory 12',
    'Delete Screen 1 Memory 5',
    'Label Aux 2 Memory 5 "Wide"',
    'Delete Master Memory 2',
    'Set Audio Mute Output 3',
  ]
  const command = (line: string, platform?: typeof LIVEPREMIER) => {
    const parsed = parse(line, { platform })
    if (!parsed.ok) throw new Error(line)
    return parsed.command
  }
  it('compiles the same ops with no platform, and with LivePremier named', () => {
    for (const line of corpus) {
      const plain = compile(command(line))
      const named = compile(command(line, LIVEPREMIER), { platform: LIVEPREMIER })
      expect(named).toEqual(plain)
      expect(plain.ok).toBe(true)
    }
  })
  it('still spells the Aquilon paths', () => {
    expect(awj('Take Screen 1', LIVEPREMIER)).toEqual(['DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true'])
    expect(awj('Recall Screen 1 Memory 5', LIVEPREMIER)).toEqual([
      'DeviceObject/presetBank/control/load/$slot/@items/5/$screen/@items/S1/$preset/@items/PREVIEW/@props/xRequest = true',
    ])
  })
  it('resolves an unknown platform id to LivePremier', () => {
    expect(platformFor(undefined)).toBe(LIVEPREMIER)
    expect(platformFor('nonsense')).toBe(LIVEPREMIER)
    expect(platformFor('midra')).toBe(MIDRA)
  })
})

describe('Midra 4K: takes', () => {
  it('address the transition tree, split by kind', () => {
    expect(awj('Take Screen 1')).toEqual(['DeviceObject/transition/$screen/@items/1/control/@props/xTake = true'])
    expect(awj('Take Aux 2')).toEqual(['DeviceObject/transition/$auxiliaryScreen/@items/2/control/@props/xTake = true'])
    expect(awj('Take Screen 1 Thru 4')).toHaveLength(4)
  })
  it('refuses a screen the platform does not have', () => {
    expect(refusal('Take Screen 5')).toMatch(/out of range.*1 to 4/)
    expect(refusal('Take Aux 5')).toMatch(/out of range.*1 to 4/)
  })
  it('clamps an open range to four', () => {
    expect(awj('Take Screen 2 Thru')).toHaveLength(3)
  })
})

describe('Midra 4K: memories', () => {
  it('recalls from the screen bank, slot first', () => {
    expect(awj('Recall Screen 2 Memory 10 Program')).toEqual([
      'DeviceObject/preset/bank/control/load/$slot/@items/10/$screen/@items/2/$preset/@items/PROGRAM/@props/xRequest = true',
    ])
    expect(awj('Recall Screen 2 Memory 2')).toEqual([
      'DeviceObject/preset/bank/control/load/$slot/@items/2/$screen/@items/2/$preset/@items/PREVIEW/@props/xRequest = true',
    ])
  })
  it('recalls an aux from the aux bank, which is separate here', () => {
    expect(awj('Recall Aux 1 Memory 7')).toEqual([
      'DeviceObject/preset/auxBank/control/load/$slot/@items/7/$auxiliaryScreen/@items/1/$preset/@items/PREVIEW/@props/xRequest = true',
    ])
  })
  it('stores with the slot last, as on LivePremier', () => {
    expect(awj('Store Screen 1 Memory 1')).toEqual([
      'DeviceObject/preset/bank/control/save/$screen/@items/1/$preset/@items/PROGRAM/$slot/@items/1/@props/xRequest = true',
    ])
    expect(awj('Store Aux 1 Memory 7')).toEqual([
      'DeviceObject/preset/auxBank/control/save/$auxiliaryScreen/@items/1/$preset/@items/PROGRAM/$slot/@items/7/@props/xRequest = true',
    ])
  })
  it('labels and deletes under $slot, not $bank', () => {
    expect(awj('Label Screen 1 Memory 1 "Fixture one"')).toEqual(['DeviceObject/preset/bank/$slot/@items/1/control/@props/label = "Fixture one"'])
    expect(awj('Label Aux 1 Memory 7 "Aux seven"')).toEqual(['DeviceObject/preset/auxBank/$slot/@items/7/control/@props/label = "Aux seven"'])
    expect(awj('Delete Master Memory 1')).toEqual(['DeviceObject/preset/masterBank/$slot/@items/1/control/@props/xDelete = true'])
  })
  it('knows the bank sizes', () => {
    expect(refusal('Recall Screen 1 Memory 201')).toMatch(/1 to 200/)
    expect(refusal('Recall Master Memory 51')).toMatch(/1 to 50/)
    expect(awj('Recall Master Memory 50')).toEqual([
      'DeviceObject/preset/masterBank/control/load/$slot/@items/50/$preset/@items/PREVIEW/@props/xRequest = true',
    ])
  })
  it('has no layer bank, and says so', () => {
    expect(refusal('Recall Screen 1 Layer 2 Memory 4')).toMatch(/no layer memory bank/)
    expect(refusal('Store Screen 1 Layer 1 Memory 4')).toMatch(/no layer memory bank/)
  })
  it('has no NATIVE layer', () => {
    expect(refusal('Store Master Memory 3 If Layer Native')).toMatch(/no NATIVE layer/)
  })
})

describe('Midra 4K: master store', () => {
  it('writes the mask in its own properties, wide open, then fires', () => {
    const ops = awj('Store Master Memory 1')
    expect(ops).toEqual([
      'DeviceObject/preset/masterBank/control/save/@props/mode = "SAVE_FROM_PGM"',
      'DeviceObject/preset/masterBank/control/save/@props/screenFilter = ["1","2","3","4"]',
      'DeviceObject/preset/masterBank/control/save/@props/auxFilter = ["1","2","3","4"]',
      'DeviceObject/preset/masterBank/control/save/@props/screenLayerLiveFilter = ["1","2","3","4","5","6","7","8"]',
      'DeviceObject/preset/masterBank/control/save/@props/screenLayerBackFilter = true',
      'DeviceObject/preset/masterBank/control/save/@props/screenLayerTopFilter = true',
      'DeviceObject/preset/masterBank/control/save/@props/screenCategoryFilter = ["SOURCE","POS","SIZE","OPACITY","CROPPING","MASK","BORDER","TRANSITIONS","EFFECTS","FLYING_CURVE","TIMING","SPEED","AUDIO"]',
      'DeviceObject/preset/masterBank/control/save/@props/auxCategoryFilter = ["SOURCE","ASPECT","TRANSITIONS","AUDIO"]',
      'DeviceObject/preset/masterBank/control/save/$slot/@items/1/@props/xRequest = true',
    ])
  })
  it('masks with the platform\'s own keys', () => {
    const ops = awj('Store Master Memory 2 Preview If Screen 1 + 2 Layer 1 Category Source + Position')
    expect(ops[0]).toMatch(/SAVE_FROM_PRW/)
    expect(ops[1]).toMatch(/screenFilter = \["1","2"\]/)
    expect(ops[3]).toMatch(/screenLayerLiveFilter = \["1"\]/)
    expect(ops[6]).toMatch(/screenCategoryFilter = \["SOURCE","POS"\]/)
    /* Position is not an aux category; the aux side keeps what applies. */
    expect(ops[7]).toMatch(/auxCategoryFilter = \["SOURCE"\]/)
  })
  it('refuses a category the platform has no mask for', () => {
    expect(refusal('Store Master Memory 2 If Category Keyer')).toMatch(/no KEYER category/)
    expect(refusal('Store Master Memory 2 If Category CutAndFill')).toMatch(/no CUT_AND_FILL category/)
  })
})

describe('Midra 4K: multiviewer', () => {
  it('has one multiviewer with twenty layouts, addressed without an output', () => {
    expect(awj('Recall Multiviewer 1 Memory 6')).toEqual(['DeviceObject/multiviewer/$bank/control/load/$slot/@items/6/@props/xRequest = true'])
    expect(awj('Store Multiviewer 1 Memory 6')).toEqual(['DeviceObject/multiviewer/$bank/control/save/$slot/@items/6/@props/xRequest = true'])
    expect(awj('Label Multiviewer 1 Memory 6 "Wall"')).toEqual(['DeviceObject/multiviewer/$bank/@items/6/control/@props/label = "Wall"'])
    expect(refusal('Recall Multiviewer 2 Memory 6')).toMatch(/out of range.*1 to 1/)
    expect(refusal('Recall Multiviewer 1 Memory 21')).toMatch(/1 to 20/)
  })
})

describe('Midra 4K: live layer parameters', () => {
  it('address $liveLayer in the UP/DOWN buffer the take state names', () => {
    /* Screen 1 is AT_DOWN in the facts, so preview is UP. */
    expect(awj('Set Screen 1 Layer 1 Source 7', MIDRA, midraFacts)).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/source/@props/input = "INPUT_7"',
    ])
    expect(awj('Set Screen 1 Layer 1 Source 7 Program', MIDRA, midraFacts)).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/DOWN/$liveLayer/@items/1/source/@props/input = "INPUT_7"',
    ])
    /* Screen 2 is AT_UP: preview is DOWN. */
    expect(awj('Set Screen 2 Layer 2 Source 3', MIDRA, midraFacts)[0]).toMatch(/\$preset\/@items\/DOWN\//)
  })
  it('splits size from position, and keeps the LivePremier units', () => {
    expect(awj('Set Screen 1 Layer 1 Size 960 540 Position 50% 50% Opacity 50%', MIDRA, midraFacts)).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/size/@props/sizeH = 960',
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/size/@props/sizeV = 540',
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/position/@props/posH = 960',
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/position/@props/posV = 540',
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/opacity/@props/opacity = 128',
    ])
  })
  it('refuses the inputs and stills the platform does not have', () => {
    expect(refusal('Set Screen 1 Layer 1 Source 17', MIDRA, midraFacts)).toMatch(/inputs are 1 to 16/)
    expect(refusal('Set Screen 1 Layer 1 Source Still 2', MIDRA, midraFacts)).toMatch(/no still store on a layer/)
    expect(refusal('Set Screen 1 Layer 9 Source 1', MIDRA, midraFacts)).toMatch(/out of range.*1 to 8/)
  })
  it('sets an aux source without a layer, because an aux has none', () => {
    expect(awj('Set Aux 1 Source 5', MIDRA, midraFacts)).toEqual([
      'DeviceObject/$auxiliaryScreen/@items/1/$preset/@items/UP/background/source/@props/content = "INPUT_5"',
    ])
    expect(refusal('Set Aux 1 Size 100', MIDRA, midraFacts)).toMatch(/source and nothing else/)
    /* A screen still needs its layer named. */
    expect(refusal('Set Screen 1 Source 5', MIDRA, midraFacts)).toMatch(/needs a Layer/)
  })
  it('still refuses without the take state', () => {
    expect(refusal('Set Screen 1 Layer 1 Source 7')).toMatch(/live connection/)
  })
})

describe('Midra 4K: audio', () => {
  it('has no LivePremier audio matrix', () => {
    expect(refusal('Set Audio Mute Output 3')).toMatch(/matrix/)
  })
})

describe('Midra 4K: the program buffer follows the transition suffix', () => {
  it('names UP for the up states and DOWN otherwise', () => {
    for (const s of ['AT_UP', 'EFFECT_FROM_UP', 'COPY_FROM_UP']) {
      expect(midraBufferForMode('PROGRAM', s)).toBe('UP')
      expect(midraBufferForMode('PREVIEW', s)).toBe('DOWN')
    }
    for (const s of ['AT_DOWN', 'EFFECT_FROM_DOWN', 'COPY_FROM_DOWN']) {
      expect(midraBufferForMode('PROGRAM', s)).toBe('DOWN')
      expect(midraBufferForMode('PREVIEW', s)).toBe('UP')
    }
  })
})

describe('Midra 4K: the other languages through run()', () => {
  const ctx = { platform: MIDRA, osc: { buffer: midraFacts.buffer } }
  const ops = (line: string) => {
    const r = run(line, ctx)
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join('; '))
    return r.ops.map((o) => `${o.path.toAwj()} = ${JSON.stringify(o.value)}`)
  }
  const why = (line: string) => {
    const r = run(line, ctx)
    if (r.ok) throw new Error(`expected a refusal for ${line}`)
    return r.errors.map((e) => e.message).join('; ')
  }

  it('Mynah through run() takes the platform', () => {
    expect(ops('Take Screen 1')).toEqual(['DeviceObject/transition/$screen/@items/1/control/@props/xTake = true'])
    expect(why('Take Screen 9')).toMatch(/1 to 4/)
  })
  it('OSC takes, cuts and fades address the transition tree', () => {
    expect(ops('/lp/screen/1/take')).toEqual(['DeviceObject/transition/$screen/@items/1/control/@props/xTake = true'])
    expect(ops('/lp/aux/2/cut')).toEqual(['DeviceObject/transition/$auxiliaryScreen/@items/2/control/@props/xCut = true'])
    expect(ops('/lp/screen/1/group/control/takeTime 25')).toEqual(['DeviceObject/transition/$screen/@items/1/control/@props/takeTime = 25'])
    expect(why('/lp/screen/1/group/control/takeUpTime 25')).toMatch(/no screen group parameter/)
  })
  it('OSC memories go to the right bank', () => {
    expect(ops('/lp/screen/1/memory/10/recall/program')).toEqual([
      'DeviceObject/preset/bank/control/load/$slot/@items/10/$screen/@items/1/$preset/@items/PROGRAM/@props/xRequest = true',
    ])
    expect(ops('/lp/aux/1/memory/7/store')).toEqual([
      'DeviceObject/preset/auxBank/control/save/$auxiliaryScreen/@items/1/$preset/@items/PROGRAM/$slot/@items/7/@props/xRequest = true',
    ])
    expect(why('/lp/screen/1/layer/1/memory/3/recall')).toMatch(/no layer memory bank/)
    expect(ops('/lp/multiviewer/1/memory/4/recall')).toEqual(['DeviceObject/multiviewer/$bank/control/load/$slot/@items/4/@props/xRequest = true'])
  })
  it('OSC layer parameters use the Midra table and the UP/DOWN literals', () => {
    expect(ops('/lp/screen/1/preset/preview/layer/1/source/input INPUT_3')).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/source/@props/input = "INPUT_3"',
    ])
    expect(ops('/lp/screen/1/preset/down/layer/2/size/sizeH 1280')).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/DOWN/$liveLayer/@items/2/size/@props/sizeH = 1280',
    ])
    expect(ops('/lp/screen/1/preset/up/layer/1/opacity/opacity/norm 0.5')).toEqual([
      'DeviceObject/$screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/opacity/@props/opacity = 128',
    ])
    expect(why('/lp/screen/1/preset/a/layer/1/opacity/opacity 100')).toMatch(/not a preset/)
    expect(why('/lp/screen/1/preset/up/layer/1/position/sizeH 100')).toMatch(/no layer parameter/)
    expect(why('/lp/screen/1/preset/up/layer/native/opacity/opacity 100')).toMatch(/no NATIVE layer/)
  })
  it('the dictionary is published per platform', () => {
    const lp = oscDictionary()
    const midra = oscDictionary(undefined, MIDRA)
    expect(lp.some((e) => e.address.includes('/layer/{l}/memory/'))).toBe(true)
    expect(midra.some((e) => e.address.includes('/layer/{l}/memory/'))).toBe(false)
    expect(midra.some((e) => e.address.includes('{preview|program|up|down}'))).toBe(true)
    expect(midra.some((e) => e.address.endsWith('/source/input'))).toBe(true)
    expect(midra.some((e) => e.address.endsWith('/control/takeUpTime'))).toBe(false)
  })
})
