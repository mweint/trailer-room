// YouTube adapter: wraps one YT.Player iframe, which can be reused for the next trailer.
//
// hooks (shared with the Vimeo adapter): active() rebind(run) state(on) position(seconds, duration)
// ended() failed() blocked() audioReady(volume) ready() freshEmbed() watchForPlayback(reused)
// selectedId() title() captionsWanted()

export function youTubeEmbedUrl(id) {
  const params = new URLSearchParams({autoplay: "1", playsinline: "1"});
  params.set("enablejsapi", "1");
  params.set("origin", location.origin);
  params.set("fs", "0");
  params.set("rel", "0");
  params.set("controls", "0");
  params.set("iv_load_policy", "3");
  return "https://www.youtube-nocookie.com/embed/" + id + "?" + params;
}

export function createYouTube(target, hooks) {
  let captionDefaultApplied = false;
  let ready = false;
  let hasPlayed = false;
  let reused = false;
  let clock;
  const isSelected = yt => hooks.active() && yt.getVideoData()?.video_id === hooks.selectedId();

  function defaultCaptionsOff(yt) {
    if (!hooks.active() || hooks.captionsWanted() || captionDefaultApplied ||
        !yt.getOptions?.()?.includes("captions")) {
      return;
    }
    captionDefaultApplied = true;
    yt.setOption("captions", "track", {});
    yt.unloadModule?.("captions");
  }

  function applyCaptions(yt) {
    if (!hooks.captionsWanted()) {
      return defaultCaptionsOff(yt);
    }
    const tracks = yt.getOption?.("captions", "tracklist") || [];
    const track = tracks.find(t => t.languageCode === "en") || tracks[0];
    if (track) {
      yt.setOption("captions", "track", track);
    } else {
      yt.setOption("captions", "track", {languageCode: "en"});
    }
  }

  function onReady(e) {
    if (!hooks.active()) {
      return;
    }
    ready = true;
    defaultCaptionsOff(e.target);
    hooks.audioReady(e.target.getVolume());
    clock = setInterval(() => {
      if (hasPlayed && isSelected(yt)) {
        hooks.position(yt.getCurrentTime(), yt.getDuration());
      }
    }, 500);
    e.target.playVideo();
    hooks.ready();
  }

  function onApiChange(e) {
    if (isSelected(e.target)) {
      applyCaptions(e.target);
    }
  }

  function onStateChange(e) {
    if (!isSelected(e.target)) {
      return;
    }
    if (e.data === YT.PlayerState.ENDED && hasPlayed) {
      hooks.ended();
    }
    if (e.data === YT.PlayerState.PLAYING) {
      if (reused && !hasPlayed) {
        hooks.audioReady(e.target.getVolume());
      }
      hasPlayed = true;
      defaultCaptionsOff(e.target);
      hooks.state(true);
    }
    if (e.data === YT.PlayerState.PAUSED && hasPlayed) {
      hooks.state(false);
    }
  }

  function onError() {
    if (hooks.active() && reused && !hasPlayed) {
      hooks.freshEmbed();
    } else {
      hooks.failed();
    }
  }

  const yt = new YT.Player(target, {
    host: "https://www.youtube-nocookie.com",
    events: {onReady, onApiChange, onStateChange, onError, onAutoplayBlocked: hooks.blocked}
  });

  return {
    canReuse: () => ready,
    load: (id, nextRun) => {
      hooks.rebind(nextRun);
      reused = true;
      hasPlayed = false;
      captionDefaultApplied = false;
      yt.getIframe().title = hooks.title() + " trailer";
      hooks.watchForPlayback(true);
      yt.loadVideoById(id);
    },
    play: () => yt.playVideo?.(),
    pause: () => yt.pauseVideo?.(),
    seek: offset => yt.seekTo?.(Math.max(0, (yt.getCurrentTime?.() || 0) + offset), true),
    seekTo: t => yt.seekTo(t, true),
    volume: n => yt.setVolume(n),
    mute: on => on ? yt.mute() : yt.unMute(),
    captions: on => {
      captionDefaultApplied = true;
      if (on) {
        yt.loadModule?.("captions");
        applyCaptions(yt);
      } else {
        yt.setOption("captions", "track", {});
        yt.unloadModule?.("captions");
      }
    },
    destroy: () => {
      clearInterval(clock);
      yt.destroy();
    }
  };
}
