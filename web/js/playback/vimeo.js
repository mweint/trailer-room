// Vimeo adapter: wraps one Vimeo.Player iframe behind the same interface as the YouTube adapter.
//
// hooks used here: active() state(on) position(seconds, duration) ended() failed() blocked()
// audioReady(volume) ready()

export function vimeoEmbedUrl(id) {
  const params = new URLSearchParams({autoplay: "1", playsinline: "1"});
  params.set("fullscreen", "0");
  params.set("autoplay", "0");
  return "https://player.vimeo.com/video/" + id + "?" + params;
}

export function createVimeo(target, hooks) {
  const v = new Vimeo.Player(target);
  const play = () => v.play().catch(e => e.name === "NotAllowedError" ? hooks.blocked() : hooks.failed());

  async function seek(offset) {
    try {
      const duration = await v.getDuration();
      const time = await v.getCurrentTime();
      await v.setCurrentTime(Math.max(0, Math.min(duration, time + offset)));
    } catch {}
  }

  async function captions(on) {
    if (!on) {
      return v.disableTextTrack();
    }
    const tracks = await v.getTextTracks();
    const track = tracks.find(t => t.language === "en") || tracks[0];
    if (!track) {
      throw Error("No captions");
    }
    return v.enableTextTrack(track.language, track.kind);
  }

  v.on("timeupdate", e => {
    if (hooks.active()) {
      hooks.position(e.seconds, e.duration);
    }
  });
  v.on("ended", () => {
    if (hooks.active()) {
      hooks.ended();
    }
  });
  v.on("play", () => hooks.state(true));
  v.on("pause", () => hooks.state(false));
  v.on("error", () => hooks.failed());
  v.ready().then(async () => {
    if (!hooks.active()) {
      return;
    }
    await v.disableTextTrack().catch(() => {});
    const volume = await v.getVolume().catch(() => 1);
    if (hooks.active()) {
      hooks.audioReady(volume * 100);
      play();
      hooks.ready();
    }
  }).catch(() => hooks.failed());

  return {
    play,
    pause: () => v.pause().catch(() => {}),
    seek,
    seekTo: t => v.setCurrentTime(t).catch(() => {}),
    volume: n => v.setVolume(n / 100).catch(() => {}),
    mute: on => v.setMuted(on).catch(() => {}),
    captions,
    destroy: () => v.destroy().catch(() => {})
  };
}
