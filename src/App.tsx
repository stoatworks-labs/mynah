import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { bufferForMode } from './lang/model.ts'
import { type DeviceFacts, type Selection } from './lang/compile.ts'
import { completions, keywordTable } from './lang/keywords.ts'
import { LANGUAGE_LABELS, declared, run as runLine, sniff } from './lang/dialects/index.ts'
import type { AwjMessage } from './link/transport.ts'
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings.ts'
import { LanguageBar } from './components/LanguageBar.tsx'
import { VERIFIED_FIRMWARE } from './lang/model.ts'
import { SIMULATOR_PORT, mixedContentBlocked } from './link/webrcs.ts'
import { SimDevice } from './sim/device.ts'
import { Wireframe } from './components/Wireframe.tsx'
import { fetchBankIndex, type BankIndex } from './link/banks.ts'
import { useLink } from './useLink.ts'
import { CommandLine } from './components/CommandLine.tsx'
import { ConnectionBar } from './components/ConnectionBar.tsx'
import { Log } from './components/Log.tsx'
import { KeywordHelp } from './components/KeywordHelp.tsx'
import { DeviceBar } from './components/DeviceBar.tsx'
import { useXKeys } from './hid/useXKeys.ts'

const describeTarget = (t: Selection['targets'][number]) =>
  t.kind === 'screen' ? `Screen ${t.n}` : `Aux ${t.n}`

export function App() {
  const link = useLink()
  const [input, setInput] = useState('')
  const [selection, setSelection] = useState<Selection | undefined>()
  const [followVendor, setFollowVendor] = useState(true)
  const [banks, setBanks] = useState<BankIndex | undefined>()
  const [indexing, setIndexing] = useState(false)
  const [indexError, setIndexError] = useState<string | undefined>()
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(SIMULATOR_PORT)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * The hosted copy runs the built-in simulator, because it cannot do anything
   * else: a page on https is blocked from reaching a switcher, which is
   * http-only with 443 closed. Offering a connection box there would be
   * offering a button that can only fail.
   */
  const [demo, setDemo] = useState(() => mixedContentBlocked())
  const simRef = useRef<SimDevice>(new SimDevice())
  const [simTick, setSimTick] = useState(0)

  const connect = useCallback(
    (h: string, p: number) =>
      demo
        ? link.connect(h, p, { device: simRef.current, onChanged: () => setSimTick((t) => t + 1) })
        : link.connect(h, p),
    [demo, link],
  )

  /**
   * The memory index costs a 124 MB download, so it is asked for rather than
   * fetched on connect. Without it the command line still works — it simply
   * cannot tell you that the memory you are about to recall is empty.
   */
  const indexMemories = useCallback(() => {
    setIndexing(true)
    setIndexError(undefined)
    fetchBankIndex(`http://${host}:${port}`)
      .then(setBanks)
      .catch(() => {
        setBanks(undefined)
        // The device serves no Access-Control-Allow-Origin, so this only ever
        // succeeds same-origin or through a proxy. The command line does not
        // need it: an empty memory is still caught after the fact, because the
        // device answers a recall of one with silence.
        setIndexError('Blocked by CORS — the device sends no cross-origin header')
      })
      .finally(() => setIndexing(false))
  }, [host, port])

  /** Whether a slot is known to be empty. Undefined means simply not known. */
  const slotEmpty = useCallback(
    (bank?: string, slot?: number): boolean | undefined => {
      if (!banks || bank === undefined || slot === undefined) return undefined
      const list =
        bank === 'master' ? banks.master : bank === 'layer' ? banks.layer : bank === 'screen' || bank === 'aux' ? banks.screen : undefined
      if (!list) return undefined
      return !list.some((s) => s.slot === slot && s.valid)
    },
    [banks],
  )

  /**
   * The vendor Web RCS has its own screen selection and it rides the same
   * socket. Following it means selecting a screen in either place selects it
   * in both, which is what an operator with the vendor UI on one monitor and
   * this on another will expect. It is a setting because a cue-driven scope
   * that a passing click can move is worse than no sync at all.
   */
  useEffect(() => {
    if (!followVendor || link.remoteSelection.length === 0) return
    const targets = link.remoteSelection
      .map((k) => {
        const m = /^([SA])(\d+)$/.exec(k)
        if (!m) return undefined
        return { kind: m[1] === 'S' ? ('screen' as const) : ('aux' as const), n: Number(m[2]) }
      })
      .filter((t): t is NonNullable<typeof t> => t !== undefined)
    if (targets.length > 0) setSelection((prev) => ({ targets, layers: prev?.layers }))
  }, [followVendor, link.remoteSelection])

  /**
   * Answer the compiler's two questions from what the device has reported.
   *
   * Both return undefined when unknown, and the compiler refuses the command
   * with the reason rather than guessing — putting a layer somewhere nobody
   * asked for is worse than saying "not yet".
   */
  const facts = useMemo<DeviceFacts>(
    () => ({
      buffer: (t, mode) => {
        const f = link.facts.get(t.kind === 'screen' ? `S${t.n}` : `A${t.n}`)
        if (!f?.transition || !f.presetUp || !f.presetDown) return undefined
        return bufferForMode(mode, f.transition, f.presetUp as 'A' | 'B' | 'C', f.presetDown as 'A' | 'B' | 'C')
      },
      canvas: (t) => {
        const f = link.facts.get(t.kind === 'screen' ? `S${t.n}` : `A${t.n}`)
        return f?.canvasW && f.canvasH ? { w: f.canvasW, h: f.canvasH } : undefined
      },
    }),
    [link.facts],
  )

  /* Restored after first paint rather than in the initial state, so a build
     rendered where there is no localStorage — a test, an SSR probe — comes up
     on the defaults instead of throwing before anything is on screen. */
  useEffect(() => setSettings(loadSettings()), [])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next)
      return next
    })
  }, [])

  /**
   * Everything the four languages need to compile a line.
   *
   * The OSC resolver takes the same `buffer` question the compiler does, for
   * the same reason: `preview` and `program` name whichever preset buffer is
   * pending or live right now, and a take swaps them. One source of that fact,
   * used by both.
   */
  const runContext = useMemo(
    () => ({
      selection,
      facts,
      language: settings.language,
      osc: { buffer: facts.buffer },
    }),
    [selection, facts, settings.language],
  )

  /**
   * Which language the line currently being typed is being read as.
   *
   * Only meaningful on `All` — with a language pinned there is nothing to
   * detect and the strip says nothing. Shown live because a misread line
   * produces an error about a character rather than about a command, which
   * reads as the operator's own typo rather than as a wrong guess.
   */
  const detectedLanguage = useMemo(() => {
    if (settings.language !== 'all') return undefined
    const trimmed = input.trim()
    if (trimmed === '') return undefined
    const head = declared(trimmed)
    const id = head.language ?? sniff(head.body)
    return head.language ? `${LANGUAGE_LABELS[id]} (declared)` : LANGUAGE_LABELS[id]
  }, [input, settings.language])

  /**
   * A compiled line as AWJ messages, for the real-socket transport.
   *
   * Rendered from `Path` rather than kept from the text the operator typed:
   * the shorthand forms and the canonical form must reach the device
   * identically, and a path that survived `Path.fromAwj` is one this app has
   * actually understood rather than one it is passing through untouched.
   */
  const asAwj = useCallback(
    (result: Extract<ReturnType<typeof runLine>, { ok: true }>): AwjMessage[] => [
      ...result.ops.map((op) => ({ op: 'replace' as const, path: op.path.toAwj(), value: op.value })),
      ...result.reads.map((r) => ({ op: 'get' as const, path: r.path.toAwj() })),
    ],
    [],
  )

  /**
   * Whether this line should go out on a real AWJ socket.
   *
   * Two ways it can: the operator chose that transport for AWJ, or the line
   * contains a read, which nothing else can answer. A read with no socket
   * available is refused by name rather than quietly dropped — see `execute`.
   */
  const wantsAwjSocket = useCallback(
    (result: Extract<ReturnType<typeof runLine>, { ok: true }>): boolean => {
      if (!link.canAwj) return false
      if (result.reads.length > 0) return true
      return result.language === 'awj' && settings.awjTransport === 'socket'
    },
    [link.canAwj, settings.awjTransport],
  )

  // Live parse of whatever is typed, for the preview strip under the line.
  const preview = useMemo(() => {
    const trimmed = input.trim()
    if (trimmed === '') return undefined
    const result = runLine(trimmed, runContext)
    if (!result.ok) return { ok: false as const, message: result.errors[0].message }

    const empty = result.fn === 'Recall' ? slotEmpty(result.bank, result.slot) : undefined

    /* A read the current transport cannot perform is worth saying *before*
       Enter, because the alternative is a command that appears to run and
       reports nothing back. */
    const unanswerable =
      result.reads.length > 0 && !link.canAwj
        ? 'A get needs a real AWJ socket on TCP 10606 — run the desktop app'
        : undefined

    return {
      ok: true as const,
      summary: result.summary,
      ops: result.ops,
      selection: result.selection,
      warning:
        unanswerable ??
        (empty ? `Memory ${result.slot} is empty — the device will accept this and do nothing` : undefined),
    }
  }, [input, runContext, slotEmpty, link.canAwj])

  const history = useMemo(() => link.log.map((e) => e.input), [link.log])

  const suggestions = useMemo(() => {
    const lastWord = /([A-Za-z]+)$/.exec(input)?.[1] ?? ''
    if (lastWord === '') return []
    const hits = completions(lastWord)
    return hits.length > 1 || (hits.length === 1 && hits[0].word.toLowerCase() !== lastWord.toLowerCase())
      ? hits.slice(0, 8)
      : []
  }, [input])

  const execute = useCallback(() => {
    const trimmed = input.trim()
    if (trimmed === '') return

    const result = runLine(trimmed, runContext)
    if (!result.ok) return

    if (result.fn === 'Clear') {
      // Clear takes the command line first, and the scope only once the line
      // is already empty — so a mistyped command is never one keystroke away
      // from also losing the scope it was going to act on.
      if (input.trim() !== 'Clear' && input.trim() !== '') {
        setInput('')
        return
      }
      setSelection(undefined)
      link.note(trimmed, 'Scope cleared')
      setInput('')
      return
    }

    if (result.selection) {
      setSelection(result.selection)
      link.note(trimmed, result.summary)
      setInput('')
      return
    }

    /* A read is refused out loud rather than dropped. The whole point of a get
       is the answer, so a build that cannot fetch one has to say so — a
       command that appears to run and reports nothing is the worse outcome. */
    if (result.reads.length > 0 && !link.canAwj) {
      link.note(trimmed, 'Rejected: a get needs a real AWJ socket on TCP 10606 — run the desktop app')
      setInput('')
      return
    }

    if (wantsAwjSocket(result)) {
      link.sendAwj(trimmed, result.summary, asAwj(result))
      setInput('')
      return
    }

    /* A trigger whose OSC argument was a button release compiles to nothing.
       Logged rather than silently swallowed, so a surface that is sending
       something the console is right to ignore still shows up. */
    if (result.ops.length === 0) {
      link.note(trimmed, result.summary)
      setInput('')
      return
    }

    link.send(trimmed, result.summary, result.ops, result.fn === 'Recall' ? result.slot : undefined)
    setInput('')
  }, [input, runContext, link, asAwj, wantsAwjSocket])

  /** A hardware key runs a command string exactly as if it were typed. */
  const runCommand = useCallback(
    (command: string) => {
      const result = runLine(command, runContext)
      if (!result.ok) {
        link.note(command, `Rejected: ${result.errors[0].message}`)
        return
      }
      if (result.selection) {
        setSelection(result.selection)
        link.note(command, result.summary)
        return
      }
      if (wantsAwjSocket(result)) {
        link.sendAwj(command, result.summary, asAwj(result))
        return
      }
      if (result.reads.length > 0) {
        link.note(command, 'Rejected: a get needs a real AWJ socket on TCP 10606')
        return
      }
      if (result.ops.length === 0) {
        link.note(command, result.summary)
        return
      }
      link.send(command, result.summary, result.ops, result.fn === 'Recall' ? result.slot : undefined)
    },
    [runContext, link, asAwj, wantsAwjSocket],
  )

  const xkeys = useXKeys(runCommand)

  const scopeLabel = selection
    ? [
        selection.targets.map(describeTarget).join(', ') || undefined,
        selection.layers && selection.layers.length > 0
          ? `Layer ${selection.layers.join(', ')}`
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <div className="app">
      <header className="masthead">
        <div>
          <h1>Mynah</h1>
          <p className="tagline">A command line for LivePremier</p>
        </div>
        <ConnectionBar
          state={link.state}
          detail={link.stateDetail}
          host={host}
          port={port}
          onHost={setHost}
          onPort={setPort}
          onConnect={connect}
          onDisconnect={link.disconnect}
          demo={demo}
          onDemo={(v) => {
            link.disconnect()
            setDemo(v)
          }}
          demoLocked={mixedContentBlocked()}
        />
      </header>

      <LanguageBar
        language={settings.language}
        onLanguage={(language) => updateSettings({ language })}
        awjTransport={settings.awjTransport}
        onAwjTransport={(awjTransport) => updateSettings({ awjTransport })}
        canAwj={link.canAwj}
        detected={detectedLanguage}
      />

      <DeviceBar
        scope={scopeLabel}
        followVendor={followVendor}
        onFollowVendor={setFollowVendor}
        xkeys={xkeys}
        banks={banks}
        indexing={indexing}
        indexError={indexError}
        canIndex={link.state === 'open'}
        onIndex={indexMemories}
      />

      {demo && (
        <div className="demo-banner" role="status">
          <strong>Demo mode — this is a simulator, not a switcher.</strong>
          <span>
            Commands run against a model of a LivePremier built into the page, so you can learn the
            syntax and watch what each command does. Nothing here reaches real hardware.
          </span>
        </div>
      )}

      <main className="main">
        <section className="console">
          <CommandLine
            ref={inputRef}
            value={input}
            onChange={setInput}
            onSubmit={execute}
            preview={preview}
            suggestions={suggestions}
            history={history}
          />
          {demo && <Wireframe device={simRef.current} tick={simTick} />}
          <Log entries={link.log} onClear={link.clearLog} />
        </section>

        <aside className="side">
          <KeywordHelp table={keywordTable()} />
        </aside>
      </main>

      <footer className="footer">
        <span>{__APP_VERSION__}</span>
        <span>Paths verified against LivePremier firmware {VERIFIED_FIRMWARE}</span>
      </footer>
    </div>
  )
}
