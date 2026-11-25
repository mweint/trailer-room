# Trailer Room front-end design

The contract for everything in `web/`. If code and this file disagree, one of them is a bug.

## Principles

- **The picture is the product.** Page chrome is quiet, dark and low-contrast; only the play pill, the focus ring and selected chips are bright.
- **One of each thing.** One button, one switch, one select, one menu, one panel heading. A new screen is built from these before anything new is added.
- **No build step.** Plain HTML, CSS and ES modules served as files. No framework, bundler or npm.
- **Native first.** `<dialog>`, `<details>`, `<input type=range>`, `<select>` before custom widgets.

## Tokens (`web/css/tokens.css`)

Every colour, and every shared size, radius, font size and duration, is a token. No colour is written outside `tokens.css` except in `crt.css` (optical effect constants) and SVG data. Geometry that belongs to one component only (switch knob, spinner, logo column, dialog width) is a custom property declared on that component's root rule, not a number repeated through the file. Hairline borders and outlines (1–3px), line-heights, font weights and z-index are written directly.

| Group | Token | Value | Use |
| --- | --- | --- | --- |
| Page | `--color-bg` | `#0f0f0f` | Page background |
| | `--color-surface` | `#1b1b1b` | Dialog, inputs |
| | `--color-surface-raised` | `#222222` | Menus, popovers |
| | `--color-hover` | `#ffffff12` | Hover and pressed fill: a white overlay, so it shows equally on the page, a menu or a dialog |
| | `--color-placeholder` | `#2a2a2a` | Poster and artwork placeholder |
| | `--color-border` | `#333333` | Dividers, quiet outlines |
| | `--color-border-strong` | `#444444` | Input and dialog outlines |
| Text | `--color-text` | `#f2f2f2` | Titles and body text |
| | `--color-text-secondary` | `#c8c8c8` | Bylines, controls at rest |
| | `--color-text-muted` | `#a3a3a3` | Metadata, counts |
| State | `--color-focus` | `#c2d5ff` | Focus ring, 2px, offset 3px |
| | `--color-warning` | `#deb78e` | Source failures |
| | `--color-highlight` | `#ffffff` | Hover emphasis: play pill, menu toggle, source name; spinner head on the picture |
| Video | `--video-black` | `#050505` | Behind and around the picture |
| | `--video-ink` | `#f6f6f4` | Controls and text drawn on the picture |
| | `--video-ink-contrast` | `#17181a` | Text on the play pill |
| | `--video-scrim` | `#08090b` | Dock gradient base (used with alpha) |
| Space | `--space-1 … --space-8` | `.25 .5 .75 1 1.5 2rem` | All gaps and padding |
| Size | `--control` | `2.25rem` | Pointer control height |
| | `--control-touch` | `2.75rem` | Coarse-pointer and dialog control height |
| | `--icon`, `--icon-sm` | `18px`, `16px` | Icons |
| Radius | `--radius-sm` `--radius-md` `--radius-lg` `--radius-pill` | `3px 6px 10px 999px` | Thumbnails / controls / panels, menus, dialog / pill, switch |
| Type | `--font-ui` | `Inter, "Segoe UI", sans-serif` | Everything |
| | `--font-brand` | `"DM Serif Text", Georgia, serif` | Masthead wordmark only |
| | `--text-root` | `16px` | Root size; the page does not scale with the browser's default font size |
| | `--text-meta` `--text-ui` `--text-body` `--text-section` `--text-title` `--text-brand` | `.8125 .875 1 1.125 1.25 1.5rem` | Six sizes, no others |
| | `--measure` | `65ch` | Longest line of body text |
| Motion | `--motion-press` `--motion-fast` `--motion-base` | `120ms`, `150ms`, `200ms` | Press feedback / colour and hover / small entrances (menus, fades) |
| | `--motion-layout` `--motion-layout-exit` | `250ms`, `200ms` | Expanding / collapsing. Exits are faster than entrances. |
| | `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | Anything entering or leaving: regions opening and closing, overlays, press feedback. The default. |
| | `--ease-in-out` | `cubic-bezier(.77, 0, .175, 1)` | Something already on screen moving to a new place: queue rows, the switch knob, a chevron turning |
| | `--ease-colour` | `ease` | Colour and hover changes |

**Colour.** Neutrals are pure grey (equal red, green and blue). Hue appears only where it carries meaning: focus (blue) and warning (amber). There is no accent colour until the brand has one; when it does, it is added here as a token and used for the same few things everywhere.

**Motion** follows Emil Kowalski's design-engineering guide (`emilkowalski/skills`, `emil-design-eng`):
- Entering or exiting uses ease-out, moving on screen uses ease-in-out, and colour uses ease. Ease-in is never used.
- UI motion stays under 300ms, and an exit is shorter than its entrance.
- Animate opacity and transform where possible. Height is animated only for show and hide that would otherwise make the page jump (see CSS rules).
- Under `prefers-reduced-motion: reduce`, movement and scaling stop, but fades and colour changes stay.
- Buttons scale to `.97` while pressed. Menus open from their trigger at `scale(.95)` plus a fade, and close instantly. The sheet slides in from its edge.
- The theater-mode resize in `ui/theater.js` is a scripted animation with its own timings.

## Type roles

Every piece of text has one role, and each role has one size, weight and colour. The page is quiet, so sizes stay small: only the film title is above `--text-ui`, apart from section headings and the wordmark. Roles are told apart by weight, colour and grouping, not by making text bigger. Two neighbouring roles never differ by colour alone. The reference is YouTube's watch page, which has the same layout: a list beside the player and a description below it.

| Role | Size | Weight | Colour | Examples |
| --- | --- | --- | --- | --- |
| Title | `--text-title` | 600 | `--color-text` | Film title |
| Section | `--text-section` | 600 | `--color-text` | Up next, Programming |
| Body | `--text-ui`, line-height 1.375rem, at most `--measure` wide; two lines until More | 400 | `--color-text` | Film description |
| Item | `--text-ui`, at most two lines then an ellipsis (full text in the tooltip) | 600 | `--color-text` | Queue row title |
| Byline | `--text-ui` | 400 | `--color-text-secondary` | Directed by |
| Control | `--text-ui` | 400 | inherited | Buttons, labels, menu items |
| Meta | `--text-meta`, tabular figures | 400 | `--color-text-muted` | Year, runtime, genres, counts, Letterboxd rating |
| Group label | `--text-meta` | 600 | `--color-text-muted` | Sources, Decade, Genre, Rating inside Programming |

**Grouping:** text in one group (a title with its byline and meta) is `--space-1` apart. Separate groups (that header, then the body) are `--space-4` apart. The gap between groups is always clearly larger than the gap within one.

## CSS rules

- Style by **class**. IDs are for JavaScript, `label for`, and ARIA only and never appear in a selector.
- State comes from attributes the markup already needs (`[hidden]`, `[disabled]`, `[aria-pressed]`, `[aria-expanded]`, `[aria-busy]`, `[open]`) or a `data-*` attribute on the component root. No state classes invented per case.
- State attributes set by JavaScript: `data-crt` on `.screen`; `data-controls="hidden"`, `data-hover="local"` and `data-transport` on `.display`; `data-theater` on `.page`; `data-expanded` on `.theater`.
- No `style="…"` attributes. JavaScript writes only these custom properties: `--fill` (range), `--queue-height` (queue), `--art` (screen artwork), `--beam` `--triad` `--tube-texture` (CRT).
- **Motion is applied by kind, never per place.** Every change that moves or shows something is one of three kinds, and each has one implementation:
  1. *In place.* A region opens, closes, appears or disappears (Programming, the description, Plex setup steps, the no-match note, the hidden and skipped lists; `resize(node, change)` when a region's own content grows, like a chip group). It carries `.collapse` and changes only through `expand(toggle, open)` (the region named by the toggle's `aria-controls`) or `reveal(node, shown)` in `dom.js`. These measure the height before and after the change and animate between the two, with the content fading, using `--ease-out` over `--motion-layout` when opening and `--motion-layout-exit` when closing. This works in every browser and for partial states (a preview's first lines). Closed regions get `visibility: hidden`, so they leave the tab order. Neighbours that size from them (the queue) follow frame by frame. No feature writes its own height transition.
  2. *Overlays.* Menus open from their trigger at `scale(.95)` with a fade (menu CSS) and close instantly. Dialogs open and close only through `openDialog()` / `closeDialog()` in `dom.js`: a centred dialog grows from `scale(.95)`, a sheet slides in from its edge, both fade with their backdrop, and closing runs the same motion faster. Esc, the close button (an icon X at the end of the heading) and a click outside all close it.
  3. *Lists.* When a list's items change, `places()` before and `glide()` after slide the items that stayed to their new places and fade in the new ones (the queue).

  Changes driven by playback or keyboard shortcuts (next film, the picture's cover) are exempt and only cross-fade. Under `prefers-reduced-motion: reduce`, sizes and positions snap and fades remain.
- **Clipped content fades; it is never cut hard.** Where more content sits past an edge, that edge fades over a mask: the queue's top and bottom (only while rows are hidden there) and a preview collapse's last line. A label (a title in a list) truncates with an ellipsis instead. Masks use `black` and `transparent` as alpha only; they are not colours.
- **Controls are built so their parts line up on their own.** Text in buttons and chips is trimmed to cap height (`text-box: trim-both cap alphabetic`), so labels centre optically and line up with icons beside them. A wrapping group of controls keeps its lines at natural height (`align-content: flex-start`), so it never stretches while its height animates. A `<label>` holds exactly one control: any other control in the same row sits beside the label, never inside it, or the label hands its clicks to that control.
- **Labels align to the column; fills bleed.** A button whose label must line up with a column edge (queue rows, the sources toggle, More) uses `.button--flush`: it keeps its padding and takes an equal negative margin, so the hover fill extends past the column instead of the text sitting off it. A scroll box around flush rows pads by the same inset and cancels it with a negative margin, so the fill is not clipped; on the scrollbar side it pads one inset more, so fills never run under a scrollbar. A row with a thumbnail uses the same inset on every side of it, and its corners are concentric with the thumbnail's (outer radius ≈ inner radius + inset).
- **The sidebar is Up next only.** Its heading is followed by one summary line of what Programming lets through, which opens the Programming sheet. Beside the player the list ends level with the bottom of the picture, so both columns share one edge.
- **Queue rows** span the column. Remove (×) sits at the right end, shows on hover or focus and always on touch, and takes the film out of the current round only; Hide movie in the film options is the lasting version.
- **Plex** is one server and any number of its film libraries. Each library is its own source (`plex-<library key>`) with its own switch, count and status; the server is managed from the group heading, and the picker offers a switch per library. The browser that connected Plex changes libraries without signing in again (it holds the same key that lets it remove Plex); signing in is needed only to use another server or from another browser.
- **Status lines show work in progress and errors only.** A finished action (a library connected or removed) is shown by the change itself, so its message clears instead of staying behind.
- **Every clickable thing sets its own cursor.** A row that is a label is the label itself, so the whole row, switch included, shows one pointer; nothing inherits a cursor from a non-clickable parent.
- One file per component or feature. A feature file may hold several closely tied roots (`screen.css`: `.display`, `.screen`, `.start`; `dock.css`: `.dock`, `.transport`, `.view-tools`, `.wake-surface`). Formatted one declaration per line.
- `base.css` holds the reset, element defaults, `.icon` and `.sr-only`. `layout.css` holds the page grid (`.page`, `.theater`, `.sidebar`), theater mode and the page breakpoints.
- Breakpoints: page at `54rem` and `36rem`; player at container width `30rem`; touch via `(pointer: coarse)`. Motion respects `prefers-reduced-motion`.

## Components

Primitives (`web/css/components/`), reused everywhere:

| Component | Class | Variants |
| --- | --- | --- |
| Button | `.button` | `--icon` (every icon-only button on the page, always round); `--primary` (the one action that completes a form, Save: filled in the bright text colour, like a selected chip); `--text` (an action that stands on its own: Change, Remove, Restore, More, Cancel: no underline, dimmer text that brightens, with the hover fill); `--inline` (an action inside a sentence: Retry, Clear filters: underlined, no box); `--on-video` (on the picture: no fill and no shape, dimmed at rest and bright on hover, as in YouTube's player; a pressed tool keeps its bar underneath); `--flush` (aligned to the column; padding set by `--button-inset`). Underlines mean a link in a sentence and nothing else. |
| Switch | `.switch` | — |
| Range | `.range` | timeline, volume |
| Select | `.select` | Native select with control text (`--text-ui`) and its arrow replaced by a chevron, inset from the right edge by the same `--space-3` as the text from the left. Features may size it (width) but never restyle it. |
| Menu | `.menu` | film options. The compact view-tools popover is part of the dock, because the same buttons sit inline at every other width. |
| Panel heading | `.panel-heading` | — |
| Dialog | `.dialog` | `--sheet` (docked to the right edge, full height) |
| Spinner | `.spinner` | on pill, on picture |
| Collapse | `.collapse` | `--preview` (first lines stay, last fades). Opened and closed only through `expand()` / `reveal()` in `dom.js`. |
| Chip | `.chip` in `.chips` | Toggle with `aria-pressed`; an Any chip clears the group. Less common values are hidden behind a +N chip; when shown they continue in the same flow and the toggle becomes "Show fewer", always the last chip. The group's height animates through `resize()`. |

Features (`web/css/features/` and `web/js/ui/`). Each has a CSS file; the module column names the code that owns its DOM:

| Feature | Root | Module | Owns |
| --- | --- | --- | --- |
| Masthead | `.mast` | `preferences.js` (button only) | Wordmark, Programming button |
| Screen | `.screen` | `screen.js` | Artwork, embed, cover, play pill |
| CRT | `.screen[data-crt]` | `crt.js` | Raster, bloom, convergence |
| Dock | `.dock` | `dock.js`, `transport.js` | Auto-hide and view tools; title, timeline, transport buttons, volume |
| Film info | `.film-info` | `film-info.js` | Title, credit, facts, description (three lines, More), film options menu |
| Queue | `.queue` | `queue.js` | Up-next list, poster loading as rows scroll into view, list height |
| Programming | `.programming` (a sheet) | `programming.js`, `preferences.js`, `plex.js` | Everything about what plays, in groups divided by hairlines: Sources (rows with status and retry; then Plex as its own group: a heading naming the server with Change and Remove links, and one ordinary source row per connected library, or a "Connect Plex" row when none), Decade, Genre (with "Still collecting" progress while the server's pass runs), Rating, then Hidden movies and Skipped trailers folded into one row each with a count. Live film count, Clear filters when nothing matches. Opened from the masthead button and the summary line under Up next. |

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
  film-info.js  queue.js  programming.js  preferences.js  plex.js
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

## Genres

One vocabulary, made on the server (`GENRES` in `server.py`): the list Letterboxd uses (TMDB's), without TV Movie, plus Musical and Noir. Sci-Fi becomes Science Fiction and Biography becomes History. Short, Sport, TV Movie and other TV categories are dropped; a film always has another genre as well.
