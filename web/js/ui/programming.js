// Programming: what goes into the rotation. Source switches with counts, failure status and retry;
// decade and genre chips; the rating filter; the live film count, the summary under Up next and Clear filters.
import {$, el, expand, reveal} from "../dom.js";
import {refreshSource} from "../api.js";
import {SOURCES, US_RATINGS, decadeOf, tally} from "../catalog.js";
import {allFilms, enabled, fitsFilters, genresOf, hidden, isLoaded, statusOf, syncCollections} from "../library.js";
import {pref, setPref, sourceEnabled, setSourceEnabled, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";

// Genres shown before the "+N" chip; the rest open below it.
const FIRST_GENRES = 6;

let notice = () => {};
let moreGenres = false;

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
    label.append(logo, text, input, el("span", "switch"));
    $("sources").append(label);
    const state = statusOf(key);
    if (state?.error) {
      $("sources").append(failureNote(key, state));
    }
    if (focused === key) {
      input.focus({preventScroll: true});
    }
  }
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
  // Chosen genres stay in the first row so a selection is never hidden behind "+N".
  const first = genres.filter((g, i) => i < FIRST_GENRES || pref("genres").includes(g));
  const rest = genres.filter(g => !first.includes(g));
  const chips = [chip("Any", "genres", null), ...first.map(g => chip(g, "genres", g))];
  if (rest.length) {
    const toggle = el("button", "chip", moreGenres ? "Fewer" : "+" + rest.length);
    const more = el("div", "collapse chips-more");
    const row = el("div", "chips");
    toggle.type = "button";
    toggle.dataset.chip = "genres:more";
    toggle.setAttribute("aria-controls", "moreGenres");
    more.id = "moreGenres";
    row.append(...rest.map(g => chip(g, "genres", g)));
    more.append(row);
    toggle.onclick = () => {
      moreGenres = !moreGenres;
      toggle.textContent = moreGenres ? "Fewer" : "+" + rest.length;
      expand(toggle, moreGenres);
    };
    chips.push(toggle, more);
    renderChips($("genres"), chips);
    expand(toggle, moreGenres, false);
  } else {
    renderChips($("genres"), chips);
  }
  if (!genres.length) {
    $("genres").append(el("span", "programming-note", "Genres are still being collected."));
  }
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

// notice(message) writes the status line under the player.
export function initProgramming(showNotice) {
  notice = showNotice;
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
