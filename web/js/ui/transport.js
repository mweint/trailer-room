// Dock transport: title, timeline, play, next, mute, volume and captions.
import {$, headingLink} from "../dom.js";
import {pref, setPref, savePrefs} from "../prefs.js";
import {play, skipTo} from "../playback/controller.js";
import {seekTo, setVolume, setMuted, toggleCaptions} from "../playback/player.js";

function paintRange(input) {
  input.style.setProperty("--fill", (100 * input.valueAsNumber / Number(input.max)) + "%");
}

export function showPosition(seconds, duration) {
  if (!(duration > 0)) {
    return;
  }
  $("timeline").max = duration;
  if (!$("timeline").matches(":active")) {
    $("timeline").value = seconds;
  }
  paintRange($("timeline"));
  $("timeline").disabled = false;
}

function reflectMute() {
  paintRange($("volume"));
  const muted = pref("muted") || Number($("volume").value) === 0;
  $("volumeIcon").setAttribute("href", muted ? "#i-muted" : "#i-volume");
  $("mute").title = muted ? "Unmute" : "Mute";
  $("mute").setAttribute("aria-label", $("mute").title);
}

export function showVolume(initialVolume) {
  $("volume").value = pref("volume") ?? initialVolume;
}

export function enableAudio() {
  for (const id of ["volume", "mute", "cc"]) {
    $(id).disabled = false;
  }
  reflectMute();
}

export function setCaptionsPressed(on) {
  $("cc").setAttribute("aria-pressed", String(on));
}

export function resetTransport() {
  $("cc").setAttribute("aria-pressed", "false");
  $("timeline").value = 0;
  paintRange($("timeline"));
  for (const id of ["timeline", "volume", "mute", "cc"]) {
    $(id).disabled = true;
  }
}

export function reflectPlayback(playing) {
  $("play").setAttribute("aria-label", playing ? "Pause" : "Play");
  $("playIcon").setAttribute("href", playing ? "#i-pause" : "#i-play");
}

export function showFilmControls(link, hasClip, playing) {
  headingLink($("title"), link);
  $("next").disabled = false;
  $("play").disabled = !hasClip;
  reflectPlayback(playing);
}

export function disableFilmControls(playing) {
  for (const id of ["play", "next"]) {
    $(id).disabled = true;
  }
  reflectPlayback(playing);
}

export function enableNext() {
  $("next").disabled = false;
}

export function setTitleText(text) {
  $("title").textContent = text;
}

// Goes through the button so a disabled Next stays inert.
export function clickNext() {
  $("next").click();
}

function volumeChanged() {
  setPref("volume", Number($("volume").value));
  setPref("muted", pref("volume") === 0);
  setVolume(pref("volume"));
  setMuted(pref("muted"));
  reflectMute();
  savePrefs();
}

export function initTransport() {
  $("timeline").oninput = () => {
    paintRange($("timeline"));
    seekTo(Number($("timeline").value));
  };
  $("volume").oninput = volumeChanged;
  $("mute").onclick = () => {
    if (Number($("volume").value) === 0) {
      $("volume").value = 50;
      volumeChanged();
      return;
    }
    setPref("muted", !pref("muted"));
    setMuted(pref("muted"));
    reflectMute();
    savePrefs();
  };
  $("cc").onclick = toggleCaptions;
  $("play").onclick = play;
  $("next").onclick = () => skipTo();
}
