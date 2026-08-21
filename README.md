> Built with AI assistance ([Claude Code](https://claude.com/claude-code)).

# Mynah

A lighting-desk command line for Analog Way LivePremier (Aquilon) switchers.

```
Recall Screen 1 Memory 5
Store Master 12 If Screen 1 + 3 Category Source + Position
Recall Screen 1 Thru 4 Memory 7 Program
Take
```

Type the command, press Enter. The grammar rules are grandMA3's — verb first,
any unambiguous abbreviation, `Thru` / `+` / `-` ranges, an `If` clause that
masks a store. The vocabulary is the switcher's own: Screen, Aux, Layer,
Master, Memory, Preview, Program. Nothing here calls anything a fixture or a
cue.

It runs in a browser with nothing installed, talks to the switcher directly,
and drives the same commands from a keyboard, an X-Keys panel, or a Stream
Deck.

## Why

A LivePremier has a lot of memories — 1,000 screen, 500 master, 50 layer — and
the vendor Web RCS reaches them by pointing at things. Anyone who has operated
a lighting desk knows the alternative: say what you want, in one line, without
your eyes leaving the screen. That is all this is.

## What it does today

Memories: recall, store, delete, label, take, and scope.

| Bank | Slots | Scope |
|---|---|---|
| Screen | 1–1000 | Screen S1–S24, Aux A1–A96, × Preview/Program |
| Master | 1–500 | record mask: screens, auxes, layers, categories |
| Layer | 1–50 | Screen × Preview/Program × layer (Native, 1–128) |
| Multiviewer | 1–50 | output |

The full grammar is in [docs/SYNTAX.md](docs/SYNTAX.md). The device paths
behind it, with the firmware they were verified on, are in
[docs/PATHS.md](docs/PATHS.md).

## Two things worth knowing

**A recall never reaches program by accident.** An unqualified `Recall` goes to
Preview. An unqualified `Store` takes from Program, because that is the look
you just made live — and the device's own default agrees. Getting to air always
costs an explicit word: `Program`, or `Take`.

**An empty memory is reported as empty.** The device accepts a recall of a slot
that holds nothing, and then does nothing — no error, no response at all. Mynah
watches for that silence and says `empty memory` rather than `done`, because a
green tick on a command that changed nothing is worse than no feedback.

## Connecting

The browser cannot open a raw TCP socket, so the documented AWJ protocol on
port 10606 is out of reach from a page. Mynah uses the Web RCS WebSocket
instead — the same socket the vendor's own UI speaks, on port 80 of a device or
3000 of the simulator. It needs no bridge and no install, has no five-client
cap, and pushes state without a subscription list to get wrong.

It also means Mynah sees what a human does in the vendor UI, and follows the
Web RCS's own screen selection so that selecting a screen in either place
selects it in both.

### It has to be served over http, and that is not negotiable

A LivePremier serves the Web RCS over **plain http on port 80, with 443 closed**.
There is no `wss://` to connect to, and browsers block an insecure WebSocket
from a secure page as mixed content. So:

| Where Mynah runs | Can it drive a switcher? |
|---|---|
| `localhost` from a checkout | **yes** |
| self-hosted over http on the show network | **yes** |
| the hosted https:// copy | **no** — blocked before the socket leaves the browser |

The hosted copy is still useful as the syntax reference and offline compiler:
it parses, it shows you exactly which device paths a command produces, and it
carries the whole vocabulary. It just cannot reach a device, and it says so
plainly rather than failing silently.

For live control on a show, run it locally or from the container.

## Devices

Keyboard, X-Keys and Stream Deck all run the same grammar — see
[docs/DEVICES.md](docs/DEVICES.md). The short version: an X-Keys panel is
opened directly from the browser over WebHID, and a Stream Deck cannot be,
because Elgato's software holds it.

For a Stream Deck there are two routes. The bundled Elgato plugin in
[`streamdeck/`](streamdeck/), or — better, if you already run Companion —
**[companion-module-mynah](https://github.com/stoatworks-labs/companion-module-mynah)**,
which brings pages, variables, feedbacks and a preset library of around a
hundred ready-made buttons. Both bundle the compiler from `src/lang/` rather
than reimplementing the grammar.

## Running it

```bash
npm install
npm run dev
```

Then point it at a device, or at the LivePremier simulator on `127.0.0.1:3000`.

```bash
npm test                  # the grammar and the store scanner
npm run build             # static bundle in dist/
npm run build:streamdeck  # the Stream Deck plugin
npm run build:lang        # the language core alone, for other consumers
```

## Status

**v0.1.0, and it has driven a real switcher.**

Verified on a physical **Aquilon C** on firmware 6.2.73: all 21 paths in
`docs/PATHS.md` resolve, and every verb was executed from the command line —
store, recall, label, delete, a layer memory, a program recall, a Take, and the
six-op masked master store, with the filters read back exactly as compiled. The
empty-memory behaviour reproduced identically to the simulator. Test memories
were deleted afterwards and the box left clean.

Hardware also found two bugs, both fixed: a label was reported unconfirmed
because the echo matcher only accepted `true`, and preview turned out to map to
buffer `A` on one screen and `B` on another, so there is nothing to hard-code
there.

Not yet done: neither the **X-Keys** nor the **Stream Deck** path has been run
against real hardware. The grammar covers memories only; the recovered object
model runs to some 2,040 modules, and the syntax is built to grow over it.
