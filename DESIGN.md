# Trailer Room front-end design

The contract for everything in `web/`. If code and this file disagree, one of them is a bug.

## Principles

- **The picture is the product.** Page chrome is quiet, dark and low-contrast; only the play pill and the focus ring are bright.
- **One of each thing.** One button, one switch, one select, one menu, one panel heading. A new screen is built from these before anything new is added.
- **No build step.** Plain HTML, CSS and ES modules served as files. No framework, bundler or npm.
- **Native first.** `<dialog>`, `<details>`, `<input type=range>`, `<select>` before custom widgets.

## Tokens (`web/css/tokens.css`)

Every colour, and every shared size, radius, font size and duration, is a token. No colour is written outside `tokens.css` except in `crt.css` (optical effect constants) and SVG data. Geometry that belongs to one component only (switch knob, spinner, logo column, dialog width) is a custom property declared on that component's root rule, not a number repeated through the file. Hairline borders and outlines (1–3px), line-heights, font weights and z-index are written directly.

| Group | Token | Value | Use |
| --- | --- | --- | --- |
| Page | `--color-bg` | `#0f0f0f` | Page background |
| | `--color-surface` | `#1b1c1a` | Dialog, inputs |
| | `--color-surface-raised` | `#22231f` | Menus, popovers |
| | `--color-surface-hover` | `#252620` | Hover and pressed fill |
| | `--color-placeholder` | `#2a2b27` | Poster and artwork placeholder |
| | `--color-border` | `#33342e` | Dividers, quiet outlines |
| | `--color-border-strong` | `#444540` | Input and dialog outlines |
| Text | `--color-text` | `#f4f3ed` | Primary |
| | `--color-text-secondary` | `#c9cac5` | Credits, icon buttons at rest |
| | `--color-text-muted` | `#a7a8a0` | Metadata, counts |
| State | `--color-focus` | `#c2d5ff` | Focus ring, 2px, offset 3px |
| | `--color-warning` | `#deb78e` | Source failures |
| | `--color-highlight` | `#ffffff` | Hover emphasis: play pill, menu toggle, source name; spinner head on the picture |
| Video | `--video-black` | `#050505` | Behind and around the picture |
| | `--video-ink` | `#f6f6f4` | Controls and text drawn on the picture |
| | `--video-ink-contrast` | `#17181a` | Text on the play pill |
| | `--video-scrim` | `#08090b` | Dock gradient base (used with alpha) |
| | `--video-control-hover` | `#ffffff20` | Hover fill on the picture |
| Space | `--space-1 … --space-8` | `.25 .5 .75 1 1.5 2rem` | All gaps and padding |
| Size | `--control` | `2.25rem` | Pointer control height |
| | `--control-touch` | `2.75rem` | Coarse-pointer and dialog control height |
| | `--icon`, `--icon-sm` | `18px`, `16px` | Icons |
| Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-pill` | `3px 6px 10px 999px` | Thumbnails / controls / panels, menus, dialog / pill, switch |
| Type | `--font-ui` | `Inter, "Segoe UI", sans-serif` | Everything |
| | `--font-brand` | `"DM Serif Text", Georgia, serif` | Masthead wordmark only |
| | `--text-root` | `16px` | Root size; the page does not scale with the browser's default font size |
| | `--text-meta` `--text-ui` `--text-body` `--text-section` `--text-title` `--text-brand` | `.8125 .875 1 1.125 1.25 1.5rem` | Six sizes, no others |
| Motion | `--motion-fast` `--motion-base` | `140ms`, `220ms` | Colour and opacity state change / small movement |
| | `--ease-out` | `cubic-bezier(.22, 1, .36, 1)` | State transitions. The theater-mode resize in `ui/theater.js` is a scripted animation with its own timings. |
| | `--motion-layout` `--ease-layout` | `360ms`, `cubic-bezier(.4, 0, .2, 1)` | Anything that changes height or moves other content. Ease-in-out on purpose: a sharp ease-out covers most of the distance in the first two frames and reads as a snap. |

Neutrals are warm (slightly olive). The current mix of warm and blue-grey surfaces is drift and is folded into the tokens above.

## CSS rules

- Style by **class**. IDs are for JavaScript, `label for`, and ARIA only and never appear in a selector.
- State comes from attributes the markup already needs (`[hidden]`, `[disabled]`, `[aria-pressed]`, `[aria-expanded]`, `[aria-busy]`, `[open]`) or a `data-*` attribute on the component root. No state classes invented per case.
- State attributes set by JavaScript: `data-crt` on `.screen`; `data-controls="hidden"`, `data-hover="local"` and `data-transport` on `.display`; `data-theater` on `.page`; `data-expanded` on `.theater`.
- No `style="…"` attributes. JavaScript writes only these custom properties: `--fill` (range), `--queue-height` (queue), `--art` (screen artwork), `--beam` `--triad` `--tube-texture` (CRT).
- **Every show or hide that moves layout animates.** A collapsible block is a one-row grid whose row goes between `1fr` and `0fr`, with a clipped body inside; this animates in every current browser. It runs over `--motion-layout` with `--ease-layout`, and the content fades with it. Neighbours that size from it (the queue) follow frame by frame. Height-to-`auto` transitions (`interpolate-size` on `:root`) are used only where a grid cannot express the end state (the description's three-line clamp) and snap in browsers without them. Closed content also gets `visibility: hidden`, so it leaves the tab order and the accessibility tree. Nothing snaps except under `prefers-reduced-motion: reduce`.
- **Clipped content fades; it is never cut hard.** Where more content sits past an edge, that edge fades over a mask: the queue's top and bottom (only while rows are hidden there) and the description's last line. Masks use `black` and `transparent` as alpha only; they are not colours.
- **Labels align to the column; fills bleed.** A button whose label must line up with a column edge (queue rows, the sources toggle, More) uses `.button--flush`: it keeps its padding and takes an equal negative margin, so the hover fill extends past the column instead of the text sitting off it. A scroll box around flush rows pads by the same inset and cancels it with a negative margin, so the fill is not clipped; on the scrollbar side it pads one inset more, so fills never run under a scrollbar. A row with a thumbnail uses the same inset on every side of it, and its corners are concentric with the thumbnail's (outer radius ≈ inner radius + inset).
- **Queue rows** span the column. Remove (×) sits at the right end, shows on hover or focus and always on touch, and takes the film out of the current round only; Hide movie in the film options is the lasting version.
- One file per component or feature. A feature file may hold several closely tied roots (`screen.css`: `.display`, `.screen`, `.start`; `dock.css`: `.dock`, `.transport`, `.view-tools`, `.wake-surface`). Formatted one declaration per line.
- `base.css` holds the reset, element defaults, `.icon` and `.sr-only`. `layout.css` holds the page grid (`.page`, `.theater`, `.sidebar`), theater mode and the page breakpoints.
- Breakpoints: page at `54rem` and `36rem`; player at container width `30rem`; touch via `(pointer: coarse)`. Motion respects `prefers-reduced-motion`.

## Components

Primitives (`web/css/components/`), reused everywhere:

| Component | Class | Variants |
| --- | --- | --- |
| Button | `.button` | `--icon` (square), `--outline` (dialog actions), `--link` (inline retry, More), `--on-video`, `--flush` (aligned to the column; padding set by `--button-inset`) |
| Switch | `.switch` | — |
| Range | `.range` | timeline, volume |
| Select | `.select` | — |
| Menu | `.menu` | film options. The compact view-tools popover is part of the dock, because the same buttons sit inline at every other width. |
| Panel heading | `.panel-heading` | — |
| Dialog | `.dialog` | — |
| Spinner | `.spinner` | on pill, on picture |

Features (`web/css/features/` and `web/js/ui/`). Each has a CSS file; the module column names the code that owns its DOM:

| Feature | Root | Module | Owns |
| --- | --- | --- | --- |
| Masthead | `.mast` | `preferences.js` (button only) | Wordmark, preferences button |
| Screen | `.screen` | `screen.js` | Artwork, embed, cover, play pill |
| CRT | `.screen[data-crt]` | `crt.js` | Raster, bloom, convergence |
| Dock | `.dock` | `dock.js`, `transport.js` | Auto-hide and view tools; title, timeline, transport buttons, volume |
| Film info | `.film-info` | `film-info.js` | Title, credit, facts, description (three lines, More), film options menu |
| Queue | `.queue` | `queue.js` | Up-next list, poster loading as rows scroll into view, list height |
| Sources | `.sources` | `sources.js` | Source toggles, status and retry, rating filter |
| Preferences | `.preferences` | `preferences.js`, `plex.js` | Plex setup, hidden and skipped lists |

`theater.js` (theater mode, fullscreen; styled in `layout.css`) and `shortcuts.js` have no CSS file of their own.

## JavaScript layout (`web/js/`)

```
main.js            start-up and wiring only; builds the view object the playback layer calls
dom.js             $, el, headingLink
api.js             fetch helpers for /api/*
prefs.js           load, save and defaults for localStorage
catalog.js         source list (Plex is added and removed at runtime), merge, rating and match logic (no DOM)
library.js         loaded catalogs, merged films, source status, film detail cache, polling (no DOM)
playback/
  controller.js    current film and clip, advance, retry, failure counting
  rotation.js      queue order: shuffle scores, seen, unavailable and broken sets
  player.js        generation counter, mount, idle YouTube reuse, reset, audio, captions
  sdk.js           provider script loader
  youtube.js       YouTube adapter
  vimeo.js         Vimeo adapter
ui/
  screen.js  crt.js  dock.js (auto-hide, view tools)  transport.js (title, timeline, buttons, volume)
  film-info.js  queue.js  sources.js  preferences.js  plex.js
  theater.js (theater mode, fullscreen)  shortcuts.js
```

- Dependencies point one way: `ui → playback → library → catalog/prefs/api`. `ui` modules never import each other; `main.js` connects them with callbacks. The playback layer creates the provider iframe and loads the provider script itself; every other change to the page goes through the view object `main.js` hands it.
- Both provider adapters expose the same interface: `play pause seek seekTo volume mute captions destroy`, plus optional `canReuse` and `load`. They receive their callbacks (state, position, ended, failed, blocked, audio ready) as one hooks argument.
- No module-level mutable state shared by import. State lives in the module that owns it and is changed through its functions. The one exception is `SOURCES` in `catalog.js`, read by import and changed only through `addSource` and `removeSource`.
- No file over about 250 lines (`playback/controller.js` is 282: the advance loop and its failure paths share one state and stay together). One statement per line.
- DOM is built with `el()` and `textContent`; never `innerHTML`.

## Server

`server.py` serves any file under `web/` (path resolved and checked to stay inside it) instead of a hand-kept list.

## Out of scope for the cleanup

Behaviour, copy, layout, the API, and the `trailer-room.v1` storage format stay exactly as they are.
