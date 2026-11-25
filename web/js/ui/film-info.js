// Film info: title link, credit, facts and the film options menu.
import {$, expand, headingLink} from "../dom.js";
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
    info?.letterboxd?.rating ? "★ " + info.letterboxd.rating.toFixed(1) : "",
    sourceNames(film)
  ].filter(Boolean).join(" · ");
  $("synopsis").textContent = info?.description || "";
  synopsisOpen = false;
  fitSynopsis();
  $("hide").disabled = false;
  $("alternate").disabled = !clip;
}

// Whether the viewer opened the description with More; reset for each film.
let synopsisOpen = false;

// The description collapses to its preview only when it is longer than the preview (--collapse-closed, e.g. "2lh");
// otherwise it stays open and More is hidden. Runs again when the width changes.
function fitSynopsis(animate = false) {
  const text = $("synopsis");
  const toggle = $("synopsisToggle");
  const style = getComputedStyle(text);
  const preview = parseFloat(style.getPropertyValue("--collapse-closed")) * parseFloat(style.lineHeight);
  const longer = text.scrollHeight > preview + 1;
  toggle.hidden = !longer;
  toggle.textContent = synopsisOpen ? "Less" : "More";
  expand(toggle, synopsisOpen || !longer, animate);
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
    synopsisOpen = !synopsisOpen;
    fitSynopsis(true);
  };
  new ResizeObserver(() => fitSynopsis()).observe($("synopsis").parentElement);
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
