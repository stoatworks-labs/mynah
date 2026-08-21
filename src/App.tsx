import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { compile, type Selection } from './lang/compile.ts'
import { completions, keywordTable } from './lang/keywords.ts'
import { parse } from './lang/parser.ts'
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

  // Live parse of whatever is typed, for the preview strip under the line.
  const preview = useMemo(() => {
    const trimmed = input.trim()
    if (trimmed === '') return undefined
    const parsed = parse(trimmed)
    if (!parsed.ok) {
      return { ok: false as const, message: parsed.errors[0].message }
    }
    const compiled = compile(parsed.command, { selection })
    if (!compiled.ok) {
      return { ok: false as const, message: compiled.errors[0].message }
    }
    const empty =
      parsed.command.fn === 'Recall' ? slotEmpty(compiled.bank, compiled.slot) : undefined
    return {
      ok: true as const,
      summary: compiled.summary,
      ops: compiled.ops,
      selection: compiled.selection,
      warning: empty ? `Memory ${compiled.slot} is empty — the device will accept this and do nothing` : undefined,
    }
  }, [input, selection, slotEmpty])

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

    const parsed = parse(trimmed)
    if (!parsed.ok) return

    const compiled = compile(parsed.command, { selection })
    if (!compiled.ok) return

    if (parsed.command.fn === 'Clear') {
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

    if (compiled.selection) {
      setSelection(compiled.selection)
      link.note(trimmed, compiled.summary)
      setInput('')
      return
    }

    link.send(
      trimmed,
      compiled.summary,
      compiled.ops,
      parsed.command.fn === 'Recall' ? compiled.slot : undefined,
    )
    setInput('')
  }, [input, selection, link])

  /** A hardware key runs a command string exactly as if it were typed. */
  const runCommand = useCallback(
    (command: string) => {
      const parsed = parse(command)
      if (!parsed.ok) {
        link.note(command, `Rejected: ${parsed.errors[0].message}`)
        return
      }
      const compiled = compile(parsed.command, { selection })
      if (!compiled.ok) {
        link.note(command, `Rejected: ${compiled.errors[0].message}`)
        return
      }
      if (compiled.selection) {
        setSelection(compiled.selection)
        link.note(command, compiled.summary)
        return
      }
      link.send(
        command,
        compiled.summary,
        compiled.ops,
        parsed.command.fn === 'Recall' ? compiled.slot : undefined,
      )
    },
    [selection, link],
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
