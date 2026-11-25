// The loaded library: source catalogs, merged films, source status, film detail cache and polling. No DOM.
import {fetchCollections, fetchFilm} from "./api.js";
import {SOURCES, addSource, removeSource, mergeSources, withinRating} from "./catalog.js";
import {pref, sourceEnabled, enableSourceByDefault} from "./prefs.js";

const catalogs = {};
const details = new Map();
const loaded = new Set();
let films = [];
let sourceStatus = {};
let pollTimer;
let syncVersion = 0;
let hooks;

// hooks: plexStatus(source), changed(), unchanged(), notice(message)
export function onSync(syncHooks) {
  hooks = syncHooks;
}

export function allFilms() {
  return films;
}

export function remerge() {
  films = mergeSources(catalogs);
  return films;
}

export function isLoaded(source) {
  return loaded.has(source);
}

export function statusOf(source) {
  return sourceStatus[source];
}

export function anySourceEnabled() {
  return Object.keys(SOURCES).some(s => sourceEnabled(s));
}

export function sourcesPending() {
  return Object.keys(SOURCES).some(s => sourceEnabled(s) && !loaded.has(s));
}

export function detail(film) {
  if (!details.has(film.key)) {
    details.set(film.key, fetchFilm(film.key).catch(e => {
      details.delete(film.key);
      throw e;
    }));
  }
  return details.get(film.key);
}

export function fitsRating(film) {
  return withinRating(film, pref("maxRating"), pref("includeUnrated"));
}

export function enabled(film) {
  return film.sources.some(s => sourceEnabled(s)) && fitsRating(film);
}

export function hidden(film) {
  return pref("hidden").some(h => h.keys.some(key => film.keys.includes(key)));
}

export async function syncCollections(force = false) {
  const version = ++syncVersion;
  clearTimeout(pollTimer);
  try {
    const data = await fetchCollections();
    if (version !== syncVersion) {
      return;
    }
    const changed = force || JSON.stringify(sourceStatus) !== JSON.stringify(data.sources);
    if (data.sources.plex) {
      addSource("plex", {
        name: "Plex · " + data.sources.plex.name,
        short: data.sources.plex.name,
        logo: "plex.svg"
      });
      enableSourceByDefault("plex");
    } else {
      removeSource("plex");
      delete catalogs.plex;
      loaded.delete("plex");
    }
    hooks.plexStatus(data.sources.plex);
    sourceStatus = data.sources;
    Object.assign(catalogs, data.catalogs);
    for (const [key, state] of Object.entries(sourceStatus)) {
      if (state.updated || state.error) {
        loaded.add(key);
      }
    }
    if (changed) {
      hooks.changed();
    } else {
      hooks.unchanged();
    }
    if (Object.values(sourceStatus).some(state => state.refreshing)) {
      pollTimer = setTimeout(syncCollections, 2500);
    }
  } catch {
    if (version !== syncVersion) {
      return;
    }
    hooks.notice("Could not reach the local catalog service. Retrying shortly.");
    pollTimer = setTimeout(syncCollections, 15000);
  }
}
