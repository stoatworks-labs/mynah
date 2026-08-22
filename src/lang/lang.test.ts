import { describe, expect, it } from 'vitest'

import { KEYWORDS, resolveKeyword, shortestForm } from './keywords.ts'
import { parse } from './parser.ts'
import { compile, type Selection } from './compile.ts'

/** Parse and compile in one step, failing loudly so tests read as assertions. */
function run(input: string, selection?: Selection) {
  const parsed = parse(input)
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errors.map((e) => e.message).join('; ')}`)
  const compiled = compile(parsed.command, { selection })
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.errors.map((e) => e.message).join('; ')}`)
  return compiled
}

function awjPaths(input: string, selection?: Selection) {
  return run(input, selection).ops.map((o) => o.path.toAwj())
}

/** Assert an op targets a given AWJ path. */
function assertPath(op: { path: { toAwj(): string } }, expected: string) {
  expect(op.path.toAwj()).toBe(expected)
}

function errorOf(input: string, selection?: Selection): string {
  const parsed = parse(input)
  if (!parsed.ok) return parsed.errors.map((e) => e.message).join('; ')
  const compiled = compile(parsed.command, { selection })
  if (!compiled.ok) return compiled.errors.map((e) => e.message).join('; ')
  throw new Error(`expected "${input}" to fail, but it compiled`)
}

// ---------------------------------------------------------------------------

describe('keyword abbreviation', () => {
  it('resolves every keyword from its computed shortest form', () => {
    for (const k of KEYWORDS) {
      const short = shortestForm(k.word)
      const res = resolveKeyword(short)
      expect(res.ok, `${k.word} → "${short}" did not resolve`).toBe(true)
      if (res.ok) expect(res.keyword.word, `"${short}" resolved to the wrong keyword`).toBe(k.word)
    }
  })

  it('resolves a full word even when it prefixes a longer one', () => {
    // "Mas" is shared with Master, so Mask has no abbreviation — but typing it
    // in full must still reach Mask rather than being called ambiguous.
    const res = resolveKeyword('Mask')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.keyword.word).toBe('Mask')
    expect(shortestForm('Mask')).toBe('Mask')
    expect(shortestForm('Master')).toBe('Mast')
  })

  it('reports an ambiguous prefix with its candidates rather than as unknown', () => {
    const res = resolveKeyword('S')
    expect(res.ok).toBe(false)
    if (!res.ok && res.reason === 'ambiguous') {
      expect(res.candidates.length).toBeGreaterThan(1)
      expect(res.candidates.map((c) => c.word)).toContain('Screen')
      expect(res.candidates.map((c) => c.word)).toContain('Store')
    } else {
      throw new Error('expected an ambiguous resolution')
    }
  })

  it('is case-insensitive', () => {
    expect(awjPaths('recall screen 1 memory 5')).toEqual(awjPaths('Recall Screen 1 Memory 5'))
  })
})

// ---------------------------------------------------------------------------

describe('ranges', () => {
  it('expands Thru inclusively', () => {
    expect(awjPaths('Recall Screen 1 Thru 4 Memory 5')).toHaveLength(4)
  })

  it('unions with + and subtracts with -', () => {
    const ops = run('Take Screen 1 Thru 8 - 5').ops
    expect(ops).toHaveLength(7)
    expect(ops.some((o) => o.path.toAwj().includes('/S5/'))).toBe(false)
  })

  it('applies - to everything accumulated so far, left to right', () => {
    const ops = run('Take Screen 1 Thru 4 + 8 - 2').ops
    const keys = ops.map((o) => o.path.toAwj().match(/@items\/(S\d+)/)![1])
    expect(keys).toEqual(['S1', 'S3', 'S4', 'S8'])
  })

  it('runs an open-ended Thru to the top of the dimension', () => {
    expect(awjPaths('Take Screen 20 Thru')).toHaveLength(5) // S20..S24
  })

  it('runs a leading Thru from the bottom of the dimension', () => {
    expect(awjPaths('Take Screen Thru 3')).toHaveLength(3) // S1..S3
  })

  it('rejects an out-of-range member rather than silently dropping it', () => {
    expect(errorOf('Take Screen 1 Thru 25')).toMatch(/out of range/)
  })
})

// ---------------------------------------------------------------------------

describe('paths', () => {
  it('builds the verified screen-memory recall path', () => {
    expect(awjPaths('Recall Screen 1 Memory 5 Preview')).toEqual([
      'DeviceObject/presetBank/control/load/$slot/@items/5/$screen/@items/S1/$preset/@items/PREVIEW/@props/xRequest',
    ])
  })

  it('addresses a save target-first and a load slot-first', () => {
    expect(awjPaths('Store Screen 1 Memory 5 Program')).toEqual([
      'DeviceObject/presetBank/control/save/$screen/@items/S1/$preset/@items/PROGRAM/$slot/@items/5/@props/xRequest',
    ])
  })

  it('builds the verified layer-memory path', () => {
    expect(awjPaths('Store Screen 3 Layer 2 Memory 7 Program')).toEqual([
      'DeviceObject/layerBank/control/save/$screen/@items/S3/$preset/@items/PROGRAM/$layer/@items/2/$slot/@items/7/@props/xRequest',
    ])
  })

  it('routes an Aux into the auxiliary collection, not the screen one', () => {
    expect(awjPaths('Recall Aux 2 Memory 5')[0]).toContain('$auxiliary/@items/A2')
  })

  it('renders the same path for the WebSocket store spelling', () => {
    const [op] = run('Recall Screen 1 Memory 5 Preview').ops
    expect(op.path.toWs()).toEqual([
      'device', 'presetBank', 'control', 'load',
      'slotList', 'items', '5',
      'screenList', 'items', 'S1',
      'presetList', 'items', 'PREVIEW',
      'pp', 'xRequest',
    ])
  })

  it('builds the take path', () => {
    expect(awjPaths('Take Screen 1')).toEqual([
      'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake',
    ])
  })
})

// ---------------------------------------------------------------------------

describe('defaults', () => {
  it('sends an unqualified recall to preview, never to air', () => {
    expect(awjPaths('Recall Screen 1 Memory 5')[0]).toContain('/PREVIEW/')
  })

  it('takes an unqualified store from program', () => {
    expect(awjPaths('Store Screen 1 Memory 5')[0]).toContain('/PROGRAM/')
  })
})

// ---------------------------------------------------------------------------

describe('sticky scope', () => {
  const sel: Selection = { targets: [{ kind: 'screen', n: 1 }, { kind: 'screen', n: 3 }] }

  it('is set by Select and writes nothing to the device', () => {
    const r = run('Select Screen 1 + 3')
    expect(r.ops).toHaveLength(0)
    expect(r.selection?.targets).toEqual([{ kind: 'screen', n: 1 }, { kind: 'screen', n: 3 }])
  })

  it('fills in for a command that names no target', () => {
    expect(awjPaths('Recall Memory 5', sel)).toHaveLength(2)
  })

  it('is overridden by an inline scope', () => {
    const paths = awjPaths('Recall Screen 2 Memory 5', sel)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toContain('/S2/')
  })

  it('does not apply a sticky layer once a screen is named inline', () => {
    const withLayer: Selection = { targets: [{ kind: 'screen', n: 1 }], layers: [2] }
    // Naming a screen replaces the selection, so this is a screen recall.
    expect(awjPaths('Recall Screen 2 Memory 5', withLayer)[0]).toContain('presetBank')
  })

  it('makes a recall a layer recall when a layer is the sticky scope', () => {
    const withLayer: Selection = { targets: [{ kind: 'screen', n: 1 }], layers: [2] }
    expect(awjPaths('Recall Memory 5', withLayer)[0]).toContain('layerBank')
  })
})

// ---------------------------------------------------------------------------

describe('master store and record masks', () => {
  it('writes every filter before the trigger', () => {
    const ops = run('Store Master 12').ops
    const props = ops.map((o) => o.path.toAwj().split('@props/')[1])
    expect(props).toEqual(['mode', 'screenFilter', 'auxFilter', 'layerFilter', 'categoryFilter', 'xRequest'])
  })

  it('writes an unfiltered store wide open rather than leaving the last mask', () => {
    const ops = run('Store Master 12').ops
    const screens = ops.find((o) => o.path.toAwj().endsWith('screenFilter'))!.value as string[]
    expect(screens).toHaveLength(24)
    expect(screens[0]).toBe('S1')
  })

  it('narrows the screen filter from an If clause', () => {
    const ops = run('Store Master 12 If Screen 1 + 3').ops
    expect(ops.find((o) => o.path.toAwj().endsWith('screenFilter'))!.value).toEqual(['S1', 'S3'])
  })

  it('maps category keywords onto the device record mask', () => {
    const ops = run('Store Master 12 If Category Source + Position').ops
    expect(ops.find((o) => o.path.toAwj().endsWith('categoryFilter'))!.value).toEqual(['SOURCE', 'POS'])
  })

  it('picks the save mode from the preset mode', () => {
    const pgm = run('Store Master 12').ops[0]
    expect(pgm.value).toBe('SAVE_FROM_PGM')
    const pvw = run('Store Master 12 Preview').ops[0]
    expect(pvw.value).toBe('SAVE_FROM_PVW')
  })

  it('refuses a mask on a bank that has none rather than ignoring it', () => {
    expect(errorOf('Store Screen 1 Memory 5 If Category Source')).toMatch(/only supported on Store Master/)
  })

  it('refuses a mask on a recall', () => {
    expect(errorOf('Recall Screen 1 Memory 5 If Category Source')).toMatch(/filters a Store/)
  })
})

// ---------------------------------------------------------------------------

describe('slot ranges differ per bank', () => {
  it('allows screen memory 1000', () => {
    expect(awjPaths('Recall Screen 1 Memory 1000')).toHaveLength(1)
  })

  it('rejects screen memory 1001', () => {
    expect(errorOf('Recall Screen 1 Memory 1001')).toMatch(/1 to 1000/)
  })

  it('caps layer memories at 50', () => {
    expect(errorOf('Recall Screen 1 Layer 2 Memory 51')).toMatch(/layer memories are 1 to 50/)
  })

  it('caps master memories at 500', () => {
    expect(errorOf('Recall Master Memory 501')).toMatch(/master memories are 1 to 500/)
  })
})

// ---------------------------------------------------------------------------

describe('errors', () => {
  it('rejects a command that does not start with a function', () => {
    expect(errorOf('Screen 1 Recall Memory 5')).toMatch(/starts with a function/)
  })

  it('names the memory number as missing', () => {
    expect(errorOf('Recall Screen 1')).toMatch(/needs a Memory number/)
  })

  it('requires a target with no sticky scope to inherit', () => {
    expect(errorOf('Recall Memory 5')).toMatch(/sticky scope/)
  })

  it('requires text for a label', () => {
    expect(errorOf('Label Screen 1 Memory 5')).toMatch(/text in quotes/)
  })
})

// ---------------------------------------------------------------------------

describe('label and delete', () => {
  it('labels a memory by slot on its own bank', () => {
    const ops = run('Label Screen 1 Memory 5 "Wide Open"').ops
    expect(ops[0].path.toAwj()).toBe('DeviceObject/presetBank/$bank/@items/5/control/@props/label')
    expect(ops[0].value).toBe('Wide Open')
  })

  it('deletes from the layer bank when a layer is in scope', () => {
    expect(awjPaths('Delete Screen 1 Layer 2 Memory 7')[0]).toContain('layerBank')
  })
})

// ---------------------------------------------------------------------------
// Live layer control
// ---------------------------------------------------------------------------

/**
 * A stand-in for a connected device. S3 is a 1920x1080 screen whose program is
 * buffer A; S1's program is B, because the mapping genuinely differs per screen
 * and the compiler must not assume otherwise.
 */
const facts = {
  buffer: (t: { kind: string; n: number }, mode: string) => {
    const program = t.n === 1 ? 'B' : 'A'
    const preview = program === 'A' ? 'B' : 'A'
    return (mode === 'PROGRAM' ? program : preview) as 'A' | 'B'
  },
  canvas: () => ({ w: 1920, h: 1080 }),
}

function runSet(input: string) {
  const parsed = parse(input)
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errors[0].message}`)
  const c = compile(parsed.command, { facts } as never)
  if (!c.ok) throw new Error(`compile failed: ${c.errors[0].message}`)
  return c
}

function setError(input: string, ctx: object = { facts }) {
  const parsed = parse(input)
  if (!parsed.ok) return parsed.errors[0].message
  const c = compile(parsed.command, ctx as never)
  if (!c.ok) return c.errors[0].message
  throw new Error(`expected "${input}" to fail`)
}

describe('Set — live layer control', () => {
  it('assigns a source as the device enum, not a number', () => {
    const [op] = runSet('Set Screen 3 Layer 2 Source 1').ops
    assertPath(op, 'DeviceObject/$screen/@items/S3/$preset/@items/B/$layer/@items/2/source/@props/inputNum')
    expect(op.value).toBe('LIVE_1')
  })

  it('addresses the buffer, resolved from the take state, not PREVIEW/PROGRAM', () => {
    // S3's program is A, so its preview is B.
    expect(runSet('Set Screen 3 Layer 2 Source 1').ops[0].path.toAwj()).toContain('/$preset/@items/B/')
    expect(runSet('Set Screen 3 Layer 2 Source 1 Program').ops[0].path.toAwj()).toContain('/$preset/@items/A/')
    // S1 is the other way round, which is the whole point of asking the device.
    expect(runSet('Set Screen 1 Layer 2 Source 1').ops[0].path.toAwj()).toContain('/$preset/@items/A/')
  })

  it('resolves a percentage against the real canvas', () => {
    const ops = runSet('Set Screen 3 Layer 2 Size 50%').ops
    expect(ops.map((o) => o.value)).toEqual([960, 540])
  })

  it('takes two amounts as horizontal then vertical', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 50% 25%').ops.map((o) => o.value)).toEqual([960, 270])
  })

  it('treats a plain number as pixels', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 640 360').ops.map((o) => o.value)).toEqual([640, 360])
  })

  it('scales opacity to the device 0-256, not 0-100', () => {
    expect(runSet('Set Screen 3 Layer 2 Opacity 50%').ops[0].value).toBe(128)
    expect(runSet('Set Screen 3 Layer 2 Opacity 256').ops[0].value).toBe(256)
  })

  it('accepts the At spelling, and the object-first form', () => {
    const a = runSet('Set Screen 3 Layer 2 Source 1').ops
    const b = runSet('Set Screen 3 Layer 2 Source At 1').ops
    const c = runSet('Screen 3 Layer 2 Source At 1').ops
    expect(b.map((o) => o.path.toAwj())).toEqual(a.map((o) => o.path.toAwj()))
    expect(c.map((o) => o.path.toAwj())).toEqual(a.map((o) => o.path.toAwj()))
  })

  it('handles stills, colour and none', () => {
    expect(runSet('Set Screen 3 Layer 2 Source Still 4').ops[0].value).toBe('STILL_4')
    expect(runSet('Set Screen 3 Layer 2 Source None').ops[0].value).toBe('NONE')
    expect(runSet('Set Screen 3 Layer 2 Source Colour').ops[0].value).toBe('COLOR')
  })

  it('refuses a percentage when the canvas is unknown', () => {
    const noCanvas = { facts: { buffer: facts.buffer, canvas: () => undefined } }
    expect(setError('Set Screen 3 Layer 2 Size 50%', noCanvas)).toMatch(/canvas size .* is not known/)
    // Pixels still work without it.
    const parsed = parse('Set Screen 3 Layer 2 Size 640')
    if (!parsed.ok) throw new Error('should parse')
    expect(compile(parsed.command, noCanvas as never).ok).toBe(true)
  })

  it('refuses when the take state is unknown rather than guessing a buffer', () => {
    const noBuffer = { facts: { buffer: () => undefined, canvas: facts.canvas } }
    expect(setError('Set Screen 3 Layer 2 Source 1', noBuffer)).toMatch(/has not reported its take state/)
  })

  it('refuses without a live connection at all', () => {
    expect(setError('Set Screen 3 Layer 2 Source 1', {})).toMatch(/needs a live connection/)
  })

  it('needs a layer, because these are layer parameters', () => {
    expect(setError('Set Screen 3 Source 1')).toMatch(/needs a Layer/)
  })

  it('rejects an out-of-range source', () => {
    expect(setError('Set Screen 3 Layer 2 Source 99')).toMatch(/live inputs are 1 to 64/)
  })

  it('keeps Source usable as a record-mask category inside If', () => {
    // The same word, told apart by where it appears.
    const p = parse('Store Master 12 If Category Source + Position')
    expect(p.ok).toBe(true)
    expect(setError('Recall Screen 1 Memory 5 Source 1')).toMatch(/does not take Source/)
  })

  it('compiles the whole worked example in one command', () => {
    // "select screen 3, layer 2, assign it source 1, set the size to 50% of the
    // window, and position it 1/3 of the way across the screen"
    const c = runSet('Set Screen 3 Layer 2 Source 1 Size 50% Position 33% 50%')
    expect(c.ops.map((o) => [o.path.toAwj().split('/').slice(-3).join('/'), o.value])).toEqual([
      ['source/@props/inputNum', 'LIVE_1'],
      ['position/@props/sizeH', 960],
      ['position/@props/sizeV', 540],
      ['position/@props/posH', 634],
      ['position/@props/posV', 540],
    ])
  })
})

// ---------------------------------------------------------------------------
// Units: pixels and percentages, everywhere a value is taken
// ---------------------------------------------------------------------------

describe('pixels and percentages', () => {
  it('takes a percentage of the real canvas', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 50%').ops.map((o) => o.value)).toEqual([960, 540])
  })

  it('takes plain numbers as pixels', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 960 540').ops.map((o) => o.value)).toEqual([960, 540])
  })

  it('mixes the two within one attribute', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 960 25%').ops.map((o) => o.value)).toEqual([960, 270])
    expect(runSet('Set Screen 3 Layer 2 Size 50% 540').ops.map((o) => o.value)).toEqual([960, 540])
  })

  it('mixes the two across attributes in one command', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 50% Position 640 360').ops.map((o) => o.value)).toEqual([
      960, 540, 640, 360,
    ])
  })

  it('accepts a fractional percentage', () => {
    expect(runSet('Set Screen 3 Layer 2 Position 33.3%').ops.map((o) => o.value)).toEqual([639, 360])
  })

  it('allows a layer larger than its canvas', () => {
    expect(runSet('Set Screen 3 Layer 2 Size 150%').ops.map((o) => o.value)).toEqual([2880, 1620])
  })

  it('allows a negative position, in pixels or percent', () => {
    // The anchor is the layer's centre, so pushing a layer off the edge is
    // routine — and the device's own range for a position is signed.
    expect(runSet('Set Screen 3 Layer 2 Position -100 50').ops.map((o) => o.value)).toEqual([-100, 50])
    expect(runSet('Set Screen 3 Layer 2 Position -50%').ops.map((o) => o.value)).toEqual([-960, -540])
  })

  it('refuses a negative size, which the device has no range for', () => {
    expect(setError('Set Screen 3 Layer 2 Size -100')).toMatch(/cannot have a negative size/)
    expect(setError('Set Screen 3 Layer 2 Size -50%')).toMatch(/cannot have a negative size/)
  })

  it('range-checks against the device, not against the canvas', () => {
    expect(setError('Set Screen 3 Layer 2 Position -3000000')).toMatch(/-2000000 and 2000000/)
    expect(setError('Set Screen 3 Layer 2 Opacity -10')).toMatch(/0 to 256/)
  })

  it('takes At before either amount, or neither', () => {
    const plain = runSet('Set Screen 3 Layer 2 Position -100 50').ops.map((o) => o.value)
    expect(runSet('Set Screen 3 Layer 2 Position At -100 At 50').ops.map((o) => o.value)).toEqual(plain)
    expect(runSet('Set Screen 3 Layer 2 Position At -100 50').ops.map((o) => o.value)).toEqual(plain)
  })

  it('still reads a minus as range subtraction where a range is expected', () => {
    // The same character, told apart by whether a value or a range is due.
    expect(run('Take Screen 1 Thru 8 - 5').ops).toHaveLength(7)
    expect(run('Recall Screen 1 + 3 - 1 Memory 5').ops).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------

describe('audio routing', () => {
  const wsOf = (input: string) => run(input).ops.map((o) => o.path.toWs().join('/'))

  it('patches one source to one destination', () => {
    const c = run('Set Audio Patch Input 1 Channel 1 To Dante 1')
    expect(c.ops).toHaveLength(1)
    expect(c.ops[0].path.toWs().join('/')).toBe(
      'device/audio/control/deviceList/items/1/txList/items/DANTE_1/channelList/items/1/control/pp/source',
    )
    expect(c.ops[0].value).toBe('INPUT_1_CHANNEL_1')
  })

  /* A patch is a single write: the source's own key, put into the
     destination channel's `source`. There is no crosspoint object. */
  it('writes the source key rather than a crosspoint', () => {
    expect(run('Set Audio Patch Dante 11 To Output 2 Channel 4').ops[0].value).toBe('DANTE_2_CHANNEL_3')
  })

  /* Dante is eight blocks of eight on the wire and a flat run to everyone
     else. The grammar takes the flat number and the model does the division;
     11 is block 2 channel 3. */
  it('flattens Dante numbering in both directions', () => {
    expect(wsOf('Set Audio Mute Dante 11')[0]).toContain('txList/items/DANTE_2/channelList/items/3')
    expect(errorOf('Set Audio Patch Dante 2 Channel 3 To Dante 1')).toMatch(/numbered straight through/)
    expect(errorOf('Set Audio Mute Dante 65')).toMatch(/dante/i)
  })

  it('takes the user’s own phrasing, and the abbreviations', () => {
    const long = wsOf('Set Audio Patch Input 1 Channel 1 To Dante 1')
    expect(wsOf('Set Audio Patch Input 1 Channel 1 At Dante 1')).toEqual(long)
    expect(wsOf('Set Audio Patch Input 1 Channel 1 Dante 1')).toEqual(long)
    expect(wsOf('Set Aud Pa In 1 Ch 1 To Da 1')).toEqual(long)
  })

  it('mutes a range of Dante channels', () => {
    const c = run('Set Audio Mute Dante 1 Thru 6')
    expect(c.ops).toHaveLength(6)
    expect(c.ops.every((o) => o.value === true)).toBe(true)
    expect(c.ops[5].path.toWs().join('/')).toContain('DANTE_1/channelList/items/6')
  })

  it('unmutes, which is the same path with the other value', () => {
    expect(run('Set Audio Unmute Dante 1').ops[0].value).toBe(false)
  })

  /*
   * The distinction that would look like it worked if it were wrong: muting a
   * source silences it into every destination it feeds; muting a destination
   * channel silences only that channel. They are different subtrees.
   */
  it('mutes a source in the receiver list and a destination in the transmitter list', () => {
    expect(wsOf('Set Audio Mute Input 5 Channel 1')[0]).toBe(
      'device/audio/control/deviceList/items/1/rxList/items/INPUT_5_CHANNEL_1/control/pp/mute',
    )
    expect(wsOf('Set Audio Mute Output 5 Channel 1')[0]).toBe(
      'device/audio/control/deviceList/items/1/txList/items/OUTPUT_5/channelList/items/1/control/pp/mute',
    )
  })

  it('takes a whole unit to mean all eight of its channels', () => {
    expect(run('Set Audio Mute Output 3').ops).toHaveLength(8)
    expect(run('Set Audio Patch None To Output 3').ops).toHaveLength(8)
  })

  /* Run patching, the idiom every audio desk has: eight sources laid onto a
     destination counts forward from it. */
  it('lays a run of sources onto consecutive destinations', () => {
    const c = run('Set Audio Patch Input 1 Channel 1 Thru 8 To Dante 1')
    expect(c.ops).toHaveLength(8)
    expect(c.ops[7].value).toBe('INPUT_1_CHANNEL_8')
    expect(c.ops[7].path.toWs().join('/')).toContain('DANTE_1/channelList/items/8')
  })

  it('walks an output’s own channels but never into the next output', () => {
    const c = run('Set Audio Patch Input 2 Channel 1 Thru 4 To Output 5 Channel 3')
    /* …/channelList/items/<ch>/control/pp/source — the channel is four from the end. */
    expect(c.ops.map((o) => o.path.toWs().at(-4))).toEqual(['3', '4', '5', '6'])
    expect(errorOf('Set Audio Patch Input 2 Channel 1 Thru 8 To Output 5 Channel 3')).toMatch(/past the end/)
  })

  it('refuses a run that would fall off the end of Dante', () => {
    expect(errorOf('Set Audio Patch Input 1 Channel 1 Thru 8 To Dante 60')).toMatch(/past the end/)
  })

  /* A patch that quietly did some of what was asked would be worse than one
     that refuses. */
  it('refuses a count that lines up neither one-to-one nor as a run', () => {
    expect(errorOf('Set Audio Patch Input 1 Channel 1 Thru 4 To Dante 1 Thru 8')).toMatch(/one per destination/)
  })

  it('refuses to patch the wrong way round', () => {
    expect(errorOf('Set Audio Patch Output 1 Channel 1 To Dante 1')).toMatch(/destination, not a source/)
    expect(errorOf('Set Audio Patch Input 1 Channel 1 To Input 2 Channel 1')).toMatch(/source, not a destination/)
    expect(errorOf('Set Audio Patch Input 1 Channel 1 To None')).toMatch(/cannot be patched to/)
  })

  it('is set, never recalled or stored', () => {
    expect(errorOf('Recall Audio Mute Dante 1')).toMatch(/Set Audio/)
    expect(errorOf('Store Audio Patch Input 1 Channel 1 To Dante 1')).toMatch(/Set Audio/)
  })

  it('does not let an audio command trail into a screen command', () => {
    expect(errorOf('Set Audio Mute Dante 1 Screen 2')).toMatch(/after the audio command/)
  })

  /* Adding `Audio` lengthened `Aux` from `Au` to `Aux`, which is the
     documented cost of prefix abbreviation. Pinned so nobody is surprised. */
  it('lengthens Aux, and both still resolve', () => {
    expect(shortestForm('Aux')).toBe('Aux')
    expect(shortestForm('Audio')).toBe('Aud')
    const aux = resolveKeyword('Aux')
    expect(aux.ok && aux.keyword.word).toBe('Aux')
    const ambiguous = resolveKeyword('Au')
    expect(ambiguous.ok).toBe(false)
  })
})
