// Preferences dialog: open and close, and the hidden-movie and skipped-trailer lists with Restore.
import {$, el} from "../dom.js";
import {pref, removeFromList, savePrefs} from "../prefs.js";
import {sourcesChanged} from "../playback/controller.js";
import {forgetUnavailable} from "../playback/rotation.js";

const LISTS = [
  ["hidden", "hiddenList", "No hidden movies."],
  ["skipped", "skippedList", "No skipped trailers."]
];

function restoreLine(field, item) {
  const line = el("div", "restore");
  const btn = el("button", "button", "Restore");
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
  for (const [field, id, none] of LISTS) {
    const list = $(id);
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
  $("preferences").onclick = () => {
    renderLists();
    $("settings").showModal();
  };
  $("close").onclick = () => $("settings").close();
}
