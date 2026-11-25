export const SOURCES = {
  a24: {name: "A24", logo: "a24.svg"},
  criterion: {name: "Criterion Collection", short: "Criterion", logo: "criterion.png"},
  janus: {name: "Janus Films", logo: "janus.png"},
  neon: {name: "NEON", logo: "neon.svg"}
};

export const US_RATINGS = ["G", "PG", "PG-13", "R", "NC-17"];

export function withinRating(film, maximum) {
  const rank = US_RATINGS.indexOf(film.certification);
  return !maximum || (rank >= 0 && rank <= US_RATINGS.indexOf(maximum));
}

export function mergeSources(catalogs) {
  const records = Object.entries(catalogs).flatMap(([source, rows]) => rows.map(row => ({...row, source})));
  const idsByAlias = new Map();
  for (const row of records) {
    if (!row.imdb) continue;
    if (!idsByAlias.has(row.alias)) idsByAlias.set(row.alias, new Set());
    idsByAlias.get(row.alias).add(row.imdb);
  }
  const merged = new Map();
  for (const row of records) {
    const ids = idsByAlias.get(row.alias);
    const id = row.imdb || (ids?.size === 1 ? [...ids][0] : row.key);
    let film = merged.get(id);
    if (!film) {
      film = {...row, id, keys: [id], sources: []};
      merged.set(id, film);
    }
    // A title and year are a useful fallback unless multiple identified films share them.
    if ((!ids || ids.size === 1) && !film.keys.includes(row.alias)) film.keys.push(row.alias);
    if (!film.sources.includes(row.source)) film.sources.push(row.source);
    if (row.key === id) film.key = id;
    film.imdb ||= row.imdb;
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
