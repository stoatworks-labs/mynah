// @vitest-environment jsdom

/**
 * The echo matcher, against what a device actually echoes.
 *
 * A write is acknowledged by its own value coming back on the socket — not by
 * a `true`. That distinction is the whole of this file. An earlier matcher
 * accepted only `true`, so anything writing a string or an array could never
 * be confirmed: a preset label and every master record-mask filter landed
 * perfectly and were reported as unconfirmed. It was found on a physical
 * Aquilon C (NLC_C, firmware 6.2.73) and fixed in 65644fd, and the shapes
 * asserted below are the ones that run captured:
 *
 *   - a label echoed back as the STRING "FIELDTEST", 31 ms later
 *   - a record mask echoed back as the ARRAY ["SOURCE","POS"], 155 ms later
 *
 * The timings are not asserted — they are a property of the device rather than
 * of this code, and the simulator echoes synchronously — but they are why the
 * values here are these values.
 *
 * These run against `SimDevice` through `SimLink`, which is the real transport
 * the hosted build uses, so the hook is exercised whole rather than through a
 * stub of its own matcher.
 */

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'

import { compile, type Op } from './lang/compile.ts'
import { parse } from './lang/parser.ts'
import { Path } from './lang/paths.ts'
import { SimDevice, type Push } from './sim/device.ts'
import { useLink, type LogEntry, type UseLink } from './useLink.ts'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Harness {
  readonly link: () => UseLink
  /** The newest log entry — `send` unshifts, so it is always index 0. */
  readonly entry: () => LogEntry
  readonly unmount: () => Promise<void>
}

/** Mount the hook, connect it to `device`, and wait for the link to come up. */
async function connected(device: SimDevice = new SimDevice()): Promise<Harness> {
  let latest: UseLink | undefined
  function Probe(): null {
    latest = useLink()
    return null
  }

  const root = createRoot(document.createElement('div'))
  await act(async () => {
    root.render(<Probe />)
  })

  await act(async () => {
    latest!.connect('simulator', 0, { device, onChanged: () => {} })
    // SimLink opens after a deliberate beat so the UI reads as connecting.
    await sleep(300)
  })
  expect(latest!.state).toBe('open')

  return {
    link: () => latest!,
    entry: () => latest!.log[0],
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
    },
  }
}

/** One op on a literal AWJ path, spelled as the field harness spells them. */
const op = (awj: string, value: unknown): Op => ({
  path: Path.fromAwj(awj),
  value,
  describe: awj,
})

/** Parse and compile, failing loudly so the tests below read as assertions. */
function opsFor(input: string): readonly Op[] {
  const parsed = parse(input)
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.errors.map((e) => e.message).join('; ')}`)
  const compiled = compile(parsed.command)
  if (!compiled.ok) throw new Error(`compile failed: ${compiled.errors.map((e) => e.message).join('; ')}`)
  return compiled.ops
}

/**
 * Send, and let the synchronous echo land.
 *
 * The simulator echoes inside `write`, so an entry that reaches `working` here
 * was matched by the echo alone — no timer has run yet, and the settle to
 * `done` is still 400 ms away.
 */
async function send(h: Harness, input: string, summary: string, ops: readonly Op[]): Promise<void> {
  await act(async () => {
    h.link().send(input, summary, ops)
  })
}

describe('a write is confirmed by an echo carrying the value that was written', () => {
  it('confirms a label from a STRING echo', async () => {
    const h = await connected()
    const input = 'Label Screen 1 Memory 5 "FIELDTEST"'

    await send(h, input, 'Label memory 5', opsFor(input))

    // The regression: under a matcher that accepted only `true`, a string echo
    // matched nothing and this stayed at `sent` until it was called unconfirmed.
    expect(h.entry().status).toBe('working')

    await act(async () => {
      await sleep(500)
    })
    expect(h.entry().status).toBe('done')
    expect(h.entry().detail).toBeUndefined()

    await h.unmount()
  })

  it('confirms a record-mask filter from an ARRAY echo', async () => {
    const h = await connected()

    // Sent as a lone filter write on purpose. A whole `Store Master` also
    // writes `xRequest: true`, and that trigger's echo would confirm the entry
    // by itself — which is exactly how the array case stayed hidden while the
    // command as a whole looked fine.
    const mask = op('DeviceObject/masterPresetBank/control/save/@props/categoryFilter', ['SOURCE', 'POS'])

    await send(h, 'Store Master 12 If Category Source + Position', 'Record mask: Source + Position', [mask])

    expect(h.entry().status).toBe('working')

    await act(async () => {
      await sleep(500)
    })
    expect(h.entry().status).toBe('done')

    await h.unmount()
  })

  it('still confirms a trigger, the one write that really is `true`', async () => {
    const h = await connected()
    const trigger = op('DeviceObject/masterPresetBank/control/save/$slot/@items/12/@props/xRequest', true)

    await send(h, 'Store Master 12', 'Store master memory 12', [trigger])

    expect(h.entry().status).toBe('working')

    await act(async () => {
      await sleep(500)
    })
    expect(h.entry().status).toBe('done')

    await h.unmount()
  })

  it('does not confirm when the echo carries a different value', async () => {
    /*
     * A device that echoes on the right path with the wrong value.
     *
     * Matching on the path alone is the plausible wrong way to fix the `true`
     * bug, and it would pass every test above while reporting a write as
     * landed when the device took something else. This is the test that says
     * the comparison is of values, not of paths.
     */
    class Contrary extends SimDevice {
      apply(path: readonly string[], value: unknown): Push[] {
        return [{ path: [...path], value: `not ${String(value)}` }]
      }
    }

    const h = await connected(new Contrary())
    const input = 'Label Screen 1 Memory 5 "FIELDTEST"'

    await send(h, input, 'Label memory 5', opsFor(input))

    expect(h.entry().status).toBe('sent')

    // The hook gives a write 1500 ms to be acknowledged before saying it was not.
    await act(async () => {
      await sleep(1700)
    })
    expect(h.entry().status).toBe('failed')
    expect(h.entry().detail).toMatch(/No confirmation/)

    await h.unmount()
  })
})
