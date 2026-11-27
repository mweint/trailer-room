// Programming: what goes into the rotation. Source switches with counts, failure status and retry; the Plex
// section; the live film count and the summary under Up next. The filters are in filters.js.
import {$, el, resize} from "../dom.js";
import {refreshSource} from "../api.js";
import {SOURCES, isPlex} from "../catalog.js";
import {allFilms, enabled, fitsFilters, hidden, isLoaded, plexConnection, statusOf, syncCollections} from "../library.js";
import {pref, sourceEnabled, setSourceEnabled, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";

let notice = () => {};
let plexActions = {};

function failureNote(key, state) {
  const date = stamp => new Date(stamp * 1000).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
  const note = el("div", "source-update source-issue");
  note.append(document.createTextNode(
    (state.updated ? "Stale list from " + date(state.updated) : "No saved list") +
    ". Failed " + date(state.attempted) + ": " + state.error + " "));
  const retry = el("button", "button button--inline", state.refreshing ? "Retrying…" : "Retry");
  retry.disabled = state.refreshing;
  retry.onclick = async () => {
    retry.disabled = true;
    try {
      await refreshSource(key);
      await syncCollections();
    } catch {
      retry.disabled = false;
      notice("Could not contact Trailer Room. Try again.");
    }
  };
  note.append(retry);
  return note;
}

function filmCount(key) {
  const total = allFilms().filter(f => f.sources.includes(key) && fitsFilters(f)).length;
  return isLoaded(key) ? total.toLocaleString() + (total === 1 ? " film" : " films") : "Loading…";
}

// The switch that puts a source into the rotation.
function sourceSwitch(key, name, focused) {
  const input = el("input");
  input.type = "checkbox";
  input.checked = !!sourceEnabled(key);
  input.dataset.source = key;
  input.setAttribute("aria-label", name);
  input.onchange = () => {
    setSourceEnabled(key, input.checked);
    changed();
  };
  if (focused === key) {
    queueMicrotask(() => input.focus({preventScroll: true}));
  }
  return input;
}

function withStatus(key, row) {
  const state = statusOf(key);
  return state?.error ? [row, failureNote(key, state)] : [row];
}

// A curated source: a label holding the logo, name, count and switch, so a click anywhere on it flips the switch.
// A label holds no other control, or it would hand its clicks to that control instead.
function sourceRow(key, {name, logo: file}, focused) {
  const label = el("label", "source");
  const text = el("span", "source-details");
  const image = el("img", "source-logo " + key);
  image.alt = "";
  image.src = "/logos/" + file;
  text.append(el("span", "source-name", name), el("span", "count", filmCount(key)));
  label.append(image, text, sourceSwitch(key, name, focused), el("span", "switch"));
  return withStatus(key, label);
}

// A Plex library: a plain switch row (components/switch.css) under the Plex section's heading.
function libraryRow(key, {name}, focused) {
  const label = el("label", "switch-row");
  label.append(el("span", "switch-row-label", name), el("span", "count", filmCount(key)),
    sourceSwitch(key, name, focused), el("span", "switch"));
  return withStatus(key, label);
}

function link(text, action) {
  const button = el("button", "button button--text", text);
  button.type = "button";
  button.onclick = action;
  return button;
}

function focusedSource(container) {
  return container.contains(document.activeElement) ? document.activeElement.dataset.source : null;
}

function renderSources() {
  const focused = focusedSource($("sources"));
  const rows = [];
  for (const [key, source] of Object.entries(SOURCES)) {
    if (!isPlex(key)) {
      rows.push(...sourceRow(key, source, focused));
    }
  }
  $("sources").replaceChildren(...rows);
}

// A library offered for adding: a check row (components/check.css), ticked when it is to be added.
function pickRow({id, name}, chosen) {
  const label = el("label", "switch-row");
  const input = el("input");
  input.type = "checkbox";
  input.checked = chosen.has(id);
  input.dataset.source = "pick-" + id;
  input.onchange = () => plexActions.tick(id, input.checked);
  label.append(el("span", "switch-row-label", name), input, el("span", "check"));
  return label;
}

// The Plex section, as a server is listed in Infuse or Apple TV: a heading naming the server with its actions, and
// the libraries added from it as switch rows. Before connecting: Connect. After sign-in, for accounts with several
// servers: a server choice. Then, and on Edit: the server's film libraries to tick, with Cancel and Save.
function renderPlex() {
  const plex = plexConnection();
  const asking = plexActions.choosing?.();
  const focused = focusedSource($("plexRows"));
  const rows = [];
  let actions;
  let label = "Plex";
  if (asking?.servers) {
    actions = [link("Cancel", () => plexActions.cancel())];
    const field = el("label", "switch-row");
    const select = el("select", "select");
    select.append(new Option("Choose a server", ""), ...asking.servers.map(item => new Option(item.name, item.id)));
    select.onchange = () => plexActions.chooseServer(select.value);
    field.append(el("span", "switch-row-label", "Server"), select);
    rows.push(field);
  } else if (asking?.picking) {
    const {name, libraries, chosen} = asking.picking;
    label = "Plex · " + name;
    const save = el("button", "button button--primary", "Save");
    save.type = "button";
    save.disabled = !chosen.size;
    save.onclick = () => plexActions.save();
    actions = [link("Cancel", () => plexActions.cancel()), save];
    rows.push(el("p", "programming-note", "Choose the libraries to add."), ...libraries.map(l => pickRow(l, chosen)));
  } else if (plex) {
    label = "Plex · " + plex.server;
    actions = [link("Edit", () => plexActions.edit()), link("Remove", () => plexActions.remove())];
    for (const key of plex.libraries) {
      if (SOURCES[key]) {
        rows.push(...libraryRow(key, SOURCES[key], focused));
      }
    }
  } else {
    actions = [link("Connect", () => plexActions.connect())];
    rows.push(el("p", "programming-note", "Add the films from your own Plex libraries."));
  }
  $("plexLabel").textContent = label;
  $("plexActions").replaceChildren(...actions);
  $("plexRows").replaceChildren(...rows);
  if (focused?.startsWith("pick-")) {
    $("plexRows").querySelector(`[data-source="${focused}"]`)?.focus({preventScroll: true});
  }
}

// Redraws the Plex section, animating its height when opening (true) or closing (false) is given.
export function redrawPlex(opening) {
  if (opening === undefined) {
    renderPlex();
  } else {
    resize($("plexRows"), renderPlex, opening);
  }
}

function changed() {
  savePrefs();
  notice();
  sourcesChanged();
}

// The decade range in a few characters: 1960s–1990s, 1960s+ when the end is open, Up to 1990s when the start is.
function decadeRange() {
  const from = pref("decadeFrom");
  const to = pref("decadeTo");
  if (from && to) {
    return from === to ? from + "s" : from + "s–" + to + "s";
  }
  return from ? from + "s+" : to ? "Up to " + to + "s" : "";
}

// The first two chosen genres by name, the rest as a count, so the line stays one line.
function genreList() {
  const genres = pref("genres");
  return genres.slice(0, 2).join(", ") + (genres.length > 2 ? " +" + (genres.length - 2) : "");
}

// One line under Up next that says what is applied; it opens the Programming sheet.
function summary() {
  const on = Object.entries(SOURCES).filter(([key]) => sourceEnabled(key));
  const sources = on.length === Object.keys(SOURCES).length ? "All sources" :
    on.length ? [...new Set(on.map(([, s]) => s.short || s.name))].join(", ") : "No sources";
  return [
    sources,
    decadeRange(),
    genreList(),
    pref("maxRating") ? "Up to " + pref("maxRating") : "",
    pref("includeUnrated") ? "" : "No unrated"
  ].filter(Boolean).join(" · ");
}

export function renderProgramming() {
  renderSources();
  renderPlex();
  const loaded = Object.keys(SOURCES).every(isLoaded);
  const count = allFilms().filter(f => enabled(f) && !hidden(f)).length;
  $("programmingCount").textContent = loaded ? count.toLocaleString() + (count === 1 ? " film" : " films") : "";
  $("programmingSummary").textContent = summary();
}

// notice(message) writes the status line under the player. plex: the Plex logic from plex.js, which this module draws.
export function initProgramming(showNotice, plex) {
  notice = showNotice;
  plexActions = plex;
}
