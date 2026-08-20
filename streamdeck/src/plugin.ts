/**
 * Mynah for Stream Deck.
 *
 * A second front end onto the same grammar. Elgato's software owns the panel,
 * so this cannot be done from the browser the way an X-Keys panel can — the
 * plugin runs as its own process and opens its own WebSocket to the switcher.
 * It shares the parser, the compiler and the link with the web tool and adds
 * only the Stream Deck event plumbing.
 */

import { compile } from '../../src/lang/compile.ts'
import { parse } from '../../src/lang/parser.ts'
import { WebRcsLink } from '../../src/link/webrcs.ts'

interface Settings {
  host?: string
  port?: number
  command?: string
}

/** One link per device, shared by every key pointed at that device. */
const links = new Map<string, WebRcsLink>()

function linkFor(host: string, port: number): WebRcsLink {
  const key = `${host}:${port}`
  let link = links.get(key)
  if (!link) {
    link = new WebRcsLink(WebRcsLink.urlFor(host, port))
    link.connect()
    links.set(key, link)
  } else if (link.state === 'closed' || link.state === 'error') {
    // Reconnect lazily on use rather than on a timer: a key that is never
    // pressed has no reason to hold a socket open on a show network.
    link.connect()
  }
  return link
}

let sd: WebSocket | undefined

function setTitle(context: string, title: string): void {
  sd?.send(JSON.stringify({ event: 'setTitle', context, payload: { title, target: 0 } }))
}

function showOk(context: string): void {
  sd?.send(JSON.stringify({ event: 'showOk', context }))
}

function showAlert(context: string): void {
  sd?.send(JSON.stringify({ event: 'showAlert', context }))
}

function run(context: string, settings: Settings): void {
  const command = (settings.command ?? '').trim()
  if (command === '') return showAlert(context)

  const parsed = parse(command)
  if (!parsed.ok) return showAlert(context)

  // A Stream Deck key has no sticky scope of its own: the panel is not where
  // the operator is looking, and a key whose meaning depends on invisible
  // state is a key that eventually fires at the wrong screen. Every key
  // command must name its own scope.
  const compiled = compile(parsed.command)
  if (!compiled.ok || compiled.ops.length === 0) return showAlert(context)

  const link = linkFor(settings.host ?? '127.0.0.1', settings.port ?? 80)
  if (link.state !== 'open') return showAlert(context)

  let sent = true
  for (const op of compiled.ops) {
    if (!link.write(op.path.toWs(), op.value)) sent = false
  }
  if (sent) showOk(context)
  else showAlert(context)
}

/** Stream Deck calls this global once the plugin process starts. */
;(globalThis as Record<string, unknown>).connectElgatoStreamDeckSocket = (
  port: string,
  uuid: string,
  registerEvent: string,
) => {
  sd = new WebSocket(`ws://127.0.0.1:${port}`)

  sd.onopen = () => {
    sd?.send(JSON.stringify({ event: registerEvent, uuid }))
  }

  sd.onmessage = (ev) => {
    let msg: { event?: string; context?: string; payload?: { settings?: Settings } }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    const context = msg.context
    if (!context) return
    const settings = msg.payload?.settings ?? {}

    switch (msg.event) {
      case 'keyDown':
        run(context, settings)
        break
      case 'willAppear':
      case 'didReceiveSettings':
        // Label the key with the command so a panel of them can be read at a
        // glance, which is the whole reason to put commands on hardware.
        setTitle(context, keyTitle(settings.command))
        break
    }
  }
}

/**
 * Shorten a command to something that fits a key.
 *
 * Long enough to tell two keys apart, short enough to stay legible: the verb
 * and the numbers are what distinguish one memory recall from another.
 */
function keyTitle(command?: string): string {
  const trimmed = (command ?? '').trim()
  if (trimmed === '') return ''
  const parsed = parse(trimmed)
  if (!parsed.ok) return '⚠︎'

  const c = parsed.command
  const bits: string[] = [c.fn]
  if (c.scope.master) bits.push('Mast')
  if (c.scope.screens) bits.push(`S${c.scope.screens.values.join('.')}`)
  if (c.scope.auxes) bits.push(`A${c.scope.auxes.values.join('.')}`)
  if (c.scope.layers?.numbers.values.length) bits.push(`L${c.scope.layers.numbers.values.join('.')}`)
  if (c.memory !== undefined) bits.push(`M${c.memory}`)
  return bits.join('\n')
}
