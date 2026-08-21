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
  paths.ts         one path, rendered for either transport
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

The browser cannot open TCP 10606, so AWJ is unreachable from a page — the tool
uses the Web RCS WebSocket. AWJ rendering is kept in `paths.ts` anyway because
it is the readable spelling, and it is what the docs and the UI preview show.

The store snapshot (`GET /api/stores/device`) is 124 MB, cannot be narrowed, and
sends no CORS header. Do not build anything that depends on reading it.

## Testing

`npm test` — the grammar (paths, ranges, defaults, masks, scope) and the store
scanner. The scanner tests stream a synthetic document one byte at a time,
because chunk boundaries inside strings are exactly what broke it first time.

There is no test that talks to a device. The simulator is the test rig: run the
LivePremier simulator, connect to `127.0.0.1:3000`, and prefer recalls into
**Preview** — a store overwrites a memory slot for real.
