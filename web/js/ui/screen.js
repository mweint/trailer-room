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

// keepPicture leaves the cover and artwork hidden so the reused embed stays visible.
export function resetScreen(keepPicture, clearEmbed) {
  if (clearEmbed) {
    $("embed").replaceChildren();
  }
  $("art").hidden = $("cover").hidden = keepPicture;
  setStartPending(false);
  $("start").hidden = true;
}

export function mountStarting() {
  $("cue").textContent = "";
  $("start").hidden = $("cover").hidden;
  setStartPending(!$("cover").hidden);
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
