import { describe, expect, it } from 'vitest'

import { KEYWORDS } from './keywords.ts'
import { Path } from './paths.ts'
import { run } from './dialects/index.ts'
import { declared, sniff } from './dialects/detect.ts'
import { dictionary, resolve } from './dialects/osc.ts'
import { BUILTIN_PARAMS, coerce, denormalise, findParam } from './dialects/params.ts'
import type { PresetBuffer, PresetMode, Target } from './model.ts'

/** Run a line and insist it worked, so the tests read as assertions. */
function ok(line: string, ctx: Parameters<typeof run>[1] = {}) {
  const r = run(line, ctx)
  if (!r.ok) throw new Error(`"${line}" failed: ${r.errors.map((e) => e.message).join('; ')}`)
  return r
}

function why(line: string, ctx: Parameters<typeof run>[1] = {}): string {
  const r = run(line, ctx)
  if (r.ok) throw new Error(`expected "${line}" to fail, but it produced ${r.ops.length} op(s)`)
  return r.errors.map((e) => e.message).join('; ')
}

const awj = (line: string, ctx: Parameters<typeof run>[1] = {}) =>
  ok(line, ctx).ops.map((o) => o.path.toAwj())

/** A device whose take state is known, so `preview`/`program` can resolve. */
const facts = {
  buffer: (_t: Target, mode: PresetMode): PresetBuffer => (mode === 'PROGRAM' ? 'A' : 'B'),
}

// ---------------------------------------------------------------------------

describe('path round-tripping', () => {
  const samples = [
    'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake',
    'DeviceObject/presetBank/control/load/$slot/@items/5/$screen/@items/S1/$preset/@items/PREVIEW/@props/xRequest',
    'DeviceObject/$screen/@items/S2/$preset/@items/A/$layer/@items/3/opacity/@props/opacity',
    'DeviceObject/system/$device/@items/1/@props/dev',
  ]

  it('reads an AWJ path back to the path that renders it', () => {
    for (const s of samples) expect(Path.fromAwj(s).toAwj()).toBe(s)
  })

  it('reads a store path back to the path that renders it', () => {
    for (const s of samples) {
      const ws = Path.fromAwj(s).toWs()
      expect(Path.fromWs(ws).toWs()).toEqual(ws)
    }
  })

  it('crosses between the two spellings', () => {
    const ws = ['device', 'screenAuxGroupList', 'items', 'S1', 'control', 'pp', 'xTake']
    expect(Path.fromWs(ws).toAwj()).toBe(samples[0])
    expect(Path.fromAwj(samples[0]).toWs()).toEqual(ws)
  })

  it('accepts a store path with the device root already peeled off', () => {
    expect(Path.fromWs(['screenAuxGroupList', 'items', 'S1', 'control', 'pp', 'xTake']).toAwj()).toBe(
      samples[0],
    )
  })

  it('refuses a truncated path rather than addressing the container', () => {
    expect(() => Path.fromAwj('DeviceObject/$screen/@items')).toThrow(/no key/)
    expect(() => Path.fromAwj('DeviceObject/$screen/@items/S1/@props')).toThrow(/no property/)
    expect(() => Path.fromAwj('DeviceObject/@items/S1')).toThrow(/does not follow/)
  })
})

// ---------------------------------------------------------------------------

describe('language detection', () => {
  it('takes a declared prefix over anything it would have guessed', () => {
    expect(declared('AWJ get DeviceObject/a/@props/b').language).toBe('awj')
    expect(declared('json {"path":["device"],"value":1}').language).toBe('json')
    expect(declared('OSC /lp/screen/1/take').language).toBe('osc')
    expect(declared('Mynah Take Screen 1').language).toBe('mynah')
  })

  it('does not treat a Mynah verb as a language prefix', () => {
    /* `STORE` was an alias for JSON for one commit. It made every
       `Store Master 12` a JSON parse error, and nothing else noticed. */
    expect(declared('Store Master 12').language).toBe(null)
    expect(sniff('Store Master 12')).toBe('mynah')
  })

  it('is not a prefix when nothing follows it', () => {
    expect(declared('OSC').language).toBe(null)
    expect(declared('AWJ  ').language).toBe(null)
  })

  /*
   * The reason the four prefix words are safe. If a keyword is ever added that
   * collides, `OSC Screen 1` silently stops being a Mynah command — so this is
   * the test that has to fail before that can ship.
   */
  it('keeps the prefix words out of the Mynah vocabulary', () => {
    const words = new Set(KEYWORDS.map((k) => k.word.toUpperCase()))
    for (const reserved of ['MYNAH', 'AWJ', 'JSON', 'OSC']) {
      expect(words.has(reserved), `${reserved} is now a keyword`).toBe(false)
    }
  })

  it('sniffs each language from its own unmistakable shape', () => {
    expect(sniff('/lp/screen/1/take')).toBe('osc')
    expect(sniff('{"op":"replace","path":"a","value":1}')).toBe('awj')
    expect(sniff('{"path":["device"],"value":1}')).toBe('json')
    expect(sniff('[{"path":["device"],"value":1}]')).toBe('json')
    expect(sniff('DeviceObject/$screen/@items/S1/@props/x')).toBe('awj')
    expect(sniff('get DeviceObject/a/@props/b')).toBe('awj')
    expect(sniff('Recall Screen 1 Memory 5')).toBe('mynah')
    expect(sniff('R Sc 1 Me 5')).toBe('mynah')
  })

  it('falls back to Mynah, so a mistyped command gets Mynah’s error', () => {
    expect(sniff('Recal Screen 1')).toBe('mynah')
    expect(why('Recal Screen 1')).toMatch(/Recal/)
  })

  it('stops guessing when a single language is chosen', () => {
    /* A slash-led line is OSC under detection and a JSON error under JSON. */
    expect(run('/lp/screen/1/take', { language: 'json' }).language).toBe('json')
    expect(why('/lp/screen/1/take', { language: 'json' })).toMatch(/not JSON/)
  })

  it('still honours a declared prefix inside a pinned language', () => {
    const r = ok('MYNAH Take Screen 1', { language: 'json' })
    expect(r.language).toBe('mynah')
    expect(r.declared).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe('AWJ', () => {
  const take = 'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake'

  it('runs a canonical message', () => {
    expect(awj(`AWJ {"op":"replace","path":"${take}","value":true}`)).toEqual([take])
  })

  it('tolerates the 0x04 terminator, and splits on it', () => {
    const two = `{"op":"replace","path":"${take}","value":true}{"op":"replace","path":"${take}","value":false}`
    expect(awj(`AWJ ${two}`)).toEqual([take, take])
  })

  it('takes an array of messages', () => {
    expect(awj(`AWJ [{"op":"replace","path":"${take}","value":true}]`)).toEqual([take])
  })

  it('runs the shorthand, with and without the verb', () => {
    expect(awj(`AWJ replace ${take} = true`)).toEqual([take])
    expect(awj(`AWJ ${take} = true`)).toEqual([take])
    expect(ok(`AWJ replace ${take} = true`).ops[0].value).toBe(true)
  })

  it('reads a bare word as a string, so enums need no quoting', () => {
    const p = 'DeviceObject/$screen/@items/S1/$preset/@items/A/$layer/@items/1/source/@props/inputNum'
    expect(ok(`AWJ ${p} = LIVE_3`).ops[0].value).toBe('LIVE_3')
    expect(ok(`AWJ ${p} = 12`).ops[0].value).toBe(12)
    expect(ok(`AWJ ${p} = "LIVE_3"`).ops[0].value).toBe('LIVE_3')
  })

  it('keeps a get out of the writes', () => {
    const r = ok(`AWJ get ${take}`)
    expect(r.ops).toHaveLength(0)
    expect(r.reads).toHaveLength(1)
    expect(r.reads[0].path.toAwj()).toBe(take)
  })

  it('names the closed op set rather than saying "invalid"', () => {
    expect(why(`AWJ {"op":"add","path":"${take}","value":1}`)).toMatch(/replace.*get/)
  })

  it('refuses a container, because AWJ answers {} for one', () => {
    expect(why('AWJ get DeviceObject/$screen/@items/S1')).toMatch(/not a property/)
  })

  it('refuses a replace with no value', () => {
    expect(why(`AWJ {"op":"replace","path":"${take}"}`)).toMatch(/needs a value/)
    expect(why(`AWJ replace ${take}`)).toMatch(/needs a value/)
  })
})

// ---------------------------------------------------------------------------

describe('raw store JSON', () => {
  const ws = ['device', 'screenAuxGroupList', 'items', 'S1', 'control', 'pp', 'xTake']
  const awjTake = 'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake'

  it('runs a bare write', () => {
    expect(awj(`JSON {"path":${JSON.stringify(ws)},"value":true}`)).toEqual([awjTake])
  })

  it('takes the path slash-joined too', () => {
    expect(awj(`JSON {"path":"${ws.join('/')}","value":true}`)).toEqual([awjTake])
  })

  it('unwraps the socket envelope, which is the form people actually copy', () => {
    const frame = { channel: 'DEVICE', data: { path: ws, value: true } }
    expect(awj(`JSON ${JSON.stringify(frame)}`)).toEqual([awjTake])
  })

  it('refuses the other channels by name', () => {
    expect(why('JSON {"channel":"REMOTE","data":{}}')).toMatch(/not a device write/)
  })

  it('runs a batch', () => {
    const batch = [
      { path: ws, value: true },
      { path: ws, value: false },
    ]
    expect(awj(`JSON ${JSON.stringify(batch)}`)).toHaveLength(2)
  })

  it('says what is wrong with the JSON rather than "cannot compile"', () => {
    expect(why('JSON {')).toMatch(/not JSON/)
    expect(why('JSON {"path":["device"]}')).toMatch(/needs a value/)
  })
})

// ---------------------------------------------------------------------------

describe('OSC', () => {
  it('takes a screen', () => {
    expect(awj('/lp/screen/1/take')).toEqual([
      'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake',
    ])
  })

  it('cuts a screen through the group parameter table', () => {
    expect(awj('/lp/screen/1/cut')).toEqual([
      'DeviceObject/$screenAuxGroup/@items/S1/control/@props/xCut',
    ])
  })

  it('addresses an auxiliary through its own collection', () => {
    expect(awj('/lp/aux/2/take')).toEqual([
      'DeviceObject/$screenAuxGroup/@items/A2/control/@props/xTake',
    ])
  })

  /*
   * The rule that matters most. A recall with no preset named goes to preview,
   * exactly as the grammar does, so an address short of a word cannot reach
   * air.
   */
  it('never defaults a recall to program', () => {
    expect(awj('/lp/screen/1/memory/5/recall')[0]).toMatch(/@items\/PREVIEW\//)
    expect(awj('/lp/screen/1/memory/5/recall/program')[0]).toMatch(/@items\/PROGRAM\//)
    expect(awj('/lp/master/memory/12/recall')[0]).toMatch(/@items\/PREVIEW\//)
  })

  it('emits the same path the grammar does for the same command', () => {
    expect(awj('/lp/screen/1/take')).toEqual(awj('Take Screen 1'))
    expect(awj('/lp/screen/1/memory/5/recall')).toEqual(awj('Recall Screen 1 Memory 5'))
    expect(awj('/lp/master/memory/12/store')).toEqual(
      awj('Store Master 12').slice(-1),
    )
  })

  it('takes the preset as an argument as well as in the address', () => {
    expect(awj('/lp/screen/1/memory/5/recall program')[0]).toMatch(/@items\/PROGRAM\//)
  })

  /*
   * Rule 2. A surface sends 1 on press and 0 on release; firing on both would
   * take the screen twice and the second one is the one nobody meant.
   */
  it('fires a trigger on a press and does nothing on the release', () => {
    expect(ok('/lp/screen/1/take 1').ops).toHaveLength(1)
    expect(ok('/lp/screen/1/take 0').ops).toHaveLength(0)
    expect(ok('/lp/screen/1/take 0').summary).toMatch(/released/)
    expect(ok('/lp/screen/1/take').ops).toHaveLength(1)
  })

  it('sets a live layer parameter in the device’s own units', () => {
    const ctx = { osc: facts }
    expect(awj('/lp/screen/1/preset/program/layer/2/opacity/opacity 128', ctx)).toEqual([
      'DeviceObject/$screen/@items/S1/$preset/@items/A/$layer/@items/2/opacity/@props/opacity',
    ])
    expect(ok('/lp/screen/1/preset/program/layer/2/opacity/opacity 128', ctx).ops[0].value).toBe(128)
  })

  it('scales a normalised value onto the parameter’s own range', () => {
    const ctx = { osc: facts }
    expect(ok('/lp/screen/1/preset/a/layer/2/opacity/opacity/norm 0.5', ctx).ops[0].value).toBe(128)
    expect(ok('/lp/screen/1/preset/a/layer/2/opacity/opacity/norm 1', ctx).ops[0].value).toBe(256)
    expect(ok('/lp/screen/1/preset/a/layer/2/position/posH/norm 0.5', ctx).ops[0].value).toBe(0)
  })

  it('addresses a buffer directly without needing device state', () => {
    expect(awj('/lp/screen/1/preset/b/layer/1/source/inputNum LIVE_3')).toEqual([
      'DeviceObject/$screen/@items/S1/$preset/@items/B/$layer/@items/1/source/@props/inputNum',
    ])
  })

  /*
   * Rule 5. Preview and program name whichever buffer is pending or live, and
   * a take swaps them — so with no device state the address is refused with
   * the reason, never guessed.
   */
  it('refuses preview/program when the take state is unknown, and says why', () => {
    const msg = why('/lp/screen/1/preset/program/layer/2/opacity/opacity 128')
    expect(msg).toMatch(/take state/)
    expect(msg).toMatch(/\/a, \/b or \/c/)
  })

  it('names the reserved relative tail rather than calling it a typo', () => {
    expect(why('/lp/screen/1/preset/a/layer/1/opacity/opacity/rel 0.01')).toMatch(/reserved/)
  })

  it('refuses a parameter that is not in the dictionary', () => {
    expect(why('/lp/screen/1/preset/a/layer/1/nonsense/thing 1')).toMatch(/no layer parameter/)
  })

  it('checks ranges against the device’s own dimensions', () => {
    expect(why('/lp/screen/99/take')).toMatch(/out of range/)
    expect(why('/lp/screen/1/memory/9999/recall')).toMatch(/out of range/)
    expect(why('/lp/aux/1/layer/999/memory/1/recall')).toMatch(/out of range/)
  })

  it('addresses NATIVE as the layer it is', () => {
    expect(awj('/lp/screen/1/layer/NATIVE/memory/3/recall')[0]).toMatch(/\$layer\/@items\/NATIVE\//)
  })

  it('takes a quoted label with spaces in it', () => {
    const r = ok('/lp/screen/1/memory/5/label "Act One Top"')
    expect(r.ops[0].value).toBe('Act One Top')
  })

  it('says which part of the address it did not understand', () => {
    expect(why('/lp/screen/1/wobble')).toMatch(/expected take, cut, memory/)
    expect(why('/nope/screen/1/take')).toMatch(/start with \/lp/)
  })
})

// ---------------------------------------------------------------------------

describe('parameter coercion', () => {
  const opacity = findParam(BUILTIN_PARAMS.layer, 'opacity.opacity')!
  const source = findParam(BUILTIN_PARAMS.layer, 'source.inputNum')!
  const take = findParam(BUILTIN_PARAMS.screenGroup, 'control.xTake')!

  it('clamps a number into the device’s range rather than sending it out of it', () => {
    expect(coerce(opacity, 999)).toBe(256)
    expect(coerce(opacity, -5)).toBe(0)
    expect(coerce(opacity, 100.6)).toBe(101)
  })

  it('refuses an enum value the device does not have', () => {
    expect(coerce(source, 'live_3')).toBe('LIVE_3')
    expect(() => coerce(source, 'LIVE_999')).toThrow(/not a value of/)
  })

  it('takes an enum index, because a button has nowhere to put a name', () => {
    expect(coerce(source, 0)).toBe('NONE')
    expect(coerce(source, 1)).toBe('LIVE_1')
    expect(() => coerce(source, 99_999)).toThrow(/past the end/)
  })

  it('reads a flag from either spelling', () => {
    expect(coerce(take, 1)).toBe(true)
    expect(coerce(take, 0)).toBe(false)
    expect(coerce(take, 'true')).toBe(true)
  })

  it('refuses to normalise a parameter with no published range', () => {
    expect(() => denormalise({ id: 'x', path: [], type: 'number' }, 0.5)).toThrow(/no range/)
  })
})

// ---------------------------------------------------------------------------

describe('the published dictionary', () => {
  const entries = dictionary()

  it('describes only addresses the resolver actually answers', () => {
    /* Every documented address is filled in with real indices and run. What is
       being pinned is that the document cannot describe something that does
       not work — a published dictionary that lies is worse than none. */
    const fill = (address: string) =>
      address
        .replace('{n}', '1')
        .replace('{out}', '1')
        .replace('{slot}', '1')
        .replace('{l}', '1')
        .replace('{preview|program|a|b|c}', 'a')
        .replace('{preview|program}', 'preview')

    for (const entry of entries) {
      const line = `${fill(entry.address)} ${sampleArg(entry.args)}`.trim()
      const r = run(line, { language: 'osc' })
      expect(r.ok, `${entry.address} → ${r.ok ? '' : r.errors[0].message}`).toBe(true)
    }
  })

  it('publishes a /norm form for everything that has a range to scale onto', () => {
    const norms = entries.filter((e) => e.address.endsWith('/norm'))
    expect(norms.length).toBeGreaterThan(0)
    for (const n of norms) expect(n.args).toMatch(/0–1/)
  })

  it('groups every entry, so the document has a shape', () => {
    for (const e of entries) expect(e.group).not.toBe('')
    expect(new Set(entries.map((e) => e.group)).size).toBeGreaterThan(3)
  })
})

/** A plausible argument for a documented argument description. */
function sampleArg(args: string): string {
  if (args.startsWith('none')) return ''
  if (args === 'string') return '"x"'
  if (args.startsWith('float')) return '0.5'
  if (args.startsWith('value name')) return '0'
  const m = /(-?\d+)–(-?\d+)/.exec(args)
  return m ? m[1] : '0'
}

// ---------------------------------------------------------------------------

describe('resolving a message rather than a line', () => {
  it('takes an address and typed arguments straight, for a UDP host', () => {
    const r = resolve({ address: '/lp/screen/1/take', args: [1] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ops[0].path.toWs()).toEqual([
      'device', 'screenAuxGroupList', 'items', 'S1', 'control', 'pp', 'xTake',
    ])
  })
})
