# Device paths

Every path here was read back off a running LivePremier before it was used.

**Firmware: 6.2.73.** Derived on the simulator (`NLC_CMAX`) and then
**re-verified leaf-by-leaf on a real Aquilon C (`NLC_C`) — 21 of 21 paths
resolved, zero failures.** Analog Way moved paths
at AWJ guide v4.0 and again before 6.2 — `$screenGroup` is gone on this
firmware, replaced by `$screenAuxGroup`, and the guide's own subscription
example would fail as printed. Treat this table as firmware-tagged and re-verify
against anything else.

## Two spellings, one model

The same object model is addressed differently by the two transports:

| | AWJ (TCP 10606) | Web RCS store (WebSocket, HTTP snapshot) |
|---|---|---|
| root | `DeviceObject` | `device` |
| collection | `$name` | `nameList` |
| item key | `@items/KEY` | `items`, `KEY` |
| property | `@props/name` | `pp`, `name` |

`src/lang/paths.ts` holds a path once and renders either. The `List` suffix
belongs to the store spelling only: AWJ answers E12 for `$screenList`.

## Memories

Note the asymmetry, which is the device's: **a load is addressed slot-first, a
save target-first.**

```
screen recall  presetBank/control/load/$slot/N/$screen/S<n>/$preset/{PREVIEW|PROGRAM}/xRequest
aux recall     presetBank/control/load/$slot/N/$auxiliary/A<n>/$preset/{…}/xRequest
screen store   presetBank/control/save/$screen/S<n>/$preset/{…}/$slot/N/xRequest
aux store      presetBank/control/save/$auxiliary/A<n>/$preset/{…}/$slot/N/xRequest

master recall  masterPresetBank/control/load/$slot/N/$preset/{…}/xRequest
master store   masterPresetBank/control/save/$slot/N/xRequest
               …preceded by the filter writes below

layer recall   layerBank/control/load/$slot/N/$screen/S<n>/$preset/{…}/$layer/L/xRequest
layer store    layerBank/control/save/$screen/S<n>/$preset/{…}/$layer/L/$slot/N/xRequest

mv recall      monitoringBank/control/load/$slot/N/$output/n/xRequest
mv store       monitoringBank/control/save/$output/n/$slot/N/xRequest

take           $screenAuxGroup/S<n>/control/xTake
```

## The master record mask

`Store Master` takes no screen argument. It takes filters, which persist on the
device until overwritten — so an unfiltered store must write them wide open
rather than leaving whatever was there.

```
masterPresetBank/control/save/@props/mode            SAVE_FROM_PGM | SAVE_FROM_PRW  (not PVW — refused silently)
masterPresetBank/control/save/@props/screenFilter    ["S1"…"S24"]
masterPresetBank/control/save/@props/auxFilter       ["A1"…"A96"]
masterPresetBank/control/save/@props/layerFilter     ["NATIVE","1"…"128"]
masterPresetBank/control/save/@props/categoryFilter  SOURCE POS SIZE OPACITY
                                                     CROPPING BORDER TRANSITIONS
                                                     EFFECTS FLYING_CURVE TIMING
                                                     SPEED CUT_AND_FILL MASK KEYER
```

Filters first, trigger last. Both transports preserve ordering on one
connection, so the whole thing goes out as a burst.

`presetBank` and `layerBank` have **no** `control/save/@props/mode` — those
banks carry no mask on this firmware, which is why `If` is refused on them.

## Memory metadata

```
<bank>/$bank/@items/N/control/@props/label      the memory's name
<bank>/$bank/@items/N/control/@props/xDelete    erase it
<bank>/$bank/@items/N/status/@props/isValid     whether it holds anything
```

## Ranges

Confirmed on a running device, not inferred from probing:

| Dimension | Range |
|---|---|
| `PEMEM_BANK_SLOT` — screen/aux memory | 1–1000 |
| `MASTERMEM_BANK_SLOT` | 1–500 |
| `LAYERMEM_BANK_SLOT` | 1–50 |
| `MONITORING_BANK_SLOT` | 1–50 |
| `SCREEN` | S1–S24 |
| `AUXILIARY` | A1–A96 |
| `SCREEN_LAYER` | NATIVE, 1–128 |
| `PRESET` | A, B, C |

Probing AWJ for `E12` finds the *model's* maximum, not what a chassis has
configured — and it disagrees with this table. Use the table.

## Feedback, and its traps

**Preview and Program are not buffers.** The device keeps three fixed buffers
per screen — `A`, `B`, `C` — and preview/program are names for whichever is
pending or live. A take swaps which is which. Control paths use
`PREVIEW`/`PROGRAM`; status paths report `A`/`B`/`C`:

```
presetBank/status/presetId/$screen/S<n>/$preset/{A|B|C}/@props/id
presetBank/status/presetId/$screen/S<n>/$preset/{A|B|C}/@props/isNotModified
```

**A recall of an empty memory produces silence.** Observed on 6.2.73, recalling
into S1 preview:

```
slot 1 (populated)          slot 5 (empty)
  xRequest = true             xRequest = true
  xRequest = true             xRequest = true
  presetId B id = 0           (nothing further)
  isLoading = true
  presetId B isNotModified = false
  presetId B id = 1
  presetId B isNotModified = true
  isLoading = false
```

So `isLoading` never appearing is the tell, and it is what Mynah reports as an
empty memory. There is no error and no negative acknowledgement.

**Reproduced identically on a real Aquilon C**, not just the simulator.

## The echo carries the value you wrote

A write is acknowledged by the device pushing the same path back. Match on the
*value you sent*, not on `true`: the triggers are booleans, but a label is a
string and the master-store filters are arrays, and a client that only accepts
`true` will report those as unconfirmed forever while they land perfectly well.
The device also pushes a trigger back to `false` afterwards, which is not an
acknowledgement of anything. Found on hardware — a `Label` that worked was
being reported as failed.

## The HTTP side

```
GET /api/device/snapshots/{inputs|images|outputs|multiviewers|timers}/<n>
```
Live thumbnails, unauthenticated, PNG.

```
GET /api/stores/device
```
The **entire** store as one document — 124 MB on a populated chassis. There is
no narrowing: sub-paths 404 and a `?path=` query is ignored. It also carries
**no `Access-Control-Allow-Origin`**, so a page served from anywhere but the
device itself cannot read it at all. The WebSocket has no such restriction and
accepts any origin.

That is why Mynah's memory index is opt-in and usually unavailable, and why the
empty-memory case is detected from the socket instead.

## Midra 4K / Alta 4K — the other platform (firmware 3.3.10 / 1.3.7)

Everything above is LivePremier (`nlc-platform`). Midra 4K (QuickVu, Pulse,
Eikos, QuickMatrix) and Alta 4K (Zenith 100/200) run `mng-platform`, the same
Web RCS architecture over a different object model. `src/lang/platforms.ts`
spells both; pass `platform: MIDRA` to `run()`/`compile()`/`parse()` and every
path below comes out instead. Read off a live Pulse 4K (3.3.10, read-only) and
written on the Midra 4K simulator as a Pulse 4K and the Alta 4K simulator as a
Zenith 200 on 2026-09-12 (audio on 2026-09-13) — each row was written over AWJ and read back.

```text
take                      transition/$screen/@items/1/control/@props/xTake         (aux: transition/$auxiliaryScreen/@items/1/…)
fade                      transition/$screen/@items/1/control/@props/takeTime      one time, tenths; no up/down pair
take status               transition/$screen/@items/1/status/@props/transition     AT_UP … COPY_FROM_DOWN, the same six
screen memory recall      preset/bank/control/load/$slot/@items/5/$screen/@items/1/$preset/@items/PREVIEW/@props/xRequest
screen memory store       preset/bank/control/save/$screen/@items/1/$preset/@items/PROGRAM/$slot/@items/5/@props/xRequest
aux memory recall         preset/auxBank/control/load/$slot/@items/7/$auxiliaryScreen/@items/1/$preset/@items/PREVIEW/@props/xRequest
master recall             preset/masterBank/control/load/$slot/@items/1/$preset/@items/PREVIEW/@props/xRequest
master store              preset/masterBank/control/save/$slot/@items/1/@props/xRequest
master record mask        preset/masterBank/control/save/@props/{mode, screenFilter, auxFilter, screenLayerLiveFilter,
                                                                screenLayerBackFilter, screenLayerTopFilter,
                                                                screenCategoryFilter, auxCategoryFilter}
label / erase             preset/bank/$slot/@items/5/control/@props/{label, xDelete}   ($slot, not $bank)
multiviewer layout        multiviewer/$bank/control/{load,save}/$slot/@items/3/@props/xRequest   one multiviewer, no output
multiviewer label         multiviewer/$bank/@items/3/control/@props/label
live layer source         $screen/@items/1/$preset/@items/UP/$liveLayer/@items/1/source/@props/input     INPUT_1..16, NONE, COLOR
live layer geometry       …/$liveLayer/@items/1/position/@props/{posH,posV}   …/size/@props/{sizeH,sizeV}
live layer opacity        …/$liveLayer/@items/1/opacity/@props/opacity        0..256
aux source                $auxiliaryScreen/@items/1/$preset/@items/UP/background/source/@props/content  an aux has no layers
which memory a buffer holds   $screen/@items/1/$preset/@items/UP/status/@props/{memoryId, isModified}
```

Ranges: screens 1–4, auxes 1–4, layers 1–8 (no NATIVE), one multiviewer;
banks 200 screen, 200 aux, 50 master, 20 multiviewer, **no layer bank**.
Buffers are `UP`/`DOWN`, and which is program is the transition suffix: `…UP`
means program is `UP`. The record-mask categories are SOURCE, POS, SIZE,
OPACITY, CROPPING, MASK, BORDER, TRANSITIONS, EFFECTS, FLYING_CURVE, TIMING,
SPEED, AUDIO — no CUT_AND_FILL or KEYER. There is no audio matrix of the
LivePremier shape (audio is routed — the table below), and a layer cannot show
a still.

### Audio on Midra 4K / Alta 4K — routed, not patched

No channel matrix. Audio moves as eight-channel **sources** — `AUDIO_SOURCE`:
`NONE`, `IN1`…`IN16`, `IN_DANTE_CH1_8|CH9_16|CH17_24|CH25_32`, `IN_ANALOG_1|2`,
`IN_MEDIA_PLAYER`, `CUSTOM_1`…`CUSTOM_10` — and every place it comes out is a
**routing point** that carries one source directly or follows something. The
part an operator programs is the **audio layer**: one source per screen (or
aux) preset, recalled with the memory and swapped by the take like the layers,
heard while the screen's mode is `FOLLOW_AUDIO_LAYER` (the default). Read off
the live Pulse 4K (3.3.10) and its bundle, written on both simulators on
2026-09-13 — every row below over AWJ, read back, restored; and every line of
the grammar through `run()` the same way, 23 lines on each simulator.

```text
audio layer (per preset)  $screen/@items/1/$preset/@items/UP/audio/control/@props/source          AUDIO_SOURCE   (aux: $auxiliaryScreen/…)
screen audio mode         $screen/@items/1/audio/control/@props/mode                  DIRECT_ROUTING | FOLLOW_LIVE_LAYER_CONTENT | FOLLOW_AUDIO_LAYER
screen direct source      $screen/@items/1/audio/control/directRouting/@props/source  AUDIO_SOURCE
screen follows layer      $screen/@items/1/audio/control/followLiveLayer/@props/layer "1".."8" (a string)
aux audio mode            $auxiliaryScreen/@items/1/audio/control/@props/mode         DIRECT_ROUTING | FOLLOW_CONTENT | FOLLOW_AUDIO_LAYER
video output audio        $output/@items/1/audio/control/@props/mode                  NONE | AUTO (the screen it shows) | DIRECT_ROUTING
                          $output/@items/1/audio/control/directRouting/@props/source  outputs 1–6
line out                  audio/$lineOut/@items/1/control/@props/{mode, selectedAudioPair}   DIRECT_ROUTING | FOLLOW_SCREEN; CHANNEL_1_2 … CHANNEL_7_8
                          audio/$lineOut/@items/1/control/{directRouting/@props/source, followScreen/@props/screen}
Dante output group        audio/dante/$outputGroup/@items/1/control/@props/mode       DIRECT_ROUTING | FOLLOW_SCREEN   (groups 1–4 = channels 1-8 … 25-32)
                          audio/dante/$outputGroup/@items/1/control/{directRouting/@props/source, followScreen/@props/screen}
multiviewer               multiviewer/audio/control/@props/mode                       DIRECT_ROUTING | FOLLOW_WIDGET
                          multiviewer/audio/control/{directRouting/@props/source, followWidget/@props/widget}
mutes                     audio/$screen/@items/1/control/@props/mute    audio/$auxiliaryScreen/@items/1/control/@props/mute
                          audio/$output/@items/VIDEO_OUT_1/control/@props/mute        (+ /$channel/@items/3/control/@props/mute)
                          audio/$input/@items/IN6_HDMI_EMBEDDED/$channel/@items/1/control/@props/mute   one per PLUG, not per input
what an output carries    audio/$output/@items/VIDEO_OUT_1/status/@props/source       the effective source, read-only
what is fitted            audio/$source/@items/IN_DANTE_CH1_8/status/@props/isAvailable
```

Three things the tables do not say: the sub-nodes live under `control`
(`audio/control/directRouting`), which the Web RCS's own store mirror hides by
flattening — spelled as a sibling of `control` the device answers "unexpected
path"; the bundle's `AUDIO_AUX_SOURCE` and `AUDIO_IMX_SOURCE` enums add
`SCREEN_n` and `VIDEO_OUT_n` forms, and every direct-routing node refused
every one of them, so the grammar offers `AUDIO_SOURCE` only; and the audio
layer travels with its buffer through a take — `UP` keeps its source when it
becomes program — which is why a patch to a screen goes to preview by default.

⚠️ **`SAVE_FROM_PRW`, on both platforms.** The master save mode enum is
SAVE_FROM_PGM, SAVE_FROM_PRW, USE_EXISTING_MEMORIES and two `_SHADOW` forms.
This document said `SAVE_FROM_PVW` until 2026-09-12, and the compiler wrote
it: the device refuses the value silently and keeps the previous mode, so
every `Store Master … Preview` stored from program. Proven by writing both to
the LivePremier simulator and reading back.

