// Programming: what goes into the rotation. Source switches with counts, failure status and retry; the Plex group
// and its in-place editor; the live film count and the summary under Up next. The filters are in filters.js.
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

// One source: a label holding the logo, name, count and switch, so a click anywhere on it flips the switch.
// A label holds no other control, or it would hand its clicks to that control instead.
function sourceRow(key, {name, logo: file}, focused) {
  const label = el("label", "source");
  const input = el("input");
  const text = el("span", "source-details");
  const total = allFilms().filter(f => f.sources.includes(key) && fitsFilters(f)).length;
  const count = isLoaded(key) ? total.toLocaleString() + (total === 1 ? " film" : " films") : "Loading…";
  text.append(el("span", "source-name", name), el("span", "count", count));
  input.type = "checkbox";
  input.checked = !!sourceEnabled(key);
  input.dataset.source = key;
  input.setAttribute("aria-label", name);
  input.onchange = () => {
    setSourceEnabled(key, input.checked);
    changed();
  };
  const logo = el("img", "source-logo " + (isPlex(key) ? "plex" : key));
  logo.alt = "";
  logo.src = "/logos/" + file;
  label.append(logo, text, input, el("span", "switch"));
  if (focused === key) {
    queueMicrotask(() => input.focus({preventScroll: true}));
  }
  const state = statusOf(key);
  return state?.error ? [label, failureNote(key, state)] : [label];
}

function link(text, action) {
  const button = el("button", "button button--text", text);
  button.type = "button";
  button.onclick = action;
  return button;
}

function plexHeading(name, ...actions) {
  const heading = el("div", "plex-heading");
  heading.append(el("span", "plex-heading-name", name), ...actions);
  return heading;
}

// Editing Plex happens in the group itself: its heading's actions become Cancel and Save, a server choice appears
// only when the account has several, and its rows list every library on the server with a switch.
function plexEditor(edit) {
  const save = link("Save", () => plexActions.save());
  save.className = "button button--primary";
  const anyOn = () => edit.libraries.some(item => item.on);
  save.disabled = !anyOn();
  const rows = [plexHeading("Plex" + (edit.serverName ? " · " + edit.serverName : ""),
    link("Cancel", () => plexActions.cancel()), save)];
  if (edit.servers?.length > 1) {
    const field = el("label", "plex-server");
    const select = el("select", "select");
    select.append(new Option("Choose a server", ""), ...edit.servers.map(item => new Option(item.name, item.id)));
    select.value = edit.server || "";
    select.onchange = () => plexActions.chooseServer(select.value);
    field.append(el("span", "", "Server"), select);
    rows.push(field);
  }
  for (const library of edit.libraries) {
    const label = el("label", "source");
    const input = el("input");
    input.type = "checkbox";
    input.checked = library.on;
    input.onchange = () => {
      plexActions.toggle(library.id, input.checked);
      save.disabled = !anyOn();
    };
    const logo = el("img", "source-logo plex");
    logo.alt = "";
    logo.src = "/logos/plex.svg";
    label.append(logo, el("span", "source-name", library.name), input, el("span", "switch"));
    rows.push(label);
  }
  if (!edit.servers) {
    rows.push(link("Use another server", () => plexActions.otherServer()));
    rows.at(-1).classList.add("button--flush", "plex-other");
  }
  return rows;
}

// Curated sources first, then Plex as its own small group: the server is managed from the group's heading
// and each library below it is an ordinary source row.
function renderSources() {
  const focused = $("sources").contains(document.activeElement) ? document.activeElement.dataset.source : null;
  const rows = [];
  for (const [key, source] of Object.entries(SOURCES)) {
    if (!isPlex(key)) {
      rows.push(...sourceRow(key, source, focused));
    }
  }
  const plex = plexConnection();
  const edit = plexActions.editing?.();
  if (edit) {
    rows.push(...plexEditor(edit));
  } else if (plex) {
    rows.push(plexHeading("Plex · " + plex.server,
      link("Change", () => plexActions.change()), link("Remove", () => plexActions.remove())));
    for (const key of plex.libraries) {
      if (SOURCES[key]) {
        rows.push(...sourceRow(key, SOURCES[key], focused));
      }
    }
  } else {
    const add = el("button", "button button--flush source-add", "Connect Plex");
    add.type = "button";
    add.onclick = () => plexActions.change();
    rows.push(add);
  }
  $("sources").replaceChildren(...rows);
}

// Redraws the sources, animating the list's height when opening (true) or closing (false) is given.
export function redrawSources(opening) {
  if (opening === undefined) {
    renderSources();
  } else {
    resize($("sources"), renderSources, opening);
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
    on.length ? on.map(([, s]) => s.short || s.name).join(", ") : "No sources";
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
