# Mynah for Stream Deck

A Stream Deck plugin that puts one Mynah command on each key.

## Why it is a plugin and not the web tool

A Stream Deck is claimed by Elgato's own software the moment it is plugged in,
and WebHID cannot open a device another process holds. So unlike an X-Keys
panel — which the web tool drives directly in the browser — a Stream Deck has
to be reached through Elgato's plugin API instead.

That makes the plugin a **second, independent client** of the same switcher: it
does not talk to the web tool, and the web tool does not need to be running.
It imports the same parser and compiler from `src/lang/`, and opens its own
Web RCS WebSocket to the device. One grammar, two front ends.

## Building

```
npm run build:streamdeck
```

That bundles `src/lang/` and `src/link/webrcs.ts` into
`com.stoatworks.mynah.sdPlugin/code/plugin.js`. Copy or symlink the
`.sdPlugin` directory into the Stream Deck plugins folder:

- macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`
- Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\`

## Configuring a key

Drag the **Command** action onto a key and fill in the property inspector:

| Field | Meaning |
|---|---|
| Device | Hostname or IP of the switcher |
| Port | 80 on a device, 3000 on the simulator |
| Command | Any Mynah command, e.g. `Recall Screen 1 Memory 5` |

The command is parsed as you type it, and the inspector shows what it compiles
to — or why it will not.

## Status

⚠️ **Never run against a physical Stream Deck.** The plugin was written against
Elgato's published SDK v2 registration and event protocol, and its command
handling is the same tested code the web tool uses, but the round trip through
Stream Deck hardware has not been exercised.
