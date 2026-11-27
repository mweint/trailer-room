// Queue order, shuffled the way music players settled on: each round deals every eligible film once in a random
// order, then the next round is dealt afresh, never opening with the film that closed the last. The next round is
// dealt in advance, so Up next continues past the end of this one. Also what has been seen and cannot play. No DOM.
import {matches} from "../catalog.js";
import {allFilms, enabled, hidden} from "../library.js";
import {pref, addToList, savePrefs} from "../prefs.js";

const scores = new Map();
const nextScores = new Map();
const unavailable = new Set();
const broken = new Set();
const seenFilms = new Set();
const seenVideos = new Set();
let queue = [];
let lastEligible = [];
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
  lastEligible = eligible;
  queue = eligible
    .filter(f => !matches(f, seenFilms) && f.id !== current?.id)
    .sort((a, b) => scores.get(a.id) - scores.get(b.id));
  return eligible;
}

export function canRestart(eligible) {
  return !!eligible.length && !!seenFilms.size;
}

// The new round takes the order already shown for it in Up next.
export function clearRound() {
  seenFilms.clear();
  seenVideos.clear();
  scores.clear();
  for (const [id, score] of nextScores) {
    scores.set(id, score);
  }
  nextScores.clear();
}

// The round after this one, in the order it will play: every eligible film again, and, as avoidRepeat does,
// not opening with the film that closes this round.
export function nextRound() {
  for (const film of lastEligible) {
    if (!nextScores.has(film.id)) {
      nextScores.set(film.id, Math.random());
    }
  }
  const order = [...lastEligible].sort((a, b) => nextScores.get(a.id) - nextScores.get(b.id));
  const closing = queue.at(-1)?.id ?? lastPlayed;
  if (order.length > 1 && order[0].id === closing) {
    order.push(order.shift());
  }
  return order;
}

// Do not open a new round with the film that closed the last one.
export function avoidRepeat() {
  if (queue.length > 1 && queue[0].id === lastPlayed) {
    queue.push(queue.shift());
  }
}

export function playableClips(data) {
  return data.videos.filter(v => !broken.has(videoKey(v)) && !seenVideos.has(videoKey(v)) &&
    !pref("skipped").some(s => s.video === videoKey(v)) && !pref("dead").some(d => d.video === videoKey(v)));
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

// A broken clip is left out for the rest of this visit. One that failed permanently is also saved (the "dead"
// preference), so later visits do not try it again until the entry expires.
export function markClipBroken(clip, permanent) {
  broken.add(videoKey(clip));
  if (permanent && !pref("dead").some(d => d.video === videoKey(clip))) {
    addToList("dead", {video: videoKey(clip), at: Date.now()});
    savePrefs();
  }
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
