/**
 * Variables and bracketed arithmetic.
 *
 * Most of what is here is about refusal. A variable is a number the operator
 * did not type, so the failure to defend against is a plausible wrong value
 * arriving at a switcher with nothing on screen to say where it came from: an
 * unknown name read as zero, a label read as NaN, a role read mid-take, a
 * division by zero clamped to a maximum. Each of those must be an error that
 * names the variable, with a span that points at it.
 */

import { describe, expect, it } from 'vitest'

import { compile } from './compile.ts'
import { run } from './dialects/index.ts'
import { declared, sniff } from './dialects/detect.ts'
import { lex } from './lexer.ts'
import { parse } from './parser.ts'
import { evaluateExpression, type VariableAnswer, type VariableKind, type Variables } from './variables.ts'

/** A host: a 1920x1080 S1, a gap of 40, a label, and one role mid-take. */
const TABLE: Record<string, VariableAnswer> = {
  's1.width': { ok: true, value: 1920 },
  's1.height': { ok: true, value: 1080 },
  's1.label': { ok: true, value: 'Main LED' },
  's1.pgm.l2.x': { ok: false, error: 'S1 is mid-take — which buffer is program changes as the transition lands' },
  'gap': { ok: true, value: 40 },
  'third': { ok: true, value: 33.3 },
  'n': { ok: true, value: 4 },
  'opener': { ok: true, value: 12 },
  'half': { ok: true, value: 2.5 },
  'big': { ok: true, value: 1e9 },
  'zero': { ok: true, value: 0 },
}

/** What the host was asked, so a test can see the name and the kind. */
const asked: Array<[string, VariableKind]> = []
const vars: Variables = {
  resolve(name, kind) {
    asked.push([name, kind])
    const key = name.toLowerCase()
    /* `$` and `@` are different namespaces: a system name is not a user one. */
    if (kind === 'system' && !key.startsWith('s1.')) return undefined
    if (kind === 'user' && key.startsWith('s1.')) return undefined
    return TABLE[key]
  },
}

/** A connected device: S1 and S3 at 1920x1080, program A, preview B. */
const facts = {
  buffer: (_t: unknown, mode: string) => (mode === 'PROGRAM' ? 'A' : 'B'),
  canvas: () => ({ w: 1920, h: 1080 }),
}

function compiled(line: string) {
  const parsed = parse(line, { vars })
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errors.map((e) => e.message).join('; ')}`)
  const c = compile(parsed.command, { facts } as never)
  if (!c.ok) throw new Error(`compile failed: ${c.errors.map((e) => e.message).join('; ')}`)
  return c
}

const values = (line: string) => compiled(line).ops.map((o) => o.value)
const paths = (line: string) => compiled(line).ops.map((o) => o.path.toAwj())

/** The first parse error, with the text it points at. */
function refusal(line: string, opts: Parameters<typeof parse>[1] = { vars }) {
  const parsed = parse(line, opts)
  if (parsed.ok) throw new Error(`expected "${line}" to be refused`)
  const e = parsed.errors[0]
  return { message: e.message, at: line.slice(e.start, e.end) }
}

// ---------------------------------------------------------------------------

describe('the tokens', () => {
  it('reads a dotted system name and a user name, sigils kept apart', () => {
    const { tokens, errors } = lex('$S1.PGM.L2.x @gap')
    expect(errors).toEqual([])
    expect(tokens.map((t) => (t.kind === 'variable' ? [t.sigil, t.name] : t.kind))).toEqual([
      ['$', 'S1.PGM.L2.x'],
      ['@', 'gap'],
    ])
  })

  it('does not swallow a full stop after a name', () => {
    const { tokens } = lex('@gap.')
    expect(tokens[0]).toMatchObject({ kind: 'variable', name: 'gap', end: 4 })
  })

  it('refuses a sigil with no name', () => {
    expect(lex('Size $ 2').errors[0].message).toMatch(/needs a name/)
    expect(lex('Size @9').errors[0].message).toMatch(/needs a name/)
  })

  it('keeps a % after a variable or a bracket, and nowhere else', () => {
    expect(lex('@third%').tokens.map((t) => t.kind)).toEqual(['variable', 'pct'])
    expect(lex('(@third)%').tokens.map((t) => t.kind)).toEqual(['lparen', 'variable', 'rparen', 'pct'])
    expect(lex('50%').tokens.map((t) => t.kind)).toEqual(['percent'])
    expect(lex('@third %').errors[0].message).toMatch(/Unexpected character "%"/)
  })

  it('leaves a label alone, whatever is in it', () => {
    const { tokens, errors } = lex('Label Memory 5 "Cost $5 (draft) @ 50%"')
    expect(errors).toEqual([])
    expect(tokens.at(-1)).toMatchObject({ kind: 'string', value: 'Cost $5 (draft) @ 50%' })
  })
})

// ---------------------------------------------------------------------------

describe('a variable stands wherever a number may', () => {
  it('sizes and places a layer from the canvas', () => {
    expect(values('Set Screen 1 Layer 2 Size ($S1.width / 2) $S1.height')).toEqual([960, 1080])
    expect(values('Set Screen 1 Layer 2 Position (@gap * 3) 540')).toEqual([120, 540])
  })

  it('takes a sign in front, as a number does', () => {
    expect(values('Set Screen 1 Layer 2 Position -(@gap * 2) -@gap')).toEqual([-80, -40])
  })

  it('takes a % after it, as a proportion of the canvas', () => {
    expect(values('Set Screen 1 Layer 2 Size @third% 100%')).toEqual([639, 1080])
    expect(values('Set Screen 1 Layer 2 Size (@third * 2)% 50%')).toEqual([1279, 540])
  })

  it('names screens, ranges, memories and sources', () => {
    expect(paths('Recall Screen 1 Thru @n Memory @opener')).toHaveLength(4)
    expect(paths('Recall Screen (@n - 1) Memory 5')).toEqual(paths('Recall Screen 3 Memory 5'))
    expect(paths('Store Master @opener')).toEqual(paths('Store Master 12'))
    expect(values('Set Screen 1 Layer 2 Source (@n - 1)')).toEqual(['LIVE_3'])
    expect(values('Set Screen 1 Layer 2 Source Still @n')).toEqual(['STILL_4'])
  })

  it('composes with Thru, + and -, which still mean a list outside brackets', () => {
    expect(paths('Take Screen 1 Thru @n - 2')).toEqual(paths('Take Screen 1 + 3 + 4'))
    /* The same characters inside brackets are a sum. */
    expect(paths('Take Screen (@n - 2)')).toEqual(paths('Take Screen 2'))
  })

  it('asks the host by name as typed, and says which kind of name it is', () => {
    asked.length = 0
    compiled('Set Screen 1 Layer 2 Size $S1.Width @GAP')
    expect(asked).toEqual([
      ['S1.Width', 'system'],
      ['GAP', 'user'],
    ])
  })

  it('evaluates with the usual precedence', () => {
    expect(values('Set Screen 1 Layer 2 Position (1 + 2 * 3) (( 1 + 2 ) * 3)')).toEqual([7, 9])
    expect(values('Set Screen 1 Layer 2 Position (100 - 10 - 5) (100 / 10 / 2)')).toEqual([85, 5])
  })
})

// ---------------------------------------------------------------------------

describe('what is refused, and where it points', () => {
  it('an unknown variable, underlined', () => {
    expect(refusal('Set Screen 1 Layer 2 Size $S1.widht 100')).toEqual({
      message: 'Unknown variable $S1.widht',
      at: '$S1.widht',
    })
  })

  it('a $ name is not an @ name', () => {
    expect(refusal('Set Screen 1 Layer 2 Size $gap 100').message).toBe('Unknown variable $gap')
  })

  it('text where a number goes', () => {
    expect(refusal('Set Screen 1 Layer 2 Size $S1.label 100').message).toMatch(/\$S1\.label is text \("Main LED"\), not a number/)
  })

  it('what the host refuses, in the host’s words', () => {
    const r = refusal('Set Screen 1 Layer 2 Position $S1.PGM.L2.x 0')
    expect(r.message).toMatch(/^\$S1\.PGM\.L2\.x: S1 is mid-take/)
    expect(r.at).toBe('$S1.PGM.L2.x')
  })

  it('every variable, when there is no host to ask', () => {
    expect(refusal('Recall Screen 1 Memory @opener', {}).message).toMatch(/need a host/)
  })

  it('division by zero, rather than a clamped Infinity', () => {
    expect(refusal('Set Screen 1 Layer 2 Size (1920 / @zero) 100')).toEqual({ message: 'Division by zero', at: '@zero' })
    expect(refusal('Set Screen 1 Layer 2 Size (1920 / (10 - 10)) 100').message).toBe('Division by zero')
  })

  it('a fraction where something is counted', () => {
    expect(refusal('Take Screen (5 / 2)')).toEqual({ message: 'Screen needs a whole number — (5/2) is 2.5', at: '(5 / 2)' })
    expect(refusal('Recall Screen 1 Memory @half').message).toMatch(/Memory needs a whole number — @half is 2.5/)
  })

  it('a range a variable has blown far out, without building it', () => {
    const t0 = Date.now()
    expect(refusal('Take Screen 1 Thru @big').message).toMatch(/out of range/)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('a result out of range, by the same rule a typed number meets', () => {
    expect(refusal('Take Screen (@n * 10)').message).toMatch(/Screen 40 out of range/)
  })

  it('arithmetic outside brackets, saying where it goes', () => {
    expect(refusal('Set Screen 1 Layer 2 Size @gap * 2').message).toMatch(/arithmetic goes inside brackets/)
    expect(refusal('Set Screen 1 Layer 2 Size $S1.width / 2').message).toMatch(/arithmetic goes inside brackets/)
  })

  it('a broken bracket', () => {
    expect(refusal('Take Screen (1 + 2').message).toBe('Unclosed bracket')
    expect(refusal('Take Screen ()').message).toMatch(/Expected a number, a variable or a bracket/)
    expect(refusal('Take Screen (1 + 2 Memory').message).toBe('Expected ")" here')
  })

  it('a percentage inside a bracket, which would be ambiguous', () => {
    expect(refusal('Set Screen 1 Layer 2 Size (50% + 10) 100').message).toMatch(/put the % after/)
  })

  it('nesting past the depth guard', () => {
    const deep = '('.repeat(40) + '1' + ')'.repeat(40)
    expect(refusal(`Take Screen ${deep}`).message).toMatch(/nested too deeply/)
    expect(paths('Take Screen ((((1))))')).toEqual(paths('Take Screen 1'))
  })
})

// ---------------------------------------------------------------------------

describe('evaluateExpression — a value standing on its own', () => {
  const value = (s: string) => {
    const r = evaluateExpression(s, vars)
    if (!r.ok) throw new Error(`${s}: ${r.error}`)
    return r.value
  }

  it('needs no brackets, because there is no list here for + and - to mean', () => {
    expect(value('$S1.width / 2')).toBe(960)
    expect(value('@gap*3')).toBe(120)
    expect(value('1080-80')).toBe(1000)
    expect(value('-(@gap + 10)')).toBe(-50)
  })

  it('refuses words, which would be a command, not a value', () => {
    expect(evaluateExpression('Take', vars).ok).toBe(false)
    expect(evaluateExpression('1 2', vars).ok).toBe(false)
    expect(evaluateExpression('', vars).ok).toBe(false)
    expect(evaluateExpression('@gap%', vars).ok).toBe(false)
  })

  it('refuses what the command line refuses', () => {
    expect(evaluateExpression('1/0', vars)).toMatchObject({ ok: false, error: 'Division by zero' })
    expect(evaluateExpression('@nope', vars)).toMatchObject({ ok: false, error: 'Unknown variable @nope' })
    expect(evaluateExpression('@gap')).toMatchObject({ ok: false })
  })
})

// ---------------------------------------------------------------------------

describe('through run(), in each language that has numbers', () => {
  it('hands a Mynah line the host’s variables', () => {
    const r = run('Set Screen 1 Layer 2 Size ($S1.width / 2) $S1.height', { vars, facts } as never)
    expect(r.ok && r.ops.map((o) => o.value)).toEqual([960, 1080])
  })

  it('evaluates an OSC argument for a number, and only for a number', () => {
    const ctx = { vars, osc: { buffer: facts.buffer } } as never
    const posH = run('/lp/screen/1/preset/a/layer/2/position/posH "$S1.width / 2"', ctx)
    expect(posH.ok && posH.ops[0].value).toBe(960)
    const gap = run('/lp/screen/1/preset/a/layer/2/position/posH @gap', ctx)
    expect(gap.ok && gap.ops[0].value).toBe(40)
    /* A plain number typed as a string is still the number. */
    const plain = run('/lp/screen/1/preset/a/layer/2/position/posH "-960"', ctx)
    expect(plain.ok && plain.ops[0].value).toBe(-960)
    /* An enum's value name is not arithmetic, and is not evaluated. */
    const src = run('/lp/screen/1/preset/b/layer/1/source/inputNum LIVE_3', ctx)
    expect(src.ok && src.ops[0].value).toBe('LIVE_3')
  })

  it('refuses an OSC variable the host cannot read, naming the parameter', () => {
    const r = run('/lp/screen/1/preset/a/layer/2/position/posH @nope', { vars } as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors[0].message).toMatch(/position\/posH — Unknown variable @nope/)
    const none = run('/lp/screen/1/preset/a/layer/2/position/posH @gap')
    expect(none.ok).toBe(false)
  })
})

describe('detection', () => {
  it('still reads a line with variables as Mynah', () => {
    expect(sniff('Recall Screen 1 Memory @opener')).toBe('mynah')
    expect(sniff('Set Screen 1 Layer 2 Size ($S1.width / 2) $S1.height')).toBe('mynah')
    /* A user variable may be called `items` or `props`; only a path has them after a slash. */
    expect(sniff('Set Screen 1 Layer 2 Size (@items / 2) 100')).toBe('mynah')
    expect(sniff('DeviceObject/$screen/@items/S1/@props/x')).toBe('awj')
    expect(declared('MYNAH Recall Screen 1 Memory @opener').language).toBe('mynah')
  })
})
