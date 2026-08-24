# AGENTS.md — Mynah

Onboarding for LLM agents and newcomers.

## What this is

A static browser SPA (React/TS/Vite, no backend) that gives Analog Way
LivePremier switchers a lighting-desk command line, plus a Stream Deck plugin
that runs the same grammar. Same shape as the fleet's other browser tools — see
`otter-edid-editor`, `blend-calc`.

## Layout

```
src/lang/          the language. No DOM, no network, no React.
  keywords.ts      the vocabulary. Short forms are COMPUTED, never written
                   down — adding a keyword changes its neighbours' abbreviations
  lexer.ts         text -> tokens, each carrying its span
  ast.ts           the parsed shape
  parser.ts        tokens -> Command. Resolves ranges, applies NO defaults
  compile.ts       Command -> ordered device writes. ALL policy lives here:
                   defaults, sticky scope, and the order a master store needs
  model.ts         the device's dimensions, enums and path builders
  paths.ts         one path, rendered for either transport — and read back
                   from either, which is what the raw languages need
  dialects/        the other three languages. AWJ, raw store JSON and OSC,
                   plus detection and the OSC dictionary. `run()` takes a line
                   in any of the four and returns one shape
src/link/
  webrcs.ts        the Web RCS WebSocket — envelope, keepalive, REMOTE channel
  banks.ts         streaming extractor for the 124 MB store snapshot
src/hid/
  useXKeys.ts      WebHID, X-Keys only
src/lang/index.ts  the PUBLIC surface of the language, for consumers outside
                   this repo. `npm run build:lang` bundles it to dist-lang/,
                   which companion-module-mynah vendors — so the grammar is
                   never transcribed twice.
streamdeck/        the plugin: same lang core, its own link, Elgato plumbing
docs/SYNTAX.md     the grammar, and why the defaults are what they are
docs/LANGUAGES.md  the four command languages, detection, and the OSC rules
docs/PATHS.md      every device path, firmware-tagged, with the traps
docs/DEVICES.md    keyboard / X-Keys / Stream Deck
```

## The rules that matter

**Parser resolves, compiler decides.** The parser turns `1 Thru 8 - 5` into
seven numbers and stops. It never decides that an omitted preset mode means
Preview. That is policy and it lives in `compile.ts` so it is stated once.

**Never default a recall to Program.** An under-specified command must not be
able to reach air. This is not configurable and should not become configurable.

**Verify a path before you use it.** Everything in `docs/PATHS.md` was read off
a running device. Analog Way moves paths between firmwares, and the published
AWJ guide is already wrong about several on 6.2. Do not add a path from the PDF
alone.

**Do not trust an accepted write.** The device answers a recall of an empty
memory with complete silence — no error. Positive confirmation is `isLoading`
appearing at all. See the trace in `docs/PATHS.md`.

**A language prefix must never collide with a keyword.** `MYNAH`, `AWJ`,
`JSON` and `OSC` lead a line to declare its language. `STORE` was briefly an
alias for `JSON`, and every `Store Master 12` silently became a JSON parse
error. `dialects.test.ts` asserts the prefix set stays disjoint from the live
keyword table; that test is the thing that must fail before such a change can
ship.

**Short forms are derived.** `shortestForm()` computes the minimal unambiguous
prefix from the whole table. `Mask` has no abbreviation because `Master` shares
`Mas`. A test asserts every keyword still resolves from its own short form; if
you add a keyword and that test fails, the table changed under someone, which is
the point.

## The support footer

Vendored at `public/support-footer.js` from `stoatworks-backend/support-footer`
— **never edit the copy here**; edit it there and re-run that repo's
`scripts/sync-support-footer.sh`. It is wired up in `index.html` with a
**classic, deferred** script tag, not a module: it reads its config off
`document.currentScript`, which is null inside a module.

Two things that are easy to get wrong:

- **`data-version` is substituted at build time** by a `transformIndexHtml`
  hook in `vite.config.ts`. Vite's `define` only reaches JavaScript — it does
  not touch index.html — so the placeholder needs the hook.
- **Any CSP must list the intake origin in `connect-src`**, or the feedback
  button is a button that silently does nothing. That means `public/_headers`
  for the web build *and* `src-tauri/tauri.conf.json` for the desktop one. The
  desktop CSP was missed first time round: the footer rendered and its report
  would have been refused.

## Transport

The browser cannot open TCP 10606 — no page can open a raw TCP socket by any
route — so in a tab the tool uses the Web RCS WebSocket. **The desktop build
can**, and does: `src-tauri/src/awj.rs` opens a real AWJ connection per
exchange, which is what makes `{"op":"get",…}` answerable at all.

Two consequences worth holding on to:

- **An AWJ message typed in a browser still runs.** It is converted to the
  store spelling and sent on the WebSocket, and it lands at the same node —
  `Path` holds both spellings. What is lost is the *reply*.
- **`Link.canAwj` is the gate**, not the build flag. `webrcs.ts` and `sim.ts`
  say false; `desktop.ts` says true and implements `awj()`. A read on a
  transport that cannot perform one is refused by name rather than dropped.

One AWJ connection per exchange, closed after. The device allows five clients
and counts them, so an idle console holding one open would spend a scarce slot
on nothing and appear in the device's own client list all show.

The store snapshot (`GET /api/stores/device`) is 124 MB, cannot be narrowed, and
sends no CORS header. Do not build anything that depends on reading it.

## Testing

`npm test` — the grammar (paths, ranges, defaults, masks, scope) and the store
scanner. The scanner tests stream a synthetic document one byte at a time,
because chunk boundaries inside strings are exactly what broke it first time.

There is no test that talks to a device. The simulator is the test rig: run the
LivePremier simulator, connect to `127.0.0.1:3000`, and prefer recalls into
**Preview** — a store overwrites a memory slot for real.

## Notes

`docs/NOTES.md` carries this repo's working notes — current status, decisions
already made, and the traps that have actually bitten. Read it before changing
anything non-obvious. Cross-cutting fleet knowledge lives in
[fleet-notes](https://github.com/stoatworks-labs/fleet-notes).
