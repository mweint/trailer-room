// Preferences kept in localStorage under "trailer-room.v1": load, defaults, access and save.
import {US_RATINGS} from "./catalog.js";

const STORE = "trailer-room.v1";

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(STORE)) || {};
} catch {}
const savedRating = US_RATINGS.includes(saved.maxRating) ? saved.maxRating : "";
// Decades used to be a list of single decades; a saved list becomes the range that spans it.
const savedDecades = Array.isArray(saved.decades) ? saved.decades.filter(Number.isInteger) : [];
// A clip that failed permanently is left out for 30 days, then tried again, so a wrong entry heals itself.
const DEAD_FOR = 30 * 24 * 60 * 60 * 1000;
const savedDead = Array.isArray(saved.dead) ? saved.dead.filter(d => Date.now() - d?.at < DEAD_FOR) : [];

function savedDecade(value, spanEnd) {
  return Number.isInteger(value) ? value : savedDecades.length ? spanEnd(...savedDecades) : null;
}

const prefs = {
  enabled: {criterion: true, a24: true, neon: true, janus: true, ...saved.enabled},
  maxRating: savedRating,
  includeUnrated: typeof saved.includeUnrated === "boolean" ? saved.includeUnrated : !savedRating,
  decadeFrom: savedDecade(saved.decadeFrom, Math.min),
  decadeTo: savedDecade(saved.decadeTo, Math.max),
  genres: Array.isArray(saved.genres) ? saved.genres.filter(g => typeof g === "string") : [],
  sourcesCollapsed: !!saved.sourcesCollapsed,
  hidden: saved.hidden || [],
  skipped: saved.skipped || [],
  dead: savedDead,
  crt: !!saved.crt,
  wide: !!saved.wide,
  volume: saved.volume ?? null,
  muted: !!saved.muted
};

let storageFailed = () => {};

export function onStorageFailure(report) {
  storageFailed = report;
}

export function pref(name) {
  return prefs[name];
}

export function setPref(name, value) {
  prefs[name] = value;
}

export function sourceEnabled(source) {
  return prefs.enabled[source];
}

export function setSourceEnabled(source, on) {
  prefs.enabled[source] = on;
}

// A source that appears at runtime starts enabled unless the viewer already chose.
export function enableSourceByDefault(source) {
  prefs.enabled[source] ??= true;
}

// list is "hidden" or "skipped".
export function addToList(list, item) {
  prefs[list].push(item);
}

export function removeFromList(list, item) {
  prefs[list] = prefs[list].filter(x => x !== item);
}

export function savePrefs() {
  try {
    localStorage.setItem(STORE, JSON.stringify(prefs));
  } catch {
    storageFailed("Browser storage is unavailable. Your preferences will last for this visit.");
  }
}
