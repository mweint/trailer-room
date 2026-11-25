// Film sources and the pure catalog logic: merging, ratings, matching, poster and link URLs. No DOM.
export const SOURCES = {
  a24: {name: "A24", logo: "a24.svg"},
  criterion: {name: "Criterion Collection", short: "Criterion", logo: "criterion.png"},
  janus: {name: "Janus Films", logo: "janus.png"},
  neon: {name: "NEON", logo: "neon.svg"}
};

// The Plex source exists only while a library is connected.
export function addSource(key, source) {
  SOURCES[key] = source;
}

export function removeSource(key) {
  delete SOURCES[key];
}

export const US_RATINGS = ["G", "PG", "PG-13", "R", "NC-17"];

export function sourceNames(film) {
  return film.sources.map(s => SOURCES[s].short || SOURCES[s].name).join(" / ");
}

export function withinRating(film, maximum, includeUnrated = !maximum) {
  const rank = US_RATINGS.indexOf(film.ratedCertification || film.certification);
  if (rank < 0) {
    return includeUnrated;
  }
  if (film.certification === "Unrated" && !includeUnrated) {
    return false;
  }
  return !maximum || rank <= US_RATINGS.indexOf(maximum);
}

// Programming filters. An empty choice means any.
export function decadeOf(film) {
  return Math.floor(Number(film.year) / 10) * 10;
}

export function withinDecades(film, decades) {
  return !decades.length || decades.includes(decadeOf(film));
}

// A film whose genres are not known yet does not match a genre choice.
export function withinGenres(genres, chosen) {
  return !chosen.length || genres.some(genre => chosen.includes(genre));
}

// Values present in a list of films, most common first (genres) or in order (decades).
export function tally(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value);
}

export function posterUrls(film) {
  const imdbPoster = film.imdb && "https://images.metahub.space/poster/small/" + film.imdb + "/img";
  let url;
  try {
    url = new URL(film.poster);
  } catch {
    return imdbPoster ? [imdbPoster] : [];
  }
  if (url.protocol !== "https:") {
    return imdbPoster ? [imdbPoster] : [];
  }
  if (url.hostname === "api-asset-production.s3.amazonaws.com") {
    const query = new URLSearchParams({url: url.href, w: 96, q: 75});
    return ["https://a24films.com/_next/image?" + query, imdbPoster].filter(Boolean);
  }
  if (url.hostname.endsWith(".datocms-assets.com")) {
    for (const [key, value] of Object.entries({w: 96, h: 144, fit: "crop", auto: "format", q: 70})) {
      url.searchParams.set(key, value);
    }
  }
  return [...new Set([url.href, imdbPoster].filter(Boolean))];
}

export function letterboxdLink(film, info) {
  const imdb = info?.imdb || film.imdb;
  const directPath = /^tt\d+$/.test(imdb) ? "imdb/" + imdb :
    /^\d+$/.test(film.tmdb) ? "tmdb/" + film.tmdb : "";
  const query = [film.title, film.year && "year:" + film.year].filter(Boolean).join(" ");
  return {
    href: "https://letterboxd.com/" + (directPath || "search/films/" + encodeURIComponent(query) + "/"),
    text: film.title,
    title: directPath ? "View on Letterboxd (new tab)" : "Search Letterboxd (new tab)"
  };
}

export function mergeSources(catalogs) {
  const records = Object.entries(catalogs).flatMap(([source, rows]) => rows.map(row => ({...row, source})));
  const idsByAlias = new Map();
  for (const row of records) {
    if (!row.imdb) {
      continue;
    }
    if (!idsByAlias.has(row.alias)) {
      idsByAlias.set(row.alias, new Set());
    }
    idsByAlias.get(row.alias).add(row.imdb);
  }
  const merged = new Map();
  for (const row of records) {
    if (/^(?:nr|ur|not rated|unrated)$/i.test((row.certification || "").trim())) {
      row.certification = "Unrated";
    }
    const ids = idsByAlias.get(row.alias);
    const id = row.imdb || (ids?.size === 1 ? [...ids][0] : row.key);
    let film = merged.get(id);
    if (!film) {
      film = {...row, id, keys: [id], sources: []};
      merged.set(id, film);
    }
    // A title and year are a useful fallback unless multiple identified films share them.
    if ((!ids || ids.size === 1) && !film.keys.includes(row.alias)) {
      film.keys.push(row.alias);
    }
    if (!film.sources.includes(row.source)) {
      film.sources.push(row.source);
    }
    if (row.key === id) {
      film.key = id;
    }
    film.imdb ||= row.imdb;
    if (US_RATINGS.indexOf(row.certification) > US_RATINGS.indexOf(film.ratedCertification)) {
      film.ratedCertification = row.certification;
    }
    if (row.certification === "Unrated" || (film.certification !== "Unrated" &&
        US_RATINGS.indexOf(row.certification) > US_RATINGS.indexOf(film.certification))) {
      film.certification = row.certification;
    }
  }
  return [...merged.values()];
}

export function matches(film, tokens) {
  return film.keys.some(key => tokens.has(key));
}
