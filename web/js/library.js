// The loaded library: source catalogs, merged films, source status, film detail cache and polling. No DOM.
import {fetchCollections, fetchFilm} from "./api.js";
import {SOURCES, addSource, removeSource, isPlex, mergeSources, withinRating, withinDecades, withinGenres} from "./catalog.js";
import {pref, sourceEnabled, enableSourceByDefault} from "./prefs.js";

const catalogs = {};
const details = new Map();
const loaded = new Set();
let films = [];
let sourceStatus = {};
let genres = {};
let genreProgress = null;
let plex = null;
let pollTimer;
let syncVersion = 0;
let hooks;

// hooks: plexStatus({server, connection, libraries} or null), changed(), unchanged(), notice(message)
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

// The connected Plex server: {server, connection, libraries: ["plex-<key>", ...]}, or null.
export function plexConnection() {
  return plex;
}

// The server's genre pass: {done, total} films checked, or null when the server does not say.
export function genreStatus() {
  return genreProgress;
}

export function genresCollecting() {
  return !!genreProgress && genreProgress.done < genreProgress.total;
}

// Genres arrive from the server's background pass, keyed by film key; films without one yet have none.
export function genresOf(film) {
  return genres[film.id] || genres[film.key] || [];
}

// The programming filters other than sources: rating, decade and genre.
export function fitsFilters(film) {
  return withinRating(film, pref("maxRating"), pref("includeUnrated")) &&
    withinDecades(film, pref("decades")) && withinGenres(genresOf(film), pref("genres"));
}

export function enabled(film) {
  return film.sources.some(s => sourceEnabled(s)) && fitsFilters(film);
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
    const genreCount = Object.keys(data.genres || {}).length;
    const changed = force || JSON.stringify(sourceStatus) !== JSON.stringify(data.sources) ||
      genreCount !== Object.keys(genres).length;
    genres = data.genres || {};
    genreProgress = data.genreProgress || null;
    // Each connected Plex library is its own source, "plex-<key>"; the rest go when they are disconnected.
    const plexLibraries = data.plex?.libraries || [];
    for (const key of Object.keys(SOURCES)) {
      if (isPlex(key) && !plexLibraries.includes(key)) {
        removeSource(key);
        delete catalogs[key];
        loaded.delete(key);
      }
    }
    for (const key of plexLibraries) {
      addSource(key, {name: data.sources[key].name, short: "Plex", logo: "plex.svg"});
      enableSourceByDefault(key);
    }
    plex = data.plex || null;
    hooks.plexStatus(plex);
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
    } else if (genresCollecting()) {
      pollTimer = setTimeout(syncCollections, 15000);
    }
  } catch {
    if (version !== syncVersion) {
      return;
    }
    hooks.notice("Could not reach the local catalog service. Retrying shortly.");
    pollTimer = setTimeout(syncCollections, 15000);
  }
}
