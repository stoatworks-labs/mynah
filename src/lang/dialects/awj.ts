/**
 * AWJ, typed by hand.
 *
 * The Analog Way AWJ protocol is one JSON object per message, terminated by
 * ASCII 0x04, on TCP 10606:
 *
 * ```json
 * {"op":"replace","path":"DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake","value":true}
 * ```
 *
 * Exactly one `op`, and it is only ever `replace` or `get` — despite the
 * "JSON Patch" framing there is no add, remove or test. That is the whole
 * protocol, which is why it can be a command language rather than a library.
 *
 * ## What this parses, and what it does not decide
 *
 * This turns text into ops and reads. It does **not** decide how they reach
 * the switcher. A `replace` compiled here is a path and a value, and the host
 * either renders it back to AWJ over a real socket on 10606 or converts it to
 * the Web RCS store spelling and sends it on the connection the vendor app
 * already has. `Path` holds both spellings, so neither transport is privileged
 * and the same typed line works on both.
 *
 * ## The shorthand, and why it exists
 *
 * Nobody types `{"op":"replace","path":"…","value":true}` twice. So:
 *
 * ```text
 * replace DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
 * DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
 * get DeviceObject/system/$device/@items/1/@props/dev
 * ```
 *
 * all mean what they look like. The canonical JSON form is still accepted
 * verbatim — including a trailing 0x04 — so a message copied out of a packet
 * capture or a vendor document pastes in and runs.
 *
 * ## Values: JSON first, bare word second
 *
 * A value is parsed as JSON, and if that fails it is taken as a string. That
 * is deliberate and it is for the enums: the device's own spelling of a source
 * is `LIVE_3`, which is not JSON, and requiring `"LIVE_3"` would make the
 * common case the awkward one. Numbers, `true`, `false` and `null` all parse
 * as JSON and so keep their types; only something that is not valid JSON at
 * all falls through to being a string.
 */

import type { Op } from '../compile.ts'
import { Path } from '../paths.ts'

import type { LineError, Read, RunResult } from './types.ts'

/** The AWJ message terminator. Tolerated on input; never required. */
const EOT = '\u0004'

interface Message {
  readonly op: 'replace' | 'get'
  readonly path: string
  readonly value?: unknown
}

const fail = (message: string): RunResult => ({
  ok: false,
  language: 'awj',
  declared: false,
  errors: [{ message }],
})

export function run(body: string): RunResult {
  let messages: Message[]
  try {
    messages = split(body)
  } catch (err) {
    return fail((err as Error).message)
  }
  if (messages.length === 0) return fail('no AWJ message')

  const ops: Op[] = []
  const reads: Read[] = []
  const errors: LineError[] = []

  for (const msg of messages) {
    let path: Path
    try {
      path = Path.fromAwj(msg.path)
    } catch (err) {
      errors.push({ message: `${msg.path}: ${(err as Error).message}` })
      continue
    }

    /* An AWJ GET on a container answers `{}` rather than an error, so a path
       that stops short of a property reads as a successful read of nothing.
       Saying so here costs one line and saves the confusion outright. */
    if (!path.isLeaf) {
      errors.push({
        message: `${msg.path} is not a property — AWJ answers {} for a container, which reads as an empty result rather than a mistake`,
      })
      continue
    }

    if (msg.op === 'get') {
      reads.push({ path, describe: `Read ${path.toAwj()}` })
    } else {
      ops.push({ path, value: msg.value, describe: `${path.toAwj()} = ${render(msg.value)}` })
    }
  }

  if (errors.length) return { ok: false, language: 'awj', declared: false, errors }

  return {
    ok: true,
    language: 'awj',
    declared: false,
    ops,
    reads,
    summary: summarise(ops.length, reads.length),
  }
}

function summarise(writes: number, reads: number): string {
  const parts: string[] = []
  if (writes) parts.push(`${writes} write${writes === 1 ? '' : 's'}`)
  if (reads) parts.push(`${reads} read${reads === 1 ? '' : 's'}`)
  return `AWJ — ${parts.join(', ')}`
}

/** A value as it would read in a message, for the confirmation preview. */
const render = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/**
 * Break a line into messages.
 *
 * Three input shapes, checked in the order that cannot mistake one for
 * another: a JSON array of messages, one or more 0x04-terminated JSON
 * objects, or the shorthand. A line is all one shape — mixing them would need
 * a tokeniser and would buy nothing.
 */
function split(body: string): Message[] {
  const text = body.trim()
  if (text === '') return []

  if (text.startsWith('[')) {
    const arr = JSON.parse(text)
    if (!Array.isArray(arr)) throw new Error('expected an array of AWJ messages')
    return arr.map(fromObject)
  }

  if (text.startsWith('{')) {
    return text
      .split(EOT)
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map((s) => fromObject(JSON.parse(s)))
  }

  return [shorthand(text)]
}

function fromObject(raw: unknown): Message {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('an AWJ message is a JSON object')
  }
  const obj = raw as Record<string, unknown>
  const op = obj.op
  if (op !== 'replace' && op !== 'get') {
    /* Worth naming the closed set: "JSON Patch" leads people to try `add`. */
    throw new Error(`op must be "replace" or "get" — AWJ has no others (got ${JSON.stringify(op)})`)
  }
  if (typeof obj.path !== 'string' || obj.path === '') throw new Error('path must be a string')
  if (op === 'replace' && !('value' in obj)) throw new Error('a replace needs a value')
  return { op, path: obj.path, value: obj.value }
}

/**
 * The shorthand form.
 *
 * `=` separates path from value where there is one. It is found from the
 * *first* `=`, because a value may contain one and a path may not.
 */
function shorthand(text: string): Message {
  const verb = /^(replace|get)\s+/i.exec(text)
  const rest = verb ? text.slice(verb[0].length).trim() : text
  const op = verb ? (verb[1].toLowerCase() as 'replace' | 'get') : null

  const eq = rest.indexOf('=')
  if (eq < 0) {
    if (op === 'replace') throw new Error('a replace needs a value: replace <path> = <value>')
    return { op: 'get', path: rest }
  }

  const path = rest.slice(0, eq).trim()
  const value = rest.slice(eq + 1).trim()
  if (path === '') throw new Error('missing path')
  if (value === '') throw new Error('missing value')
  if (op === 'get') throw new Error('a get takes no value')
  return { op: 'replace', path, value: parseValue(value) }
}

/** JSON if it parses, otherwise the bare text — see the note at the top. */
function parseValue(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
