# The four command languages

Mynah's command line accepts four languages. One of them is Mynah, and the
other three are ways of saying "put this value at this path" that someone
already has in front of them.

| Language | Looks like | For |
|---|---|---|
| **Mynah** | `Recall Screen 1 Memory 5` | driving a show |
| **AWJ** | `{"op":"replace","path":"DeviceObject/…","value":true}` | the vendor's own protocol, and reading a value back |
| **JSON** | `{"path":["device",…],"value":true}` | replaying a frame off the Web RCS socket |
| **OSC** | `/lp/screen/1/take` | the address space a show-control system can send at |

Mynah is the one for a show day; the full grammar is in [SYNTAX.md](SYNTAX.md).
This document is about the other three, and about how the command line decides
which is which.

---

## 1. Choosing a language

The **Language** picker above the command line has five settings: `All` and
one for each language.

**`All`** is the default. Each line is read as whichever language it looks
like, and the verdict is shown live beside the picker as you type — because a
line read as the wrong language produces an error about a character rather
than about a command, and that reads like your own typo.

**One language** turns detection off. That is what you want when you are
pasting machine-generated JSON: a payload that happens to start with a slash
should be a JSON error, not silently an OSC command.

### Saying it on the line

Any line may name its own language with a leading word:

```
MYNAH Take Screen 1
AWJ get DeviceObject/system/$device/@items/1/@props/dev
JSON {"path":["device","screenList","items","S1"],"value":1}
OSC /lp/screen/1/take
```

A declared prefix always wins, including when a single language is pinned —
naming a language is unambiguous, and refusing it would be pedantry. The four
prefix words are not, and must never become, keywords in the Mynah grammar;
there is a test asserting exactly that, and it has already caught one
collision.

### How a line is sniffed

Only when the language is `All` and nothing was declared. Every rule keys on a
character that cannot begin a Mynah command:

| Starts with | Read as |
|---|---|
| `/` | OSC |
| `{` or `[` with an `"op"`, or a `DeviceObject/` path | AWJ |
| `{` or `[` otherwise | JSON |
| `DeviceObject/`, or `replace `/`get `, or contains `@props/` | AWJ |
| anything else | Mynah |

Mynah is the fallback, so a mistyped Mynah command gets Mynah's complaint about
the word that is wrong.

---

## 2. AWJ

Analog Way's own control protocol: one JSON object per message, terminated by
ASCII `0x04`, on TCP 10606. Exactly one `op`, and it is only ever `replace` or
`get` — despite the "JSON Patch" framing there is no add, remove or test.

```
AWJ {"op":"replace","path":"DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake","value":true}
```

A trailing `0x04` is tolerated, and several messages may be run at once —
either separated by `0x04` or as a JSON array. So a message copied out of a
packet capture or a vendor document pastes in and runs.

### Shorthand

Nobody types the canonical form twice:

```
replace DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
get DeviceObject/system/$device/@items/1/@props/dev
```

A value is parsed as JSON and, if that fails, taken as a string. That is for
the enums: the device's own spelling of a source is `LIVE_3`, which is not
JSON, and requiring `"LIVE_3"` would make the common case the awkward one.
Numbers, `true`, `false` and `null` keep their types.

### The two transports

The **AWJ via** picker decides how a typed AWJ message actually leaves.

**Store writes — this connection.** The message is converted to the Web RCS
store spelling and sent on the connection this app already has. It works in
every build, opens nothing new, and lands at exactly the same node: one path is
held once and rendered for either transport. What it cannot do is answer a
`get`, because that socket is a stream of changes rather than a request and its
answer.

**TCP 10606 — a real AWJ socket.** The message goes out as typed and the reply
comes back. This is the truthful one: if you are testing what the device does
with a particular AWJ message, this is the only setting that actually tests it.
Desktop app only — a browser cannot open a TCP socket by any route, which is
why the picker's second option is greyed out on the web.

A connection is opened per exchange and closed after it. The device allows five
AWJ clients and counts them; holding one open between commands would spend a
scarce slot on an idle console and put this app in the device's own client list
for the whole show.

> **A `replace` is answered with silence.** Success is not acknowledged, on
> either transport. A `get` is the only thing that answers, which is the reason
> to reach for one.

> **AWJ can be switched off** in the Web RCS security settings. Check that
> before blaming the code for a connection that times out.

---

## 3. Raw store JSON

The other spelling of the same object model, and the one the vendor's own web
app carries:

```json
{"channel":"DEVICE","data":{"path":["device","screenAuxGroupList","items","S1","control","pp","xTake"],"value":true}}
```

Four shapes are accepted, all meaning the same thing:

```
{"path":["device","…","pp","xTake"],"value":true}
{"path":"device/…/pp/xTake","value":true}
{"channel":"DEVICE","data":{"path":[…],"value":true}}
[ … an array of any of the above … ]
```

The envelope is unwrapped rather than rejected, because that is the form that
appears in a browser's network panel — asking someone to strip it by hand
before pasting is asking them to make a mistake. A leading `device` is
optional, because a subtree copied out of the store dump has already had it
peeled off.

There is no `get` in this language. Ask for a read in AWJ.

---

## 4. OSC

The address space this app publishes, so that QLab, TouchOSC, Companion or a
show-control system can drive a switcher with no code on either side.

It exists because the MIDI mapping already needed one: a fader is bound to *a
screen, a preset, a layer and a parameter*, and that four-part address is the
same thing whether it arrives as a MIDI control change or as an OSC packet.

```
/lp/screen/1/take
/lp/screen/1/memory/5/recall/preview
/lp/master/memory/12/store
/lp/screen/1/preset/program/layer/2/opacity/opacity 128
/lp/screen/1/preset/program/layer/2/opacity/opacity/norm 0.5
/lp/screen/1/group/control/takeUpTime 20
```

### The five rules

**1. The address is the target; the argument is only the value.** Everything
about *what* is addressed is in the path, so a button with a fixed address and
no argument still means something specific. That is the difference between a
TouchOSC layout you can draw once and one that needs logic behind every
control.

**2. A trigger fires on a non-zero argument, and on no argument at all.**
Surfaces send `1` on press and `0` on release. A take that fired on both would
fire twice per press, and the second one is the one nobody meant.

**3. A recall never defaults to program.** The same rule the Mynah grammar
keeps: an under-specified command must not be able to reach air.
`/lp/screen/1/memory/5/recall` goes to preview. Air costs the extra word.

**4. Units are the device's, unless the address says `/norm`.** A fader sends
0..1; the device wants 0..256 for opacity and −2000000..2000000 for a position.
Guessing from the value is not possible — `0.5` is a perfectly good literal
`posH` *and* the middle of a fader's throw — so it is said in the address
instead. Two addresses, no ambiguity.

**5. `preview` and `program` are resolved, never assumed.** They name whichever
preset buffer is pending or live right now, and a take swaps them. An address
that says `preview` is refused when the device state needed to resolve it is
unknown, rather than guessed at. `a`, `b` and `c` address the buffers directly
and need no device state.

### Not implemented, and reserved

There is no relative form. A relative move needs the current value, which makes
it a property of the surface holding the encoder rather than of the address
space — the MIDI engine's soft-pickup logic is where that belongs. `/rel` is
refused by name so the reserved tail explains itself rather than looking like a
typo.

### The full dictionary

Every address, with its argument and its range, is published in
**LivePremier Plus's [`docs/OSC.md`](https://github.com/stoatworks-labs/livepremier-plus/blob/main/docs/OSC.md)**.
That document is generated from the same tables the resolver uses, widened with
the device's own parameter catalogue — sixty-seven layer parameters against the
seven this repo can vouch for on its own.

Mynah answers the subset it can stand behind: source, geometry, opacity, the
take controls and every memory bank. Ranges here come from `model.ts`, and
everything in it was read off a running device.

---

## 5. What the raw languages are actually for

Two things, and neither is "driving a show".

**The times a show is not going well.** A path out of a packet capture, a frame
out of a browser's network panel, an address a lighting console is already
sending — each is something you already have, and the cost of translating it by
hand is a typo on a live frame.

**Checking this app's own object-model knowledge.** A path typed raw and a path
the compiler produced go out over the same transport and land in the same
place. So "does the grammar agree with the protocol guide" stops being a
question about the code and becomes something anyone can try in one line:

```
Take Screen 1
AWJ DeviceObject/$screenAuxGroup/@items/S1/control/@props/xTake = true
/lp/screen/1/take
```

All three compile to the same write.
