/**
 * The two choices the command line offers, and where they are kept.
 *
 * Both are about *how a typed line reaches the switcher*, which is why they
 * live together and why neither is a per-command flag. An operator picks a way
 * of working at the start of a show and does not want to restate it on every
 * line.
 */

import type { LanguageChoice } from './lang/dialects/index.ts'

/**
 * Which AWJ transport a typed AWJ message should use.
 *
 * The two are not equivalent, and the difference is worth stating plainly
 * because it is the reason this is a choice rather than a default:
 *
 * **`store`** converts the message to the Web RCS store spelling and sends it
 * on the connection this app already has. It works in every build, it opens
 * nothing new, and it lands at exactly the same node — `Path` holds both
 * spellings of one address. What it cannot do is answer a `get`: that socket
 * is a stream of changes, not a request/response channel.
 *
 * **`socket`** opens a real TCP 10606 connection, sends the message as typed,
 * and reads the reply. It is the truthful one — if you are testing what the
 * device does with a particular AWJ message, this is the only setting that
 * actually tests it — and it costs one of the device's five AWJ client slots
 * for the duration of the exchange. Desktop only; a browser cannot open a TCP
 * socket by any route.
 */
export type AwjTransport = 'store' | 'socket'

export interface Settings {
  readonly language: LanguageChoice
  readonly awjTransport: AwjTransport
}

export const DEFAULT_SETTINGS: Settings = {
  /* Detection, because a console that only ever accepts one language is one an
     operator has to configure before it is useful. */
  language: 'all',
  /* The transport that works everywhere, and that does not spend an AWJ client
     slot. Someone who wants the wire-truthful one is doing something deliberate
     and will say so. */
  awjTransport: 'store',
}

const KEY = 'mynah.settings'

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const saved = JSON.parse(raw) as Partial<Settings>
    /* Merged onto the defaults rather than trusted whole: a stored blob from
       an older build is missing whatever was added since, and a console that
       came up with an undefined language would be a puzzle to debug. */
    return {
      language: saved.language ?? DEFAULT_SETTINGS.language,
      awjTransport: saved.awjTransport ?? DEFAULT_SETTINGS.awjTransport,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings))
  } catch {
    /* Private browsing, a full quota, a locked-down profile. Losing the choice
       on reload is a small thing next to the console refusing to start. */
  }
}
