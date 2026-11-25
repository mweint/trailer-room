// Keyboard shortcuts for the whole page. The order of the early returns is deliberate.
import {pref} from "../prefs.js";
import {play} from "../playback/controller.js";
import {seek} from "../playback/player.js";

// page: handles from the other ui modules, connected in main.js.
// viewToolsOpen() closeViewTools() filmOptionsOpen() dismissFilmOptions() keyboardUsed()
// isExpanded() clickFullscreen() preferencesOpen() toggleTheaterMode() clickNext()
export function initShortcuts(page) {
  document.addEventListener("keydown", e => {
    const key = e.key.toLowerCase();
    if (key === "escape" && page.viewToolsOpen()) {
      page.closeViewTools();
      return;
    }
    if (page.filmOptionsOpen() && key === "escape") {
      page.dismissFilmOptions();
      return;
    }
    if (!["n", "mediatracknext", "arrowleft", "arrowright"].includes(key)) {
      page.keyboardUsed();
    }
    if (e.key === "Escape" && page.isExpanded()) {
      page.clickFullscreen();
      return;
    }
    if (page.preferencesOpen() || e.ctrlKey || e.altKey || e.metaKey || e.repeat || e.target.isContentEditable ||
        e.target.matches("textarea, select, input:not([type=range]):not([type=checkbox])")) {
      return;
    }
    if (key === "escape" && pref("wide") && !document.fullscreenElement) {
      page.toggleTheaterMode();
      return;
    }
    if (e.key === " " && e.target.matches("button, input, summary")) {
      return;
    }
    if ((key === "arrowleft" || key === "arrowright") && e.target.matches("input[type=range]")) {
      return;
    }
    const next = () => page.clickNext();
    const action = {
      " ": play,
      n: next,
      mediatracknext: next,
      t: page.toggleTheaterMode,
      f: () => page.clickFullscreen(),
      arrowleft: () => seek(-10),
      arrowright: () => seek(10)
    }[key];
    if (action) {
      e.preventDefault();
      action();
    }
  });
}
