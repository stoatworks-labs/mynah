/**
 * React binding for the Web RCS link, plus the execution log.
 *
 * A command becomes a log entry the moment it is sent, and the entry is then
 * updated by whatever the device pushes back. That matters because a recall
 * returns nothing in the request/response sense — the only confirmation is an
 * `isLoading` that goes true and then false, and a `presetId` naming what
 * landed. An entry that never hears anything back stays amber rather than
 * quietly claiming success.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Op } from './lang/compile.ts'
import { WebRcsLink, type DeviceValue, type LinkState } from './link/webrcs.ts'

export type EntryStatus = 'sent' | 'working' | 'done' | 'empty' | 'failed' | 'offline'

export interface LogEntry {
  readonly id: number
  readonly input: string
  readonly summary: string
  readonly ops: number
  status: EntryStatus
  detail?: string
  readonly at: number
}

export interface UseLink {
  readonly state: LinkState
  readonly stateDetail?: string
  readonly log: readonly LogEntry[]
  readonly remoteSelection: readonly string[]
  connect: (host: string, port: number) => void
  disconnect: () => void
  /**
   * Send a compiled command. `expectSlot` is the memory a recall should land,
   * which lets an empty slot be reported as such rather than as success.
   */
  send: (input: string, summary: string, ops: readonly Op[], expectSlot?: number) => number
  /** Record a command that produced no device writes, e.g. Select. */
  note: (input: string, summary: string) => number
  clearLog: () => void
}

let nextId = 1

export function useLink(): UseLink {
  const linkRef = useRef<WebRcsLink | undefined>(undefined)
  const [state, setState] = useState<LinkState>('idle')
  const [stateDetail, setStateDetail] = useState<string | undefined>()
  const [log, setLog] = useState<LogEntry[]>([])
  const [remoteSelection, setRemoteSelection] = useState<readonly string[]>([])

  /** Path key → the log entry waiting on it, so pushes can find their command. */
  const pending = useRef(new Map<string, number>())

  /**
   * Recalls awaiting proof that anything actually loaded.
   *
   * A recall of an empty memory is not refused and not reported — the device
   * echoes the write and then says nothing at all. A recall that finds
   * something raises `isLoading`, pushes the `presetId` that landed, and drops
   * `isLoading` again. So the tell is the *absence* of `isLoading` shortly
   * after the echo, and a command that goes quiet is reported as an empty
   * memory rather than as success.
   *
   * Confirmed on firmware 6.2.73: recalling a populated slot produced eight
   * pushes, an empty one produced only the two echoes.
   */
  const expecting = useRef(
    new Map<number, { slot: number; sawLoading: boolean; timer?: ReturnType<typeof setTimeout> }>(),
  )

  const update = useCallback((id: number, patch: Partial<LogEntry>) => {
    setLog((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }, [])

  const onValue = useCallback(
    (v: DeviceValue) => {
      const key = v.path.join('/')

      // `isLoading` is the device telling us a recall is in flight, then done.
      // Its arrival at all is what proves the memory had something in it.
      if (key.endsWith('/pp/isLoading')) {
        const trigger = key.replace(/\/pp\/isLoading$/, '/pp/xRequest')
        const id = pending.current.get(trigger)
        if (id === undefined) return

        const exp = expecting.current.get(id)
        if (v.value === true) {
          if (exp) {
            exp.sawLoading = true
            if (exp.timer) clearTimeout(exp.timer)
          }
          update(id, { status: 'working' })
          return
        }

        update(id, { status: 'done' })
        if (exp?.timer) clearTimeout(exp.timer)
        expecting.current.delete(id)
        pending.current.delete(trigger)
        return
      }

      // The echo of our own write is proof it was accepted, but not that it
      // finished.
      const id = pending.current.get(key)
      if (id !== undefined && v.value === true) {
        update(id, { status: 'working' })

        // A recall is settled by `isLoading`, not by the echo. If none turns
        // up, the memory was empty and the device simply ignored the request.
        const exp = expecting.current.get(id)
        if (exp) {
          if (!exp.timer) {
            exp.timer = setTimeout(() => {
              if (!exp.sawLoading) {
                update(id, {
                  status: 'empty',
                  detail: `memory ${exp.slot} is empty — the device ignored this`,
                })
              }
              expecting.current.delete(id)
              pending.current.delete(key)
            }, 700)
          }
          return
        }

        // A store, take, label or delete has nothing further coming, so it
        // settles shortly after the echo rather than spinning forever.
        setTimeout(() => {
          update(id, { status: 'done' })
          pending.current.delete(key)
        }, 400)
      }
    },
    [update],
  )

  const connect = useCallback(
    (host: string, port: number) => {
      linkRef.current?.disconnect()
      const link = new WebRcsLink(WebRcsLink.urlFor(host, port), {
        onState: (s, detail) => {
          setState(s)
          setStateDetail(detail)
        },
        onValue,
        onRemoteSelection: (keys) => setRemoteSelection(keys),
      })
      linkRef.current = link
      link.connect()
    },
    [onValue],
  )

  const disconnect = useCallback(() => {
    linkRef.current?.disconnect()
    linkRef.current = undefined
    setState('idle')
    setStateDetail(undefined)
  }, [])

  useEffect(() => () => linkRef.current?.disconnect(), [])

  const send = useCallback((input: string, summary: string, ops: readonly Op[], expectSlot?: number): number => {
    const id = nextId++
    const link = linkRef.current
    const online = link?.state === 'open'

    setLog((prev) => [
      { id, input, summary, ops: ops.length, status: online ? 'sent' : 'offline', at: Date.now() },
      ...prev,
    ])

    if (!online) return id

    // Registered before the writes go out, so a fast device cannot answer
    // before there is anything listening for the answer.
    if (expectSlot !== undefined) expecting.current.set(id, { slot: expectSlot, sawLoading: false })

    let allSent = true
    for (const op of ops) {
      const path = op.path.toWs()
      pending.current.set(path.join('/'), id)
      if (!link!.write(path, op.value)) allSent = false
    }
    if (!allSent) {
      setLog((prev) => prev.map((e) => (e.id === id ? { ...e, status: 'failed', detail: 'Send failed' } : e)))
    }

    // A command the device never acknowledges should not sit as "sent"
    // forever; after a second it is reported as unconfirmed, not as done.
    setTimeout(() => {
      setLog((prev) =>
        prev.map((e) =>
          e.id === id && e.status === 'sent'
            ? { ...e, status: 'failed', detail: 'No confirmation from device' }
            : e,
        ),
      )
    }, 1500)

    return id
  }, [])

  const note = useCallback((input: string, summary: string): number => {
    const id = nextId++
    setLog((prev) => [{ id, input, summary, ops: 0, status: 'done', at: Date.now() }, ...prev])
    return id
  }, [])

  const clearLog = useCallback(() => setLog([]), [])

  return useMemo(
    () => ({ state, stateDetail, log, remoteSelection, connect, disconnect, send, note, clearLog }),
    [state, stateDetail, log, remoteSelection, connect, disconnect, send, note, clearLog],
  )
}
