// Screen: artwork, embed, cover, cue text and the play pill, plus the status line under the player.
import {$} from "../dom.js";
import {play} from "../playback/controller.js";

export function setNotice(message = "") {
  $("status").textContent = message;
}

export function setCue(text) {
  $("cue").textContent = text;
}

export function setArt(url) {
  if (url) {
    $("art").style.setProperty("--art", "url(" + JSON.stringify(url) + ")");
  } else {
    $("art").style.removeProperty("--art");
  }
}

function setStartPending(pending) {
  const button = $("start");
  button.disabled = pending;
  button.setAttribute("aria-busy", String(pending));
  if (pending) {
    button.setAttribute("aria-label", "Loading trailer");
  } else {
    button.removeAttribute("aria-label");
  }
}

// Whether the last picture stays on screen while the next trailer loads into the same player.
let keptPicture = false;

// keepPicture leaves the artwork hidden so the reused embed stays visible. The cover always shows while a film
// loads: it is transparent, so over a kept picture it adds only the spinner, and a click always shows a response.
export function resetScreen(keepPicture, clearEmbed) {
  if (clearEmbed) {
    $("embed").replaceChildren();
  }
  keptPicture = keepPicture;
  $("art").hidden = keepPicture;
  $("cover").hidden = false;
  setStartPending(false);
  $("start").hidden = true;
}

// Over a kept picture the spinner stays until the new trailer plays; otherwise the play pill shows its own.
export function mountStarting() {
  $("cue").textContent = keptPicture ? "Loading trailer" : "";
  $("start").hidden = keptPicture;
  setStartPending(!keptPicture);
}

// The trailer is playing (or paused) in the embed: the loading cover goes.
export function pictureShown() {
  $("cover").hidden = true;
  $("cue").textContent = "";
}

export function showEmbed(target) {
  $("cover").hidden = true;
  $("art").hidden = true;
  $("start").hidden = true;
  setStartPending(false);
  $("embed").replaceChildren(target);
}

export function offerStart(label, hidden) {
  $("startText").textContent = label;
  $("start").hidden = hidden;
}

export function hideStart() {
  $("start").hidden = true;
}

export function startDisabled() {
  return $("start").disabled;
}

export function initScreen() {
  $("start").onclick = play;
}
