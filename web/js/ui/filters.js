// Filters in Programming: the decade range, genre chips, the rating filter, the genre collection progress, and the
// no-match note with Clear filters.
import {$, el, resize, reveal} from "../dom.js";
import {SOURCES, US_RATINGS, decadeOf, tally} from "../catalog.js";
import {allFilms, enabled, genreStatus, genresCollecting, genresOf, hidden, isLoaded} from "../library.js";
import {pref, setPref, sourceEnabled, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";

// Genres shown before the "+N" chip; the rest continue in the same flow when it is pressed.
const FIRST_GENRES = 6;

let notice = () => {};
let moreGenres = false;

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

// Every decade from the earliest to the latest among the films, widened to take in the chosen range.
function decadeSpan(films) {
  const known = [...films.map(decadeOf), pref("decadeFrom"), pref("decadeTo")].filter(Boolean);
  const decades = [];
  for (let d = Math.min(...known); d <= Math.max(...known); d += 10) {
    decades.push(d);
  }
  return decades;
}

// Options are rebuilt only when they change, so a render never disturbs an open select.
function fillDecades(select, decades, value) {
  const key = decades.join();
  if (select.dataset.decades !== key) {
    select.dataset.decades = key;
    select.replaceChildren(...decades.map(d => new Option(d + "s", d)));
  }
  select.value = value;
  select.disabled = !decades.length;
}

// Each select offers only the decades that keep from at or before to. An end resting on the first or last
// decade is saved as null (open), so the range keeps taking in whatever lies beyond it.
function renderDecades(films) {
  const decades = decadeSpan(films);
  const from = pref("decadeFrom") ?? decades[0];
  const to = pref("decadeTo") ?? decades.at(-1);
  fillDecades($("decadeFrom"), decades.filter(d => d <= to), from);
  fillDecades($("decadeTo"), decades.filter(d => d >= from), to);
  $("decadeFrom").onchange = () => {
    const value = Number($("decadeFrom").value);
    setPref("decadeFrom", value === decades[0] ? null : value);
    changed();
  };
  $("decadeTo").onchange = () => {
    const value = Number($("decadeTo").value);
    setPref("decadeTo", value === decades.at(-1) ? null : value);
    changed();
  };
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
  return pref("decadeFrom") || pref("decadeTo") || pref("genres").length || pref("maxRating") || !pref("includeUnrated");
}

export function renderFilters() {
  const films = inSources();
  renderDecades(films);
  renderGenres(films);
  const loaded = Object.keys(SOURCES).every(isLoaded);
  const count = allFilms().filter(f => enabled(f) && !hidden(f)).length;
  reveal($("programmingEmpty"), loaded && !count && !!filtersActive());
}

// notice(message) writes the status line under the player.
export function initFilters(showNotice) {
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
    setPref("decadeFrom", null);
    setPref("decadeTo", null);
    setPref("genres", []);
    setPref("maxRating", "");
    setPref("includeUnrated", true);
    $("maxRating").value = "";
    $("includeUnrated").checked = true;
    changed();
  };
}
