// The mounted provider player: the generation counter, mounting, reuse of an idle YouTube iframe, reset and audio.
import {el} from "../dom.js";
import {pref} from "../prefs.js";
import {sdk} from "./sdk.js";
import {createYouTube, youTubeEmbedUrl} from "./youtube.js";
import {createVimeo, vimeoEmbedUrl} from "./vimeo.js";

// Every change of film, clip or embed takes a new generation. Callbacks that were
// started under an older one compare against it and do nothing.
let generation = 0;
let player = null;
let idleYouTube = null;
let pendingTimer;
let playing = false;
let captionsOn = false;
let view;
let film;

// view: the page (see main.js). film: the controller's side of playback, with
// clip() title() loading() started() renderFilm() advance() clipFailed(run)
// pauseForRetry(message) playbackConfirmed()
export function connectPlayer(viewHooks, filmHooks) {
  view = viewHooks;
  film = filmHooks;
}

export function nextRun() {
  return ++generation;
}

export function isCurrentRun(run) {
  return run === generation;
}

export function isPlaying() {
  return playing;
}

export function hasPlayer() {
  return !!player;
}

export function stopWatchdog() {
  clearTimeout(pendingTimer);
}

function discardIdleYouTube() {
  idleYouTube?.destroy();
  idleYouTube = null;
}

export function resetPlayer(keepYouTube = false) {
  clearTimeout(pendingTimer);
  playing = false;
  const keepPicture = keepYouTube && film.started();
  const old = player;
  player = null;
  if (keepYouTube && old?.canReuse?.()) {
    idleYouTube = old;
    // A prefetched trailer can load this turn. Pause only if we are still waiting.
    setTimeout(() => {
      if (idleYouTube === old) {
        old.pause();
      }
    }, 0);
  } else {
    old?.destroy();
  }
  if (!keepYouTube) {
    discardIdleYouTube();
  }
  captionsOn = false;
  view.playerReset(keepPicture, !idleYouTube);
}

function audioReady(initialVolume) {
  view.volumeShown(initialVolume);
  if (pref("volume") !== null) {
    player.volume(pref("volume"));
  }
  player.mute(pref("muted"));
  view.audioReady();
}

// The callbacks one embed reports through. A reused YouTube iframe is rebound to
// the run of each trailer it loads, so its old callbacks stay valid.
function mountHooks(firstRun) {
  let run = firstRun;
  const active = () => run === generation;

  function freshEmbed() {
    if (!active()) {
      return;
    }
    ++generation;
    resetPlayer();
    mount();
  }

  function watchForPlayback(reused) {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      if (!active()) {
        return;
      }
      if (reused) {
        freshEmbed();
      } else {
        film.pauseForRetry("The video player did not respond. Check the connection and retry.");
      }
    }, reused ? 8000 : 18000);
  }

  const state = on => {
    if (!active()) {
      return;
    }
    clearTimeout(pendingTimer);
    playing = on;
    view.playbackChanged();
    if (on) {
      film.playbackConfirmed();
    }
    film.renderFilm();
  };

  const blocked = () => {
    if (!active()) {
      return;
    }
    state(false);
    view.autoplayBlocked();
    view.notice("Press Play in the video to continue.");
  };

  return {
    active,
    rebind: nextRun => {
      run = nextRun;
    },
    freshEmbed,
    watchForPlayback,
    state,
    blocked,
    failed: () => film.clipFailed(run),
    ended: () => film.advance(),
    ready: () => film.renderFilm(),
    position: (seconds, duration) => view.position(seconds, duration),
    audioReady,
    selectedId: () => film.clip()?.id,
    title: () => film.title(),
    captionsWanted: () => captionsOn
  };
}

export async function mount() {
  if (!film.clip() || player || film.loading()) {
    return;
  }
  const run = ++generation;
  const provider = film.clip().provider;
  const hooks = mountHooks(run);
  view.mountStarting();
  try {
    if (provider === "youtube" && idleYouTube) {
      player = idleYouTube;
      idleYouTube = null;
      try {
        player.load(film.clip().id, run);
      } catch {
        hooks.freshEmbed();
      }
      return;
    }
    discardIdleYouTube();
    await sdk(provider);
    if (!hooks.active()) {
      return;
    }
    const target = el("iframe");
    target.tabIndex = -1;
    target.title = film.title() + " trailer";
    target.allow = "autoplay; encrypted-media; fullscreen 'none'";
    target.src = provider === "youtube" ? youTubeEmbedUrl(film.clip().id) : vimeoEmbedUrl(film.clip().id);
    view.showEmbed(target);
    hooks.watchForPlayback(false);
    player = provider === "youtube" ? createYouTube(target, hooks) : createVimeo(target, hooks);
  } catch {
    if (hooks.active()) {
      film.pauseForRetry("Could not load the " + provider + " player. Check the connection and retry.");
    }
  }
}

export function togglePlayback() {
  if (playing) {
    player.pause();
  } else {
    player.play();
  }
}

export function resume() {
  player?.play();
}

export function pause() {
  player?.pause();
}

export function seek(offset) {
  player?.seek(offset);
}

export function seekTo(seconds) {
  player?.seekTo(seconds);
}

export function setVolume(level) {
  player?.volume(level);
}

export function setMuted(on) {
  player?.mute(on);
}

export async function toggleCaptions() {
  const run = generation;
  captionsOn = !captionsOn;
  view.captions(captionsOn);
  try {
    await player?.captions(captionsOn);
  } catch {
    if (run === generation) {
      captionsOn = false;
      view.captions(false);
      view.notice("Captions unavailable for this trailer.");
    }
  }
}
