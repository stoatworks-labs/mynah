# Programming guide

Everything Mynah can do, from one word upwards. Every command here is real —
try them in the [simulator](https://mynah.stoatworks-labs.com), where nothing
you type can reach a switcher.

The reference is [SYNTAX.md](SYNTAX.md); this is the walkthrough.

---

## 1. The shape of every command

```
[Function] [Object] [Object] … ⏎
```

The verb first, then what it acts on, innermost last. **Nothing is sent until
you press Enter**, and the compiled device paths are shown before you do.

```
Take Screen 1
```

One function, one object. That transitions Screen 1's preview to program.

### It is shorter than it looks

Every keyword can be cut to any prefix that is unambiguous across the whole
vocabulary. These are the same command:

```
Take Screen 1
Ta Sc 1
```

The app shows each word's shortest form in the Vocabulary panel. A prefix that
matches several words is refused *with the candidates*, so you are told which
letter to add rather than being told it is wrong.

---

## 2. Recalling a memory

```
Recall Screen 1 Memory 5
```

Memory 5 into Screen 1's **preview**. That default matters: an unqualified
recall never reaches air. To go straight to program you must say so:

```
Recall Screen 1 Memory 5 Program
```

### Whole-desk and layer memories

```
Recall Master 12                      a master memory, the whole desk
Recall Screen 3 Layer 1 Memory 8      a layer memory
Recall Aux 2 Memory 4                 an aux screen
```

Note `Master 12` — Master is the one object with no instance number of its own,
so the number after it *is* the memory slot.

### The ranges differ per bank

| Bank | Memories |
|---|---|
| Screen and Aux | 1–1000 |
| Master | 1–500 |
| Layer | 1–50 |

Anything outside is refused rather than clamped.

---

## 3. Several screens at once

```
Recall Screen 1 Thru 4 Memory 7       four screens
Recall Screen 1 + 3 Memory 7          just those two
Recall Screen 1 Thru 8 - 5 Memory 7   eight, except 5
Recall Screen 1 Thru 4 + 8 - 2 Memory 7
```

`Thru` is inclusive at both ends. `+` and `-` bind left to right, so a `-`
removes from everything gathered so far. An open `Screen 20 Thru` runs to the
highest screen; a leading `Screen Thru 3` starts at the lowest.

Each member becomes its own device write, and the preview tells you how many:
`4 ops`.

---

## 4. Storing, labelling, deleting

```
Store Screen 1 Memory 5               stores what is on PROGRAM
Store Screen 1 Memory 5 Preview       stores preview instead
Label Screen 1 Memory 5 "Wide open"
Delete Screen 1 Memory 5
```

**A store defaults to program**, the opposite of a recall — you store the look
that is on air, which is also the device's own default. Both defaults are
deliberate: reaching air always costs an explicit word.

There is no undo on the device. Store buttons in the Companion preset library
are a different colour for that reason.

### Masking a master store

`Store Master` takes no screen argument. It takes *filters*, which Mynah
exposes as grandMA3's `If`:

```
Store Master 12
Store Master 12 If Screen 1 + 3
Store Master 12 If Category Source + Position
Store Master 12 If Screen 1 Thru 4 Layer 1 Category Size
```

The categories are the device's own record mask: `Source`, `Position`, `Size`,
`Opacity`, `Cropping`, `Border`, `Transitions`, `Effects`, `FlyingCurve`,
`Timing`, `Speed`, `CutAndFill`, `Mask`, `Keyer`.

Two things worth knowing. An **unfiltered** store writes the mask wide open
rather than leaving it — the filters persist on the device, so otherwise you
would silently inherit whatever was set last, by you or by someone in the
vendor UI. And `If` on a screen or layer store is **refused**: those banks have
no mask, and silently ignoring one you typed would be worse.

---

## 5. Scope you do not have to retype

`Select` sets a scope that sticks:

```
Select Screen 1 + 3
Recall Memory 5          → into S1 and S3
Store Memory 9           → from S1 and S3
Take                     → takes S1 and S3
```

The current scope is always shown above the command line. Naming a screen
inline overrides it for that one command without changing it.

`Clear` clears a part-typed line; pressed again on an empty line it clears the
scope. Two presses to lose your scope, never one.

---

## 6. Single attributes on a layer

Now the live parameters. These change what a layer is doing *right now*, rather
than recalling a stored look.

```
Set Screen 3 Layer 2 Source 1
```

One attribute, one layer. Source 1 is live input 1.

```
Set Screen 3 Layer 2 Source Still 4     a still store
Set Screen 3 Layer 2 Source Colour      flat colour
Set Screen 3 Layer 2 Source None        nothing
```

### Pixels or percentages, wherever a value goes

Every value takes either. A bare number is **pixels**; a number with `%` is a
proportion of that screen's real canvas.

```
Set Screen 3 Layer 2 Size 50%            half the canvas, both axes
Set Screen 3 Layer 2 Size 50% 25%        half wide, a quarter tall
Set Screen 3 Layer 2 Size 960 540        pixels
Set Screen 3 Layer 2 Position 50% 50%    centred
Set Screen 3 Layer 2 Opacity 50%
```

You can mix them freely — within one attribute, and across a command:

```
Set Screen 3 Layer 2 Size 960 25%
Set Screen 3 Layer 2 Size 50% Position 640 360
Set Screen 3 Layer 2 Position 33.3%
```

**A layer may be bigger than its canvas**, and **a position may be negative** —
`Size 150%` and `Position -100 50` are both fine. Since the anchor is the
layer's centre, negatives are how you push a layer off an edge.

A **size** may not be negative, and that is the device's rule rather than ours:
its range for a size starts at 0. Mynah refuses it and says so.

The device's own limits, which Mynah checks against:

| | range |
|---|---|
| Position | −2000000 to 2000000 px |
| Size | 0 to 1000000 px |
| Opacity | 0 to 256 |

### If you prefer the desk spelling

`At` is accepted before any value, and a command may lead with the object —
both familiar from grandMA3 and Titan. All three are identical:

```
Set Screen 3 Layer 2 Source 1
Set Screen 3 Layer 2 Source At 1
Screen 3 Layer 2 Source At 1
```

### Three things the device will surprise you with

**Position is the layer's centre.** The anchor is `MIDDLE_CENTER`, so
`Position 50% 50%` centres the layer, and `Position 0%` puts its middle at the
left edge — half of it off-canvas. That is the device's model, not Mynah's.

**Opacity runs 0–256**, not 0–100. A percentage is scaled for you; a plain
number is passed through in the device's own units.

**Live parameters are addressed per buffer** — `A`, `B` or `C` — while you
type "preview" or "program". Those are names for whichever buffer is pending or
live *at this moment*, and the mapping differs between screens on the same
device. Mynah resolves it from the take state the device reports. If the device
has not reported it yet, the command is refused with that reason rather than
guessing.

---

## 7. Building a look, one line at a time

Set a scope, then work inside it:

```
Select Screen 3 Layer 2
Set Source 1
Set Size 50%
Set Position 33% 50%
Take
```

Or the whole thing in one command — several attributes in a single `Set`:

```
Set Screen 3 Layer 2 Source 1 Size 50% Position 33% 50%
```

On a 1920×1080 screen that compiles to five ordered writes:

```
…/$preset/@items/B/$layer/@items/2/source/@props/inputNum   = "LIVE_1"
…/$preset/@items/B/$layer/@items/2/position/@props/sizeH    = 960
…/$preset/@items/B/$layer/@items/2/position/@props/sizeV    = 540
…/$preset/@items/B/$layer/@items/2/position/@props/posH     = 634
…/$preset/@items/B/$layer/@items/2/position/@props/posV     = 540
```

Read that back: source is the enum `LIVE_1`, not the number 1. The size is half
of each axis. `posH` 634 is a third of 1920 — the layer's **centre**, a third
of the way across. And the buffer is `B`, because that is what preview resolved
to on this screen at this moment.

### A worked sequence

Build a picture-in-picture on preview, check it, then put it on air and keep it:

```
Select Screen 3
Recall Memory 1                          the base look, into preview
Set Layer 2 Source 2 Size 30% Position 75% 75%
Take                                     preview goes to program
Store Memory 20                          keep what is now on air
Label Memory 20 "PIP bottom right"
```

Six lines, and only one of them reaches air.

---

## 8. When something does not work

**"empty memory — the device ignored this."** You recalled a memory that holds
nothing. The device accepts that and does nothing at all — no error, no
response — so Mynah watches for the silence and reports it rather than showing
a green tick. Try it in the simulator: `Recall Screen 1 Memory 99`.

**"Set needs a live connection."** Layer parameters need the take state to work
out which buffer to write to, and that comes from the device.

**"the canvas size of Screen 3 is not known yet."** A percentage needs
something to be a percentage of. Give pixels instead, or wait for the device to
report its canvas.

**"Screen 99 out of range."** Refused rather than clamped, because clamping
would run a command you did not type.

**""S" is ambiguous — Screen, Store, Source…"** Add a letter. The candidates
are always listed.

---

## 9. Command history

`↑` and `↓` walk everything you have typed this session, terminal-style. A
part-typed line is kept aside, so walking up and back down returns it intact.

---

## 10. Quick reference

| | |
|---|---|
| `Recall Screen 1 Memory 5` | memory to preview |
| `Recall Screen 1 Memory 5 Program` | straight to air |
| `Recall Master 12` | whole-desk memory |
| `Recall Screen 3 Layer 1 Memory 8` | layer memory |
| `Store Screen 1 Memory 5` | store program |
| `Store Master 12 If Screen 1 + 3 Category Source` | masked store |
| `Label Screen 1 Memory 5 "Name"` | name a memory |
| `Delete Screen 1 Memory 5` | erase it |
| `Take Screen 1 Thru 4` | transition |
| `Select Screen 1 + 3` | sticky scope |
| `Set Screen 3 Layer 2 Source 1` | assign a source |
| `Set Screen 3 Layer 2 Size 50%` | half the canvas |
| `Set Screen 3 Layer 2 Position 33% 50%` | centre, a third across |
| `Set Screen 3 Layer 2 Opacity 50%` | half opacity |
| `Clear` | clear the line, then the scope |
