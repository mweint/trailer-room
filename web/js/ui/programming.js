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

// The Plex section, as a server is listed in Infuse or Apple TV: a heading naming the server with its action, and
// every film library on it as a switch row. Before connecting: Connect. After sign-in, only for accounts with
// several servers: a server choice and Cancel.
function renderPlex() {
  const plex = plexConnection();
  const servers = plexActions.choosing?.();
  const focused = focusedSource($("plexRows"));
  const rows = [];
  let action;
  if (servers) {
    action = link("Cancel", () => plexActions.cancel());
    const field = el("label", "switch-row");
    const select = el("select", "select");
    select.append(new Option("Choose a server", ""), ...servers.map(item => new Option(item.name, item.id)));
    select.onchange = () => plexActions.chooseServer(select.value);
    field.append(el("span", "switch-row-label", "Server"), select);
    rows.push(field);
  } else if (plex) {
    action = link("Remove", () => plexActions.remove());
    for (const key of plex.libraries) {
      if (SOURCES[key]) {
        rows.push(...libraryRow(key, SOURCES[key], focused));
      }
    }
  } else {
    action = link("Connect", () => plexActions.connect());
    rows.push(el("p", "programming-note", "Add the films from your own Plex libraries."));
  }
  $("plexLabel").textContent = plex && !servers ? "Plex · " + plex.server : "Plex";
  $("plexActions").replaceChildren(action);
  $("plexRows").replaceChildren(...rows);
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

// One line under Up next that says what is applied; it opens the Programming sheet.
function summary() {
  const on = Object.entries(SOURCES).filter(([key]) => sourceEnabled(key));
  const sources = on.length === Object.keys(SOURCES).length ? "All sources" :
    on.length ? [...new Set(on.map(([, s]) => s.short || s.name))].join(", ") : "No sources";
  return [
    sources,
    pref("decades").slice().sort().map(d => d + "s").join(", "),
    pref("genres").join(", "),
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
