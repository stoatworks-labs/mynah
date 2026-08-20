# Mynah command syntax

A command line for Analog Way LivePremier (Aquilon) switchers, built on the
grammar rules of a lighting desk and the vocabulary of a video switcher.

The grammar rules are grandMA3's — verb first, keyword abbreviation, `Thru` /
`+` / `-` ranges, an `If` filter clause, Enter to execute. The nouns are the
switcher's own: `Screen`, `Aux`, `Layer`, `Master`, `Memory`, `Preview`,
`Program`. Nothing here calls anything a fixture or a cue.

> Firmware note: every path and every limit in this document was read off a
> LivePremier running **6.2.73**. Analog Way moved paths at 4.0 and again
> before 6.2, so the path table is firmware-tagged. See [PATHS.md](PATHS.md).

---

## 1. Shape of a command

```
[Function] [Object] [Object] … (If [Filter]) ⏎
```

The function comes first, then the objects it acts on, innermost scope last.
Enter executes. Nothing is sent to the device until Enter.

```
Store Master 12
Recall Screen 1 Memory 5
Store Master 12 If Category Source + Position
```

### Case and abbreviation

Keywords are case-insensitive, and every keyword may be shortened to any
prefix that is unambiguous **across the whole vocabulary**. These are all the
same command:

```
Recall Screen 1 Thru 4 Memory 5 Preview
recall screen 1 thru 4 memory 5 preview
R Sc 1 Th 4 Me 5 Pre
```

Because ambiguity is resolved against every keyword at once, a word's short
form is a property of the table rather than of the word: `Mast` reaches Master
only because nothing else starts `Mast`, and `Mask` has **no** abbreviation at
all, since `Mas` is shared with `Master`. Short forms are therefore computed
from the table and shown in the app, never written down — adding a keyword can
lengthen its neighbours, and a hand-kept list would quietly go wrong.

An ambiguous prefix is refused *with its candidates*, so the command line tells
you which letter to add rather than calling the word unknown.

---

## 2. Objects

| Keyword | Short | Range | Device key |
|---|---|---|---|
| `Screen` | `Sc` | 1–24 | `S1`…`S24` |
| `Aux` | `A` | 1–96 | `A1`…`A96` |
| `Layer` | `Lay` | `Native`, 1–128 | `NATIVE`, `1`…`128` |
| `Master` | `Mast` | — | — |
| `Multiviewer` | `Mu` | 1–8 | output index |
| `Memory` | `Me` | see below | slot key |

`Master` is the one object with no instance number of its own, so a number
after it is the memory slot: `Store Master 12` is `Store Master Memory 12`.

`Memory` slot ranges differ per bank, and the parser enforces them:

| Bank | Slots |
|---|---|
| Screen / Aux memory | 1–1000 |
| Master memory | 1–500 |
| Layer memory | 1–50 |
| Multiviewer memory | 1–50 |

### Preset mode

| Keyword | Short | Device key |
|---|---|---|
| `Preview` | `Pre` | `PREVIEW` |
| `Program` | `Pro` | `PROGRAM` |

Note the device keeps *three* preset buffers per screen — `A`, `B` and `C` —
and `Preview`/`Program` are names for whichever buffer is currently live or
pending, not fixed buffers. A take swaps which is which.

Commands only ever address `Preview` and `Program`, so this does not affect
anything you type. It matters for reading state back: the device reports
memory contents against `A`/`B`/`C`, and resolving those to preview/program
needs the current take state. Mynah does not display buffer contents yet, so
it does not do that resolution — worth knowing before adding a status view.

---

## 3. Functions

| Keyword | Short | Meaning |
|---|---|---|
| `Recall` | `R` | Load a memory into a preset |
| `Store` | `St` | Save a preset into a memory |
| `Take` | `Ta` | Transition preview to program |
| `Delete` | `D` | Erase a memory |
| `Label` | `Lab` | Name a memory |
| `Select` | `Se` | Set the sticky scope |
| `Clear` | `Cl` | Clear the command line, then the scope |

---

## 4. Ranges and lists

Borrowed wholesale from grandMA3, and they compose:

| Form | Meaning |
|---|---|
| `Screen 1 Thru 4` | S1, S2, S3, S4 |
| `Screen 1 + 3` | S1, S3 |
| `Screen 1 Thru 8 - 5` | S1–S8 except S5 |
| `Screen 1 Thru` | S1 to the highest screen |
| `Screen Thru 4` | the lowest screen to S4 |
| `Screen 1 Thru 4 + 8 - 2` | S1, S3, S4, S8 |

`Thru` is inclusive at both ends. `+` and `-` bind left to right, so a `-`
removes from everything accumulated so far.

A ranged command expands to one device operation per member. `Recall Screen 1
Thru 4 Memory 5` is four writes on one socket, in ascending order, and the
command line reports it as `4 ops`.

---

## 5. Scope

Two ways to say which screen or layer a command acts on.

### Inline

The scope is part of the command:

```
Recall Screen 1 Memory 5
Store Screen 3 Layer 2 Memory 7
```

### Sticky

`Select` sets a scope that persists until changed. Later commands that omit a
scope inherit it:

```
Select Screen 1 + 3
Recall Memory 5            → recalls into S1 and S3
Store Memory 9             → stores from S1 and S3
Take                       → takes S1 and S3
```

The current scope is always displayed above the command line. An inline scope
overrides the sticky scope for that one command and does not change it.

`Clear` pressed once clears a part-typed command line; pressed again on an
empty line it clears the scope.

> The vendor Web RCS has its own screen selection, and it rides the same
> WebSocket (`REMOTE` channel, `screenAuxSelection`). Mynah follows it and
> mirrors its own selection back, so selecting a screen in either place
> selects it in both. This is a setting; turn it off if you want the command
> line to keep a scope the vendor UI cannot move.

---

## 6. The `If` clause — record masks

`Store Master` on this device does not take a screen argument. It takes four
*filters*, and Mynah exposes them as grandMA3's `If`:

```
Store Master 12                                   whole desk
Store Master 12 If Screen 1 + 3                   only S1 and S3
Store Master 12 If Screen 1 Thru 4 Aux 1          S1–S4 and A1
Store Master 12 If Category Source + Pos          only source and position
Store Master 12 If Screen 1 Layer 1 Thru 4 Category Size
```

The filter keywords are `Screen`, `Aux`, `Layer` and `Category`, each taking
the same ranges as anywhere else. Omit a filter and it stays wide open.

### Categories

`Category` maps to the device's own `categoryFilter`, which is a record mask
in everything but name:

| Keyword | Short | Device value |
|---|---|---|
| `Source` | `So` | `SOURCE` |
| `Position` | `Po` | `POS` |
| `Size` | `Si` | `SIZE` |
| `Opacity` | `O` | `OPACITY` |
| `Cropping` | `Cr` | `CROPPING` |
| `Border` | `B` | `BORDER` |
| `Transitions` | `Tr` | `TRANSITIONS` |
| `Effects` | `E` | `EFFECTS` |
| `FlyingCurve` | `F` | `FLYING_CURVE` |
| `Timing` | `Ti` | `TIMING` |
| `Speed` | `Sp` | `SPEED` |
| `CutAndFill` | `Cu` | `CUT_AND_FILL` |
| `Mask` | — | `MASK` |
| `Keyer` | `K` | `KEYER` |

`If` on a `Store Screen` or `Store Layer` is rejected: those banks have no
filter properties on this firmware, and silently ignoring a mask the operator
typed is worse than refusing it.

---

## 7. Defaults

Defaults exist so the common command is short, and they are deliberately
asymmetric:

| Command | Omitted | Default | Why |
|---|---|---|---|
| `Recall` | preset mode | **Preview** | A recall you did not fully specify should not hit air. |
| `Store` | preset mode | **Program** | You store the look that is on air; this is also the device's own `SAVE_FROM_PGM` default. |
| any | scope | the sticky scope | |
| `Store Master` | filter | wide open | matches the device's default filter state |

Reaching program always takes an explicit word — `Program` on a recall, or
`Take`. There is no configuration option to make `Recall` default to program.

---

## 8. Grammar

```ebnf
command     = function , { object } , [ if-clause ] ;

function    = "Recall" | "Store" | "Take" | "Delete" | "Label"
            | "Select" | "Clear" ;

object      = screen-obj | aux-obj | layer-obj | master-obj
            | mv-obj | memory-obj | preset-mode | string ;

screen-obj  = "Screen" , range ;
aux-obj     = "Aux"    , range ;
layer-obj   = "Layer"  , layer-range ;
master-obj  = "Master" ;
mv-obj      = "Multiviewer" , range ;
memory-obj  = "Memory" , number ;
preset-mode = "Preview" | "Program" ;

if-clause   = "If" , filter , { filter } ;
filter      = ( "Screen" | "Aux" | "Layer" ) , range
            | "Category" , category-list ;

range       = range-term , { ( "+" | "-" ) , range-term } ;
range-term  = number
            | number , "Thru" , [ number ]
            | "Thru" , number ;
layer-range = range | "Native" ;

number      = digit , { digit } ;
string      = '"' , { character } , '"' ;
```

---

## 9. Worked examples

```
Recall Screen 1 Memory 5
    → presetBank/control/load/slot 5/screen S1/preset PREVIEW/xRequest = true

Recall Screen 1 Thru 4 Memory 5 Program
    → four writes, S1…S4, preset PROGRAM

Store Screen 1 Memory 5
    → presetBank/control/save/screen S1/preset PROGRAM/slot 5/xRequest = true

Store Master 12 If Screen 1 + 3 Category Source + Pos
    → masterPresetBank/control/save/mode          = SAVE_FROM_PGM
      masterPresetBank/control/save/screenFilter  = ["S1","S3"]
      masterPresetBank/control/save/categoryFilter= ["SOURCE","POS"]
      masterPresetBank/control/save/slot 12/xRequest = true

Store Screen 3 Layer 2 Memory 7
    → layerBank/control/save/screen S3/preset PROGRAM/layer 2/slot 7/xRequest = true

Recall Master 12
    → masterPresetBank/control/load/slot 12/preset PREVIEW/xRequest = true

Take Screen 1 Thru 4
    → four writes, screenAuxGroup/S1…S4/control/xTake = true

Delete Screen 1 Memory 5
    → presetBank/$bank/items/5/control/xDelete = true

Label Screen 1 Memory 5 "Wide Open"
    → presetBank/$bank/items/5/control/label = "Wide Open"

Select Screen 1 + 3
    → no device write; sets the sticky scope
```

---

## 10. Feedback

A recall returns nothing over AWJ, which is why the AWJ guide tells you to
read state back. The WebSocket does better: the device pushes

```
…/load/slot 5/screen S1/preset PREVIEW/isLoading = true
…/load/slot 5/screen S1/preset PREVIEW/isLoading = false
presetBank/status/presetId/screen S1/preset B/id = 5
presetBank/status/presetId/screen S1/preset B/isNotModified = true
```

so Mynah shows a command as *sent*, then *loading*, then *landed on B as
memory 5, unmodified* — and marks it modified the moment anyone touches that
screen, in Mynah or in the vendor UI. A command that never reports back goes
amber rather than green.

---

## 11. What this does not cover yet

The first pass is memories: recall, store, delete, label, take, and scope.
The device object model recovered from the Web RCS bundle runs to roughly
2,040 modules, and the intention is for the syntax to grow over it —
source assignment, layer geometry, transitions, timers, multiviewer layouts.
The grammar above is built so that growth is new *object keywords*, not new
grammar rules.
