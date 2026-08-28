> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code).
> It has driven a real switcher: every verb in the grammar was executed against a physical
> **Aquilon C** on firmware 6.2.73 — store, recall, label, delete, a layer memory, a program
> recall, a Take and the six-op masked master store — with the filters read back exactly as
> compiled, and the hardware found two bugs the simulator never showed. **Neither the X-Keys nor
> the Stream Deck path has ever been run against real hardware.** See [Status](#status).

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

<!-- downloads:start -->

## Download

**[v1.3.3](https://github.com/stoatworks-labs/mynah/releases/tag/v1.3.3)** — prebuilt for macOS and Linux. Pick your platform:

<details>
<summary><b>macOS</b> — Apple Silicon, Intel</summary>

| Build | Download | Size |
| --- | --- | --- |
| Apple Silicon · .dmg disk image | [`Mynah_1.3.3_aarch64.dmg`](https://github.com/stoatworks-labs/mynah/releases/download/v1.3.3/Mynah_1.3.3_aarch64.dmg) | 2.1 MB |
| Intel · .dmg disk image | [`Mynah_1.3.3_x64.dmg`](https://github.com/stoatworks-labs/mynah/releases/download/v1.3.3/Mynah_1.3.3_x64.dmg) | 2.2 MB |

</details>

<details>
<summary><b>Linux</b> — x64</summary>

| Build | Download | Size |
| --- | --- | --- |
| x64 · .deb package (Debian/Ubuntu) | [`Mynah_1.3.3_amd64.deb`](https://github.com/stoatworks-labs/mynah/releases/download/v1.3.3/Mynah_1.3.3_amd64.deb) | 2.6 MB |
| x64 · .rpm package (Fedora/RHEL) | [`Mynah-1.3.3-1.x86_64.rpm`](https://github.com/stoatworks-labs/mynah/releases/download/v1.3.3/Mynah-1.3.3-1.x86_64.rpm) | 2.6 MB |

</details>

Also in this release:

- [`Mynah_aarch64.app.tar.gz`](https://github.com/stoatworks-labs/mynah/releases/latest/download/Mynah_aarch64.app.tar.gz) — Source tarball, 2.0 MB
- [`Mynah_x64.app.tar.gz`](https://github.com/stoatworks-labs/mynah/releases/latest/download/Mynah_x64.app.tar.gz) — Source tarball, 2.1 MB

All builds, checksums and release notes: [github.com/stoatworks-labs/mynah/releases](https://github.com/stoatworks-labs/mynah/releases).

macOS builds are signed and notarised by Apple, so they open normally — no Gatekeeper warning and no quarantine step.

<!-- downloads:end -->

## Why

A LivePremier has a lot of memories — 1,000 screen, 500 master, 50 layer — and
the vendor Web RCS reaches them by pointing at things. Anyone who has operated
a lighting desk knows the alternative: say what you want, in one line, without
your eyes leaving the screen. That is all this is.

## What it does today

**Memories** — recall, store, delete, label, take, and scope.

**Live layer control** — source, size, position and opacity, on any layer of
any screen:

```
Set Screen 3 Layer 2 Source 1 Size 50% Position 33% 50%
```

Percentages resolve against the screen's real canvas, and position is the
layer's centre because that is the device's anchor.

| Bank | Slots | Scope |
|---|---|---|
| Screen | 1–1000 | Screen S1–S24, Aux A1–A96, × Preview/Program |
| Master | 1–500 | record mask: screens, auxes, layers, categories |
| Layer | 1–50 | Screen × Preview/Program × layer (Native, 1–128) |
| Multiviewer | 1–50 | output |

**Four command languages** — the same line accepts Mynah, raw AWJ, raw Web RCS
store JSON, and OSC. These are the same write:

```
Take Screen 1
AWJ DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
{"path":["device","screenAuxGroupList","items","S1","control","pp","xTake"],"value":true}
/lp/screen/1/take
```

Each line is read as whichever language it looks like, and the verdict is shown
as you type; a leading `MYNAH`, `AWJ`, `JSON` or `OSC` says which outright, and
the picker can turn detection off altogether. See
[docs/LANGUAGES.md](docs/LANGUAGES.md).

**New to it? Start with the [programming guide](docs/GUIDE.md)** — every
command from one word upwards, with worked examples you can paste into the
simulator. The full grammar is in [docs/SYNTAX.md](docs/SYNTAX.md), and the
device paths behind it, with the firmware they were verified on, are in
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

An AWJ message typed at the command line still runs in a browser: it is
converted to the store spelling and lands at the same node. What a page cannot
do is read one back, because that socket carries changes rather than answers.
**The desktop app opens a real AWJ socket**, which is what makes
`AWJ get DeviceObject/system/$device/@items/1/@props/dev` answerable.

It also means Mynah sees what a human does in the vendor UI, and follows the
Web RCS's own screen selection so that selecting a screen in either place
selects it in both.

### The desktop app, if you want the simple answer

Download it and it just works — macOS, Windows and Linux, about 5 MB. It talks
to the switcher directly, with no browser sandbox in the way.

```bash
npm run desktop        # run it from a checkout
npm run desktop:build  # build the installers
```

### It has to be served over http, and that is not negotiable

A LivePremier serves the Web RCS over **plain http on port 80, with 443 closed**.
There is no `wss://` to connect to, and browsers block an insecure WebSocket
from a secure page as mixed content. So:

| Where Mynah runs | Can it drive a switcher? |
|---|---|
| `localhost` from a checkout | **yes** |
| self-hosted over http on the show network | **yes** |
| the **desktop app** | **yes** |
| the hosted https:// copy | **no** — blocked before the socket leaves the browser |

So the hosted copy runs a **simulator instead**, and says so in a banner you
cannot miss. It is a model of a LivePremier built into the page: four screens
with layers and three preset buffers each, the four memory banks, and a
wireframe of what every screen is putting out. Recall a memory and watch the
preview change; press Take and watch the buffers swap.

It reproduces the device's awkward behaviour on purpose, because those are the
things worth meeting for the first time somewhere other than a show:

- a recall of an empty memory is answered with **silence**, and reported as an
  empty memory rather than as success
- preview and program are names for whichever buffer is pending or live, **the
  mapping differs per screen**, and a Take swaps it

The simulator is available in every build, not just the hosted one — tick
**Simulator** in the connection bar.

For live control on a show, use the desktop app, the container, or a local
checkout.

And no, a proxy cannot fix the hosted copy. A Cloudflare Worker runs at the
edge and cannot reach a switcher on your own network, and tunnelling one out to
the public internet would expose an **unauthenticated** control interface —
anyone who reached it could drive your show. The desktop app is the answer to
that question.

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

**v1.3.3, and it has driven a real switcher.**

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
against real hardware. That hardware run covered the memory paths, which are the 21 in
`docs/PATHS.md`. The grammar has grown past them since — live layer control and
the audio routing matrix — and neither of those has been exercised against a
device. The object model is larger still, and the syntax is built to grow over it.
