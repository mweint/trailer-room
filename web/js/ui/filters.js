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
let decades = [];
let draggingDecade = false;

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
  const span = [];
  for (let d = Math.min(...known); d <= Math.max(...known); d += 10) {
    span.push(d);
  }
  return span;
}

// The two handles as positions in decades, lower first: the handles may cross while one is dragged.
function decadeEnds() {
  const a = $("decadeFrom").valueAsNumber;
  const b = $("decadeTo").valueAsNumber;
  return [Math.min(a, b), Math.max(a, b)];
}

// Lights the track between the handles and writes the chosen range beside the group's label.
function paintDecades() {
  const [low, high] = decadeEnds();
  const last = Math.max(decades.length - 1, 1);
  $("decades").style.setProperty("--span-start", low / last);
  $("decades").style.setProperty("--span-end", high / last);
  $("decadeValue").textContent = !decades.length ? "" :
    low === high ? decades[low] + "s" : decades[low] + "s\u2013" + decades[high] + "s";
  for (const input of [$("decadeFrom"), $("decadeTo")]) {
    input.setAttribute("aria-valuetext", decades.length ? decades[input.valueAsNumber] + "s" : "");
  }
}

// A handle resting on the first or last decade is saved as null (open), so the range keeps taking in whatever
// lies beyond it. A handle being dragged is left alone.
function renderDecades(films) {
  if (draggingDecade) {
    return;
  }
  decades = decadeSpan(films);
  const last = decades.length - 1;
  const ends = [[$("decadeFrom"), pref("decadeFrom"), 0], [$("decadeTo"), pref("decadeTo"), last]];
  for (const [input, decade, open] of ends) {
    input.max = Math.max(last, 0);
    input.value = decade === null ? open : decades.indexOf(decade);
    input.disabled = last < 1;
  }
  paintDecades();
}

// While a handle moves only the track and the label follow; the choice is applied when it is let go. If the
// handles crossed, they trade places then, so each keeps its name (earliest, latest), and focus stays with the
// handle that was moved.
function initDecades() {
  const inputs = [$("decadeFrom"), $("decadeTo")];
  for (const input of inputs) {
    input.oninput = () => {
      draggingDecade = true;
      paintDecades();
    };
    input.onchange = () => {
      draggingDecade = false;
      const [low, high] = decadeEnds();
      if (inputs[0].valueAsNumber > inputs[1].valueAsNumber) {
        inputs[0].value = low;
        inputs[1].value = high;
        inputs.find(other => other !== input).focus({preventScroll: true});
      }
      setPref("decadeFrom", low === 0 ? null : decades[low]);
      setPref("decadeTo", high === decades.length - 1 ? null : decades[high]);
      changed();
    };
  }
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
  initDecades();
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
