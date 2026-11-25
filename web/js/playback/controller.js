// Playback controller: which film and clip are current, advancing, retry and failure counting.
import {detail, enabled, hidden, remerge, anySourceEnabled, sourcesPending} from "../library.js";
import {pref} from "../prefs.js";
import {
  connectPlayer, nextRun, isCurrentRun, isPlaying, hasPlayer, stopWatchdog, resetPlayer, mount, togglePlayback
} from "./player.js";
import {
  queued, takeNext, rebuildQueue, canRestart, clearRound, avoidRepeat, playableClips, hasSeenFilms, isSeen,
  markSeen, isUnavailable, markUnavailable, anyClipSeen, markClipSeen, markClipBroken, notePlayed,
  forgetEverything
} from "./rotation.js";

let current;
let info;
let clip;
let started = false;
let loading = false;
let retrying = false;
let failures = 0;
let embedFailures = 0;
let view;

// view: the page, assembled in main.js from the ui modules.
export function connectController(viewHooks) {
  view = viewHooks;
  connectPlayer(view, {
    clip: () => clip,
    title: () => current.title,
    loading: () => loading,
    started: () => started,
    renderFilm,
    advance,
    clipFailed,
    pauseForRetry,
    playbackConfirmed: () => {
      embedFailures = 0;
      view.notice();
    }
  });
}

export function currentFilm() {
  return current;
}

export function currentClip() {
  return clip;
}

function renderQueue() {
  const pending = !queued().length && sourcesPending();
  view.renderQueue(queued(), pending, anySourceEnabled());
}

function rebuild(paint = true) {
  const eligible = rebuildQueue(current);
  if (paint) {
    renderQueue();
  }
  return eligible;
}

function restartRound(eligible) {
  if (!canRestart(eligible)) {
    return false;
  }
  clearRound();
  rebuild();
  avoidRepeat();
  return true;
}

function renderFilm() {
  if (!current || !clip) {
    return;
  }
  view.renderFilm(current, info, clip, isPlaying());
}

function clearScreen(keepYouTube = false) {
  view.menusClosed();
  current = info = clip = null;
  resetPlayer(keepYouTube);
  view.filmCleared(isPlaying());
}

function empty(reason, waiting = false) {
  loading = false;
  clearScreen();
  view.empty(reason, waiting);
}

export function sourcesChanged() {
  const films = remerge();
  const replacement = films.find(f => current && f.keys.some(k => current.keys.includes(k)));
  if (replacement) {
    current = {...replacement, keys: [...new Set([...current.keys, ...replacement.keys])]};
  }
  rebuild();
  view.renderSources();
  if (!replacement || !enabled(current) || hidden(current)) {
    advance();
  } else {
    renderFilm();
  }
}

export function skipTo(film = null) {
  // A skip should also count when the previous film's metadata is still loading.
  if (current) {
    markSeen(current);
  }
  view.notice();
  advance(film);
}

// Takes a film out of this round's queue only; it can return next round. Hiding a film is separate and lasting.
export function removeFromQueue(film) {
  markSeen(film);
  rebuild();
}

function nothingToPlay() {
  const waiting = sourcesPending();
  const enabledAny = anySourceEnabled();
  renderQueue();
  empty(enabledAny ? "No trailers ready" : "Choose a film source", waiting);
  if (!waiting) {
    view.notice(!enabledAny ? "Turn on a film source to build your queue." :
      (pref("maxRating") ? "Try a higher film rating under Film sources or enable another source." :
        "Try another source or restore movies and trailers in Preferences."));
  }
}

function present(film, data, options) {
  failures = 0;
  current = film;
  info = data;
  clip = options[0];
  loading = false;
  markSeen(film);
  notePlayed(film);
  markClipSeen(clip);
  const safeArt = /^https:\/\//.test(data.art) ? data.art :
    clip.provider === "youtube" ? "https://i.ytimg.com/vi/" + clip.id + "/hqdefault.jpg" : "";
  view.art(safeArt);
  view.startOffered("Play trailers", started);
  renderFilm();
  rebuild();
  if (queued()[0]) {
    detail(queued()[0]).catch(() => {});
  }
  if (started) {
    mount();
  }
}

export async function advance(requested = null) {
  const run = nextRun();
  const excludeCurrent = current && (!enabled(current) || hidden(current));
  if (excludeCurrent) {
    view.clearCaption();
  }
  clearScreen(started && !excludeCurrent);
  loading = true;
  retrying = false;
  view.filmLoading();
  const eligible = rebuild(false);
  if (!queued().length) {
    restartRound(eligible);
  }
  while (isCurrentRun(run)) {
    let film = requested || takeNext();
    requested = null;
    if (!film) {
      if (hasSeenFilms() && rebuild().some(f => !isUnavailable(f)) &&
          restartRound(eligible.filter(f => !isUnavailable(f)))) {
        continue;
      }
      nothingToPlay();
      return;
    }
    current = film;
    rebuild(false);
    view.lookingUp();
    let data;
    try {
      data = await detail(film);
    } catch {
      if (!isCurrentRun(run)) {
        return;
      }
      // Keep a transient catalog outage from recursively scanning the whole library.
      if (++failures >= 3) {
        pauseForRetry("Trailer catalog unavailable. Retry when your connection is ready.");
        return;
      }
      markUnavailable(film);
      continue;
    }
    if (!isCurrentRun(run)) {
      return;
    }
    // A second catalog may have merged new identifiers or a rating while the lookup was running.
    film = current;
    if (data.imdb && !film.keys.includes(data.imdb)) {
      film.keys.push(data.imdb);
    }
    if (isSeen(film) || hidden(film)) {
      markSeen(film);
      current = null;
      rebuild(false);
      continue;
    }
    const options = playableClips(data);
    if (!options.length) {
      if (anyClipSeen(data)) {
        markSeen(film);
      } else {
        markUnavailable(film);
      }
      current = null;
      rebuild(false);
      continue;
    }
    present(film, data, options);
    return;
  }
}

function pauseForRetry(message) {
  nextRun();
  empty("Projection paused");
  started = false;
  retrying = true;
  view.startOffered("Retry playback", false);
  view.notice(message);
}

function clipFailed(run) {
  if (!isCurrentRun(run) || !clip) {
    return;
  }
  markClipBroken(clip);
  stopWatchdog();
  if (++embedFailures >= 5) {
    pauseForRetry("Several embeds failed. Check your network or browser settings, then retry.");
    return;
  }
  const options = playableClips(info);
  if (options.length) {
    nextRun();
    resetPlayer();
    clip = options[0];
    markClipSeen(clip);
    renderFilm();
    mount();
  } else {
    markUnavailable(current);
    advance();
  }
}

export function play() {
  if (view.startDisabled() || (!clip && !retrying)) {
    return;
  }
  view.transport("playback");
  view.notice();
  started = true;
  if (retrying) {
    forgetEverything();
    embedFailures = failures = 0;
    advance();
    return;
  }
  if (hasPlayer()) {
    togglePlayback();
  } else {
    mount();
  }
}
