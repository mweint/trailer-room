// Programming: what goes into the rotation. Source switches with counts, failure status and retry;
// decade and genre chips; the rating filter; the live film count, the summary under Up next and Clear filters.
import {$, el, resize, reveal} from "../dom.js";
import {refreshSource} from "../api.js";
import {SOURCES, US_RATINGS, decadeOf, tally} from "../catalog.js";
import {allFilms, enabled, fitsFilters, genreStatus, genresCollecting, genresOf, hidden, isLoaded, statusOf, syncCollections} from "../library.js";
import {pref, setPref, sourceEnabled, setSourceEnabled, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";

// Genres shown before the "+N" chip; the rest continue in the same flow when it is pressed.
const FIRST_GENRES = 6;

let notice = () => {};
let moreGenres = false;
let plexActions = {};

function failureNote(key, state) {
  const date = stamp => new Date(stamp * 1000).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"});
  const note = el("div", "source-update source-issue");
  note.append(document.createTextNode(
    (state.updated ? "Stale list from " + date(state.updated) : "No saved list") +
    ". Failed " + date(state.attempted) + ": " + state.error + " "));
  const retry = el("button", "button button--link", state.refreshing ? "Retrying…" : "Retry");
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

function renderSources() {
  const focused = $("sources").contains(document.activeElement) ? document.activeElement.dataset.source : null;
  $("sources").replaceChildren();
  for (const [key, {name, logo: file}] of Object.entries(SOURCES)) {
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
    const logo = el("img", "source-logo " + key);
    logo.alt = "";
    logo.src = "/logos/" + file;
    label.append(logo, text);
    if (key === "plex") {
      label.append(plexMenu());
    }
    label.append(input, el("span", "switch"));
    $("sources").append(label);
    const state = statusOf(key);
    if (state?.error) {
      $("sources").append(failureNote(key, state));
    }
    if (focused === key) {
      input.focus({preventScroll: true});
    }
  }
  if (!SOURCES.plex) {
    const add = el("button", "button button--flush source-add", "+ Connect Plex");
    add.type = "button";
    add.onclick = () => plexActions.connectPlex();
    $("sources").append(add);
  }
}

// The Plex row's options: the library is managed where it is listed.
function plexMenu() {
  const menu = el("details", "menu source-menu");
  const toggle = el("summary", "menu-toggle");
  const list = el("div", "menu-list");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("class", "menu-toggle-icon");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  for (const x of [5, 12, 19]) {
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", x);
    dot.setAttribute("cy", 12);
    dot.setAttribute("r", 1.7);
    icon.append(dot);
  }
  toggle.append(icon);
  toggle.setAttribute("aria-label", "Plex library options");
  toggle.title = "Plex library options";
  const change = el("button", "button menu-item", "Change library");
  const remove = el("button", "button menu-item", "Remove library");
  change.type = remove.type = "button";
  change.onclick = () => {
    menu.open = false;
    plexActions.connectPlex();
  };
  remove.onclick = () => {
    menu.open = false;
    plexActions.removePlex();
  };
  list.append(change, remove);
  menu.append(toggle, list);
  return menu;
}

function changed() {
  savePrefs();
  notice();
  sourcesChanged();
}

// A chip toggles one value in a list preference. "Any" (value null) clears the list.
function chip(label, list, value) {
  const button = el("button", "chip", label);
  const chosen = pref(list);
  button.type = "button";
  button.dataset.chip = list + ":" + value;
  button.setAttribute("aria-pressed", String(value === null ? !chosen.length : chosen.includes(value)));
  button.onclick = () => {
    setPref(list, value === null ? [] : chosen.includes(value) ? chosen.filter(v => v !== value) : [...chosen, value]);
    changed();
  };
  return button;
}

// Rebuilds a chip group, keeping keyboard focus on the same chip.
function renderChips(group, chips) {
  const focused = group.contains(document.activeElement) ? document.activeElement.dataset.chip : null;
  group.replaceChildren(...chips);
  if (focused) {
    group.querySelector(`[data-chip="${CSS.escape(focused)}"]`)?.focus({preventScroll: true});
  }
}

// Options come from the films of the switched-on sources, so every chip can match something.
function inSources() {
  return allFilms().filter(f => f.sources.some(s => sourceEnabled(s)));
}

function renderDecades(films) {
  const decades = [...new Set([...films.map(decadeOf), ...pref("decades")])].filter(Boolean).sort((a, b) => a - b);
  renderChips($("decades"), [chip("Any", "decades", null), ...decades.map(d => chip(d + "s", "decades", d))]);
}

function renderGenres(films) {
  const genres = tally(films.flatMap(genresOf));
  for (const genre of pref("genres")) {
    if (!genres.includes(genre)) {
      genres.push(genre);
    }
  }
  // The less common genres continue in the same flow when shown; the toggle is always the last chip.
  // Chosen genres always show, so a selection is never hidden.
  const shown = genres.filter((g, i) => moreGenres || i < FIRST_GENRES || pref("genres").includes(g));
  const extra = genres.length - genres.filter((g, i) => i < FIRST_GENRES || pref("genres").includes(g)).length;
  const chips = [chip("Any", "genres", null), ...shown.map(g => chip(g, "genres", g))];
  if (extra) {
    const toggle = el("button", "chip", moreGenres ? "Show fewer" : "+" + extra);
    toggle.type = "button";
    toggle.dataset.chip = "genres:more";
    toggle.setAttribute("aria-expanded", String(moreGenres));
    toggle.onclick = () => {
      resize($("genres"), () => {
        moreGenres = !moreGenres;
        renderGenres(inSources());
      }, !moreGenres);
    };
    chips.push(toggle);
  }
  renderChips($("genres"), chips);
  const status = genreStatus();
  $("genreStatus").textContent = genresCollecting() ?
    "Still collecting · " + status.done.toLocaleString() + " of " + status.total.toLocaleString() + " films" : "";
}

function filtersActive() {
  return pref("decades").length || pref("genres").length || pref("maxRating") || !pref("includeUnrated");
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
  const films = inSources();
  renderDecades(films);
  renderGenres(films);
  const loaded = Object.keys(SOURCES).every(isLoaded);
  const count = allFilms().filter(f => enabled(f) && !hidden(f)).length;
  $("programmingCount").textContent = loaded ? count.toLocaleString() + (count === 1 ? " film" : " films") : "";
  $("programmingSummary").textContent = summary();
  reveal($("programmingEmpty"), loaded && !count && !!filtersActive());
}

// notice(message) writes the status line under the player. plex: {connectPlex(), removePlex()} from plex.js.
export function initProgramming(showNotice, plex) {
  notice = showNotice;
  plexActions = plex;
  // An open Plex menu closes on a click anywhere else.
  document.addEventListener("click", event => {
    const menu = $("sources").querySelector(".source-menu[open]");
    if (menu && !menu.contains(event.target)) {
      menu.open = false;
    }
  });
  for (const rating of US_RATINGS) {
    $("maxRating").add(new Option(rating, rating));
  }
  $("maxRating").value = pref("maxRating");
  $("includeUnrated").checked = pref("includeUnrated");
  $("maxRating").onchange = () => {
    setPref("maxRating", $("maxRating").value);
    setPref("includeUnrated", !pref("maxRating"));
    $("includeUnrated").checked = pref("includeUnrated");
    changed();
  };
  $("includeUnrated").onchange = () => {
    setPref("includeUnrated", $("includeUnrated").checked);
    changed();
  };
  $("clearFilters").onclick = () => {
    setPref("decades", []);
    setPref("genres", []);
    setPref("maxRating", "");
    setPref("includeUnrated", true);
    $("maxRating").value = "";
    $("includeUnrated").checked = true;
    changed();
  };
}
