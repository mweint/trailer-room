// Sources: source switches with counts, failure status and retry, the rating filter and the collapse toggle.
import {$, el} from "../dom.js";
import {refreshSource} from "../api.js";
import {SOURCES, US_RATINGS} from "../catalog.js";
import {allFilms, fitsRating, isLoaded, statusOf, syncCollections} from "../library.js";
import {pref, setPref, sourceEnabled, setSourceEnabled, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";

let notice = () => {};

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

export function renderSources() {
  const focused = $("sources").contains(document.activeElement) ? document.activeElement.dataset.source : null;
  $("sources").replaceChildren();
  for (const [key, {name, logo: file}] of Object.entries(SOURCES)) {
    const label = el("label", "source");
    const input = el("input");
    const text = el("span", "source-details");
    const total = allFilms().filter(f => f.sources.includes(key) && fitsRating(f)).length;
    const count = isLoaded(key) ? total.toLocaleString() + (total === 1 ? " film" : " films") : "Loading…";
    text.append(el("span", "source-name", name), el("span", "count", count));
    input.type = "checkbox";
    input.checked = !!sourceEnabled(key);
    input.dataset.source = key;
    input.setAttribute("aria-label", name);
    input.onchange = () => {
      setSourceEnabled(key, input.checked);
      savePrefs();
      sourcesChanged();
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

function showSourceOptions() {
  $("sourceOptions").hidden = pref("sourcesCollapsed");
  $("sourcesToggle").setAttribute("aria-expanded", String(!pref("sourcesCollapsed")));
}

// notice(message) writes the status line under the player.
export function initSources(showNotice) {
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
    savePrefs();
    notice();
    sourcesChanged();
  };
  $("includeUnrated").onchange = () => {
    setPref("includeUnrated", $("includeUnrated").checked);
    savePrefs();
    notice();
    sourcesChanged();
  };
  showSourceOptions();
  $("sourcesToggle").onclick = () => {
    setPref("sourcesCollapsed", !pref("sourcesCollapsed"));
    showSourceOptions();
    savePrefs();
  };
}
