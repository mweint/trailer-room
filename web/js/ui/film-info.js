// Film info: title link, credit, facts and the film options menu.
import {$, headingLink} from "../dom.js";
import {sourceNames} from "../catalog.js";
import {addToList, savePrefs} from "../prefs.js";
import {currentFilm, currentClip, advance} from "../playback/controller.js";
import {videoKey} from "../playback/rotation.js";

export function showFilmInfo(film, info, clip, link) {
  headingLink($("filmTitle"), link);
  $("filmInfo").hidden = false;
  $("filmInfo").setAttribute("aria-busy", "false");
  $("credit").textContent = info?.directors?.length ? "Directed by " + info.directors.join(" & ") : "";
  $("meta").textContent = [
    film.year,
    film.certification,
    info?.runtime,
    info?.genres?.slice(0, 2).join(", "),
    sourceNames(film)
  ].filter(Boolean).join(" · ");
  $("synopsis").textContent = info?.description || "";
  setSynopsisExpanded(false);
  $("hide").disabled = false;
  $("alternate").disabled = !clip;
}

function setSynopsisExpanded(expanded) {
  $("synopsisToggle").setAttribute("aria-expanded", String(expanded));
  $("synopsisToggle").textContent = expanded ? "Less" : "More";
  fitSynopsis();
}

// The toggle shows only when the description runs past its clamped lines (--synopsis-lines in CSS, e.g. "2lh").
// Measured against the clamp, not the current height, so it stays put while the text animates.
function fitSynopsis() {
  const text = $("synopsis");
  const style = getComputedStyle(text);
  const clamp = parseFloat(style.getPropertyValue("--synopsis-lines")) * parseFloat(style.lineHeight);
  $("synopsisToggle").hidden = text.scrollHeight <= clamp + 1;
}

export function setFilmInfoState(hidden, busy) {
  $("filmInfo").hidden = hidden;
  $("filmInfo").setAttribute("aria-busy", String(busy));
}

export function clearFilmTitle() {
  $("filmTitle").textContent = "";
}

export function disableFilmActions() {
  for (const id of ["alternate", "hide"]) {
    $(id).disabled = true;
  }
}

export function filmOptionsOpen() {
  return $("filmOptions").open;
}

export function closeFilmOptions() {
  $("filmOptions").open = false;
}

// Closing from the keyboard returns focus to the menu button.
export function dismissFilmOptions() {
  $("filmOptions").open = false;
  $("filmOptions").querySelector("summary").focus();
}

// notice(message) writes the status line under the player.
export function initFilmInfo(notice) {
  $("synopsisToggle").onclick = () => {
    setSynopsisExpanded($("synopsisToggle").getAttribute("aria-expanded") !== "true");
  };
  new ResizeObserver(fitSynopsis).observe($("synopsis"));
  document.addEventListener("click", e => {
    if ($("filmOptions").open && !$("filmOptions").contains(e.target)) {
      $("filmOptions").open = false;
    }
  });
  $("hide").onclick = () => {
    const current = currentFilm();
    if (!current) {
      return;
    }
    addToList("hidden", {keys: [...current.keys], title: current.title, year: current.year});
    savePrefs();
    notice(current.title + " hidden. Restore it in Preferences.");
    advance();
  };
  $("alternate").onclick = () => {
    const current = currentFilm();
    const clip = currentClip();
    if (!clip || !current) {
      return;
    }
    addToList("skipped", {video: videoKey(clip), title: current.title, year: current.year});
    savePrefs();
    notice("Skipped this trailer for " + current.title + ". Only other versions can return.");
    advance();
  };
}
