// Preferences kept in localStorage under "trailer-room.v1": load, defaults, access and save.
import {US_RATINGS} from "./catalog.js";

const STORE = "trailer-room.v1";

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(STORE)) || {};
} catch {}
const savedRating = US_RATINGS.includes(saved.maxRating) ? saved.maxRating : "";

const prefs = {
  enabled: {criterion: true, a24: true, neon: true, janus: true, ...saved.enabled},
  maxRating: savedRating,
  includeUnrated: typeof saved.includeUnrated === "boolean" ? saved.includeUnrated : !savedRating,
  sourcesCollapsed: !!saved.sourcesCollapsed,
  hidden: saved.hidden || [],
  skipped: saved.skipped || [],
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
