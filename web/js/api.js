// Fetch helpers for the local /api/* endpoints.
export async function json(url) {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error("Service unavailable");
  }
  return r.json();
}

export function fetchCollections() {
  return json("/api/collections");
}

export function fetchFilm(key) {
  return json("/api/film/" + encodeURIComponent(key));
}

export async function refreshSource(key) {
  const result = await fetch("/api/refresh/" + key, {
    method: "POST",
    headers: {"Content-Type": "application/json"}
  });
  if (!result.ok) {
    throw Error();
  }
}

export async function plexCall(action, body = {}) {
  const response = await fetch("/api/plex/" + action, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "Couldn’t reach Plex.");
  }
  return result;
}
