# Attributions

## The switcher

Mynah controls Analog Way **LivePremier** (Aquilon) processors. It is **not
affiliated with or endorsed by Analog Way**, and redistributes no part of their
software, firmware or documentation.

The control protocol is documented openly by Analog Way in the **AWJ Protocol
Programmer's Guide**, which covers the port, the wire format and the
memory-recall paths.

Nothing of Analog Way's is redistributed here. Every path this project uses is
listed in `docs/PATHS.md` in its own words, and every one was verified by
reading it back off a running device before it was relied on.

## The grammar

The command syntax follows the *rules* of lighting-desk command lines, and the
grandMA3 rules in particular — verb first, unambiguous keyword abbreviation,
`Thru` / `+` / `-` ranges, an `If` filter clause. No code, data or text from any
lighting console vendor is used or reproduced. The vocabulary is the switcher's
own throughout.

Reference material consulted, all publicly published documentation:

- **MA Lighting** — grandMA3 command-line syntax rules
- **Avolites** — Titan commands quick reference
- **ChamSys** — MagicQ programmer documentation

grandMA3 is a trademark of MA Lighting, Titan of Avolites, MagicQ of ChamSys.
No affiliation or endorsement is implied by any of them.

## Prior art read

- **`bitfocus/companion-module-analogway-awj`** (MIT) — read as the reference
  for the Web RCS WebSocket route, which it takes in preference to AWJ. Its
  README says so itself. No code was copied.

## Dependencies

React and React DOM (MIT), Vite (MIT), TypeScript (Apache-2.0), Vitest (MIT).
Full versions are in `package-lock.json`.

The Stream Deck plugin targets Elgato's published SDK. Stream Deck is a
trademark of Elgato; X-Keys of P.I. Engineering. Neither is affiliated with this
project.

## Licence

Mynah is MIT — see `LICENSE`.
