/**
 * Raw store JSON — the Web RCS API, typed straight at the switcher.
 *
 * This is the *other* spelling of the same object model AWJ addresses. The
 * vendor's own web app carries it on a WebSocket, one message per property:
 *
 * ```json
 * {"channel":"DEVICE","data":{"path":["device","screenAuxGroupList","items","S1","control","pp","xTake"],"value":true}}
 * ```
 *
 * and the same shape comes back out of `GET /api/stores/device`. Being able to
 * type it matters for exactly one reason: when something is wrong, the thing
 * an operator has in front of them is a frame off the wire or a subtree out of
 * the store dump, and they want to replay it, not translate it.
 *
 * ## Four accepted shapes, all the same thing
 *
 * ```json
 * {"path":["device","…","pp","xTake"],"value":true}
 * {"path":"device/…/pp/xTake","value":true}
 * {"channel":"DEVICE","data":{"path":[…],"value":true}}
 * [ … any of the above … ]
 * ```
 *
 * The envelope is unwrapped rather than rejected because that is the form that
 * appears in a browser's network panel, and asking someone to strip it by hand
 * before pasting is asking them to make a mistake.
 *
 * ## A leading `device` is optional
 *
 * Every store path starts with it, and `Path` supplies it on the way out, so
 * both `["device","screenList",…]` and `["screenList",…]` address the same
 * node. Accepting both is not sloppiness: a subtree copied out of the store
 * dump has already had the root peeled off by whatever navigated to it.
 *
 * ## There is no read here
 *
 * Unlike AWJ, this spelling has no `get`. The Web RCS socket is a stream of
 * changes, not a request/response channel — a value is read from the mirrored
 * store, which every host of this language already has. Ask for a read in AWJ.
 */

import type { Op } from '../compile.ts'
import { Path } from '../paths.ts'

import type { LineError, RunResult } from './types.ts'

interface Write {
  readonly path: readonly string[] | string
  readonly value: unknown
}

const fail = (message: string): RunResult => ({
  ok: false,
  language: 'json',
  declared: false,
  errors: [{ message }],
})

export function run(body: string): RunResult {
  const text = body.trim()
  if (text === '') return fail('no JSON')

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return fail(`not JSON: ${(err as Error).message}`)
  }

  let writes: Write[]
  try {
    writes = (Array.isArray(raw) ? raw : [raw]).map(unwrap)
  } catch (err) {
    return fail((err as Error).message)
  }
  if (writes.length === 0) return fail('no writes in that JSON')

  const ops: Op[] = []
  const errors: LineError[] = []

  for (const w of writes) {
    let path: Path
    try {
      path = Path.fromWs(w.path)
    } catch (err) {
      errors.push({ message: `${render(w.path)}: ${(err as Error).message}` })
      continue
    }
    ops.push({
      path,
      value: w.value,
      describe: `${path.toWs().join('/')} = ${render(w.value)}`,
    })
  }

  if (errors.length) return { ok: false, language: 'json', declared: false, errors }

  return {
    ok: true,
    language: 'json',
    declared: false,
    ops,
    reads: [],
    summary: `Store — ${ops.length} write${ops.length === 1 ? '' : 's'}`,
  }
}

const render = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v))

/** Peel the socket envelope off, if there is one, and check what is left. */
function unwrap(raw: unknown): Write {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('expected a {path, value} object')
  }
  const obj = raw as Record<string, unknown>

  if (obj.channel !== undefined) {
    if (obj.channel !== 'DEVICE') {
      /* REMOTE is the vendor UI's own view state and LOG is a log line.
         Neither is a device write, and sending one would be nonsense. */
      throw new Error(`channel ${JSON.stringify(obj.channel)} is not a device write — only DEVICE is`)
    }
    return unwrap(obj.data)
  }

  const path = obj.path
  if (!Array.isArray(path) && typeof path !== 'string') {
    throw new Error('path must be an array of segments or a slash-joined string')
  }
  if (!('value' in obj)) throw new Error('a store write needs a value')
  return { path: path as readonly string[] | string, value: obj.value }
}
