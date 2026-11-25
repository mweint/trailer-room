// The Programming sheet (opened from the masthead and the Up next summary): open and close, and the
// hidden-movie and skipped-trailer lists with Restore. Its filters are rendered by programming.js.
import {$, el, expand, openDialog, closeDialog, dismissible} from "../dom.js";
import {pref, removeFromList, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";
import {forgetUnavailable} from "../playback/rotation.js";

// [preference, list element, count element, fold toggle, empty text]
const LISTS = [
  ["hidden", "hiddenList", "hiddenCount", "hiddenToggle", "No hidden movies."],
  ["skipped", "skippedList", "skippedCount", "skippedToggle", "No skipped trailers."]
];

function restoreLine(field, item) {
  const line = el("div", "restore");
  const btn = el("button", "button button--text", "Restore");
  const details = el("div", "restore-details");
  const title = el("div", "restore-title", item.title);
  if (item.year) {
    title.append(" ", el("span", "restore-year", item.year));
  }
  details.append(title);
  if (field === "skipped" && item.video) {
    const [provider, videoId] = item.video.split("/");
    const name = {youtube: "YouTube", vimeo: "Vimeo"}[provider] || provider;
    const reference = el("div", "restore-reference", [name, videoId].filter(Boolean).join(" · "));
    reference.title = reference.textContent;
    details.append(reference);
  }
  line.append(details, btn);
  btn.onclick = () => {
    removeFromList(field, item);
    forgetUnavailable();
    savePrefs();
    renderLists();
    sourcesChanged();
  };
  return line;
}

function renderLists() {
  for (const [field, id, count, , none] of LISTS) {
    const list = $(id);
    $(count).textContent = pref(field).length ? pref(field).length.toLocaleString() : "None";
    list.replaceChildren();
    if (!pref(field).length) {
      list.append(el("p", "", none));
    }
    for (const item of pref(field)) {
      list.append(restoreLine(field, item));
    }
  }
}

export function preferencesOpen() {
  return $("settings").open;
}

// Goes through the button, as a click on it would.
export function clickPreferences() {
  $("preferences").click();
}

export function initPreferences() {
  const open = () => {
    renderLists();
    openDialog($("settings"));
  };
  $("preferences").onclick = open;
  $("programmingSummary").onclick = open;
  $("close").onclick = () => closeDialog($("settings"));
  // Hidden movies and skipped trailers are rarely needed, so each folds into one row with a count.
  for (const [, , , toggle] of LISTS) {
    $(toggle).onclick = () => expand($(toggle), $(toggle).getAttribute("aria-expanded") !== "true");
  }
  dismissible($("settings"));
}
