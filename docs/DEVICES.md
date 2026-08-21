# Input devices

## Where to run it

| | Can it drive a switcher? |
|---|---|
| **Desktop app** (macOS, Windows, Linux) | **yes** — no browser sandbox in the way |
| `localhost` from a checkout | **yes** |
| self-hosted over http (the container) | **yes** |
| the hosted `https://` copy | **no** — blocked before the socket leaves the browser |

The desktop app exists because of that last row. A LivePremier serves the Web
RCS over plain http on port 80 **with 443 closed**, and a browser will not open
an insecure WebSocket from a secure page. The desktop build does its device I/O
in Rust instead of in the webview — which it has to, because Tauri registers
its own scheme as trustworthy, making the webview a secure context subject to
exactly the same rule.

No proxy can rescue the hosted copy for a switcher on your own network: a
Cloudflare Worker runs at the edge and cannot reach a private address, and
tunnelling the switcher out to the public internet would expose an
**unauthenticated** control interface. Use the desktop app.


All three run the same grammar. A key does not have a special "recall memory 5"
capability — it holds the string `Recall Screen 1 Memory 5`, which is parsed and
compiled by exactly the code that handles the typed command line.

## Keyboard

The command line itself. Enter executes, Tab completes the word under the
cursor, and any unambiguous abbreviation is accepted as you type — `R Sc 1 Me 5`
is `Recall Screen 1 Memory 5`.

`Clear` clears a part-typed line; pressed again on an empty line it clears the
sticky scope. Two presses to lose your scope, never one.

## X-Keys

Opened straight from the browser over WebHID. An X-Keys panel is a plain HID
device that no driver claims, which is what makes it usable from a static web
page with nothing installed: click **Attach X-Keys**, pick the panel, and the
browser remembers it next time.

Bindings map a key index to a command string and live in `localStorage`.

X-Keys reports the state of every key on every input report, so a press is a bit
that was clear and is now set. The first report after connecting is treated as a
baseline only — otherwise a key already held down at connect would fire.

⚠️ **Untested on hardware.** Written against PI Engineering's published report
layout — a unit id and protocol byte, then a column-major bitmap, key index
`column * 8 + row`. The button offset is a constant in `src/hid/useXKeys.ts` and
may need adjusting per panel.

## Stream Deck

A plugin, in [`streamdeck/`](../streamdeck/), because it cannot be anything
else: Elgato's software claims the device as soon as it is plugged in, and
WebHID cannot open a device another process holds.

So the plugin is a **second independent client** of the switcher rather than a
remote control for the web tool. It imports the same parser and compiler and
opens its own WebSocket. Neither needs the other running.

One difference in behaviour, deliberately: **a Stream Deck key has no sticky
scope.** The panel is not where the operator is looking, and a key whose meaning
depends on invisible state is a key that eventually fires at the wrong screen.
Every key command must name its own scope, and the property inspector will tell
you at configuration time if it does not.

⚠️ **Untested on hardware.** The registration and event handling follow
Elgato's SDK v2; the command path is the same tested code the web tool uses.
