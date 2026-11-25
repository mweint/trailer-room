// Queue order for one round: shuffle scores, what has been seen, and what cannot be played. No DOM.
import {matches} from "../catalog.js";
import {allFilms, enabled, hidden} from "../library.js";
import {pref} from "../prefs.js";

const scores = new Map();
const unavailable = new Set();
const broken = new Set();
const seenFilms = new Set();
const seenVideos = new Set();
let queue = [];
let lastPlayed = "";

export const videoKey = v => v.provider + "/" + v.id;

export function queued() {
  return queue;
}

export function takeNext() {
  return queue.shift();
}

// Rebuilds the queue around the current film and returns every eligible film.
export function rebuildQueue(current) {
  const eligible = allFilms().filter(f => enabled(f) && !hidden(f) && !matches(f, unavailable));
  for (const film of eligible) {
    if (!scores.has(film.id)) {
      scores.set(film.id, Math.random());
    }
  }
  queue = eligible
    .filter(f => !matches(f, seenFilms) && f.id !== current?.id)
    .sort((a, b) => scores.get(a.id) - scores.get(b.id));
  return eligible;
}

export function canRestart(eligible) {
  return !!eligible.length && !!seenFilms.size;
}

export function clearRound() {
  seenFilms.clear();
  seenVideos.clear();
  scores.clear();
}

// Do not open a new round with the film that closed the last one.
export function avoidRepeat() {
  if (queue.length > 1 && queue[0].id === lastPlayed) {
    queue.push(queue.shift());
  }
}

export function playableClips(data) {
  return data.videos.filter(v => !broken.has(videoKey(v)) && !seenVideos.has(videoKey(v)) &&
    !pref("skipped").some(s => s.video === videoKey(v)));
}

export function hasSeenFilms() {
  return seenFilms.size > 0;
}

export function isSeen(film) {
  return matches(film, seenFilms);
}

export function markSeen(film) {
  film.keys.forEach(key => seenFilms.add(key));
}

export function isUnavailable(film) {
  return matches(film, unavailable);
}

export function markUnavailable(film) {
  film.keys.forEach(key => unavailable.add(key));
}

export function forgetUnavailable() {
  unavailable.clear();
}

export function anyClipSeen(data) {
  return data.videos.some(v => seenVideos.has(videoKey(v)));
}

export function markClipSeen(clip) {
  seenVideos.add(videoKey(clip));
}

export function markClipBroken(clip) {
  broken.add(videoKey(clip));
}

export function notePlayed(film) {
  lastPlayed = film.id;
}

// A retry after a pause starts from a clean slate.
export function forgetEverything() {
  unavailable.clear();
  broken.clear();
  seenFilms.clear();
  seenVideos.clear();
}
