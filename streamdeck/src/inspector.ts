/**
 * The property inspector — where a key's command is typed.
 *
 * It parses and compiles as you type, using the same core the plugin and the
 * web tool use, so a key that will not work says so while you are configuring
 * it rather than during a show.
 */

import { compile } from '../../src/lang/compile.ts'
import { parse } from '../../src/lang/parser.ts'

interface Settings {
  host?: string
  port?: number
  command?: string
}

let sd: WebSocket | undefined
let uuid = ''
let settings: Settings = {}

const el = (id: string) => document.getElementById(id) as HTMLInputElement
const preview = () => document.getElementById('preview') as HTMLDivElement

function save(): void {
  sd?.send(JSON.stringify({ event: 'setSettings', context: uuid, payload: settings }))
}

function render(): void {
  const command = (settings.command ?? '').trim()
  const box = preview()
  if (command === '') {
    box.className = ''
    box.textContent = ''
    return
  }

  const parsed = parse(command)
  if (!parsed.ok) {
    box.className = 'bad'
    box.textContent = parsed.errors[0].message
    return
  }

  // No sticky scope on a Stream Deck key, so this compiles exactly as the
  // plugin will run it — including failing when the command relies on a
  // selection that only exists in the web tool.
  const compiled = compile(parsed.command)
  if (!compiled.ok) {
    box.className = 'bad'
    box.textContent = compiled.errors[0].message
    return
  }

  box.className = 'ok'
  box.innerHTML = ''
  const summary = document.createElement('div')
  summary.textContent = `${compiled.summary} — ${compiled.ops.length} op${compiled.ops.length === 1 ? '' : 's'}`
  box.appendChild(summary)

  const first = compiled.ops[0]
  if (first) {
    const path = document.createElement('code')
    path.textContent = first.path.toAwj()
    box.appendChild(path)
  }
}

function bind(id: string, read: (v: string) => void): void {
  el(id).addEventListener('input', () => {
    read(el(id).value)
    save()
    render()
  })
}

;(globalThis as Record<string, unknown>).connectElgatoStreamDeckSocket = (
  port: string,
  inUUID: string,
  registerEvent: string,
  _info: string,
  actionInfo: string,
) => {
  uuid = inUUID
  try {
    settings = JSON.parse(actionInfo)?.payload?.settings ?? {}
  } catch {
    settings = {}
  }

  el('host').value = settings.host ?? ''
  el('port').value = settings.port === undefined ? '' : String(settings.port)
  el('command').value = settings.command ?? ''
  render()

  bind('host', (v) => (settings.host = v))
  bind('port', (v) => (settings.port = v === '' ? undefined : Number(v)))
  bind('command', (v) => (settings.command = v))

  sd = new WebSocket(`ws://127.0.0.1:${port}`)
  sd.onopen = () => sd?.send(JSON.stringify({ event: registerEvent, uuid: inUUID }))
}
