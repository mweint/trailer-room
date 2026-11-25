// Theater mode and fullscreen. State is data-theater on main and data-expanded on the theater section.
import {$} from "../dom.js";
import {pref, setPref, savePrefs} from "../prefs.js";

const layout = $("theater").closest("main");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
let sizeMotion;
let sidebarMotion;
let showControls = () => {};
let layoutChanged = () => {};

function stopLayoutMotion() {
  sizeMotion?.cancel();
  sidebarMotion?.cancel();
}

// Fullscreen fallback for browsers that refuse the Fullscreen API.
export function isExpanded() {
  return $("theater").hasAttribute("data-expanded");
}

function reflectTheaterMode() {
  layout.toggleAttribute("data-theater", pref("wide"));
  layoutChanged();
  $("wide").setAttribute("aria-pressed", String(pref("wide")));
  $("wide").title = pref("wide") ? "Exit theater mode (T)" : "Theater mode (T)";
}

export function toggleTheaterMode() {
  if (document.fullscreenElement || isExpanded()) {
    return;
  }
  const stage = $("stage");
  const from = stage.getBoundingClientRect();
  const fromRadius = getComputedStyle(stage).borderTopLeftRadius;
  stopLayoutMotion();
  setPref("wide", !pref("wide"));
  reflectTheaterMode();
  savePrefs();
  showControls();
  if (reduceMotion.matches) {
    return;
  }
  const to = stage.getBoundingClientRect();
  const margin = parseFloat(getComputedStyle(stage).marginLeft);
  // Resize the frame around the live 16:9 image. Sampling the current bounds also
  // lets a second press reverse an in-flight transition from its visible position.
  sizeMotion = stage.animate({
    width: [from.width + "px", to.width + "px"],
    height: [from.height + "px", to.height + "px"],
    borderRadius: [fromRadius, getComputedStyle(stage).borderTopLeftRadius],
    marginLeft: [(margin + from.left - to.left) + "px", margin + "px"],
    maxHeight: ["none", "none"],
    zIndex: [1, 1]
  }, {duration: 240, easing: "cubic-bezier(.22, 1, .36, 1)"});
  sidebarMotion = layout.querySelector("aside").animate(
    [{opacity: 0}, {opacity: 1}],
    {duration: 160, delay: 80, easing: "ease-out", fill: "backwards"});
}

function fullscreenControls() {
  stopLayoutMotion();
  showControls();
  const expanded = !!document.fullscreenElement || isExpanded();
  const label = expanded ? "Exit fullscreen" : "Fullscreen";
  $("full").setAttribute("aria-label", label);
  $("full").title = label + " (F)";
  $("fullIcon").setAttribute("href", expanded ? "#i-exit" : "#i-full");
}

async function toggleFullscreen() {
  const theater = $("theater");
  if (isExpanded()) {
    theater.removeAttribute("data-expanded");
  } else if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    try {
      await theater.requestFullscreen();
    } catch {
      theater.setAttribute("data-expanded", "");
    }
  }
  fullscreenControls();
}

// Goes through the button, as a click on it would.
export function clickFullscreen() {
  $("full").click();
}

// hooks: showControls() reveals the dock; layoutChanged() refits whatever depends on the page layout.
export function initTheater(hooks) {
  showControls = hooks.showControls;
  layoutChanged = hooks.layoutChanged;
  reflectTheaterMode();
  $("wide").onclick = toggleTheaterMode;
  window.addEventListener("resize", stopLayoutMotion);
  reduceMotion.addEventListener("change", stopLayoutMotion);
  $("full").onclick = toggleFullscreen;
  document.addEventListener("fullscreenchange", fullscreenControls);
}
