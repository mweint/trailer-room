// Dock visibility: auto-hide, the wake surface over the picture, focus reclaim and the compact view-tools menu.
// State is data-controls="hidden", data-hover="local" and data-transport on the stage.
import {$} from "../dom.js";
import {isPlaying, resume, pause} from "../playback/player.js";

let idleTimer;
let adjustingControl = false;
let keyboardControl = false;

export function viewToolsOpen() {
  return $("moreControls").getAttribute("aria-expanded") === "true";
}

export function scheduleControlsHide() {
  clearTimeout(idleTimer);
  if (isPlaying() && $("stage").dataset.controls !== "hidden" && !adjustingControl && !viewToolsOpen() &&
      !(keyboardControl && $("dock").contains(document.activeElement))) {
    idleTimer = setTimeout(() => {
      if (document.hasFocus() && $("dock").contains(document.activeElement)) {
        $("stage").focus({preventScroll: true});
      }
      $("stage").dataset.controls = "hidden";
    }, matchMedia("(pointer: coarse)").matches ? 4000 : 2400);
  }
}

export function cancelControlsHide() {
  clearTimeout(idleTimer);
}

export function showControls() {
  delete $("stage").dataset.controls;
  scheduleControlsHide();
}

// A key press keeps the dock up while focus stays inside it.
export function keyboardUsed() {
  keyboardControl = true;
  showControls();
}

// While set, the wake surface covers the embed so pointer events stay in this page.
export function setLocalHover(on) {
  if (on) {
    $("stage").dataset.hover = "local";
  } else {
    delete $("stage").dataset.hover;
  }
}

export function setTransport(mode) {
  $("stage").dataset.transport = mode;
}

// Key events inside a provider iframe never bubble to this page. Return keyboard
// focus to the screen after the embed receives it, including on a trailer change.
function reclaimEmbedFocus() {
  if (document.hasFocus() && document.activeElement?.parentElement === $("embed")) {
    $("stage").focus({preventScroll: true});
  }
}

export function collapseViewTools() {
  $("moreControls").setAttribute("aria-expanded", "false");
}

export function closeViewTools() {
  if (!viewToolsOpen()) {
    return;
  }
  if ($("viewTools").contains(document.activeElement)) {
    $("moreControls").focus({preventScroll: true});
  }
  $("moreControls").setAttribute("aria-expanded", "false");
  scheduleControlsHide();
}

export function initDock() {
  window.addEventListener("blur", () => requestAnimationFrame(reclaimEmbedFocus));
  window.addEventListener("focus", () => requestAnimationFrame(reclaimEmbedFocus));
  $("moreControls").onclick = () => {
    const button = $("moreControls");
    button.setAttribute("aria-expanded", String(button.getAttribute("aria-expanded") !== "true"));
    showControls();
  };
  document.addEventListener("click", e => {
    if (!$("moreControls").contains(e.target)) {
      closeViewTools();
    }
  });
  window.addEventListener("resize", closeViewTools);
  $("stage").addEventListener("pointermove", () => {
    keyboardControl = false;
    showControls();
  });
  // Keep motion over the picture in the page even after the dock has appeared.
  // A tap on playing video reveals controls. A tap on paused video resumes it.
  document.querySelector(".wake-surface").addEventListener("click", e => {
    if (!isPlaying()) {
      resume();
    } else if (e.pointerType === "mouse") {
      pause();
    }
  });
  $("stage").addEventListener("pointerdown", e => {
    keyboardControl = false;
    adjustingControl = $("dock").contains(e.target);
    showControls();
  });
  for (const event of ["pointerup", "pointercancel"]) {
    window.addEventListener(event, () => {
      if (adjustingControl) {
        adjustingControl = false;
        showControls();
      }
    });
  }
  $("dock").addEventListener("focusin", showControls);
  $("dock").addEventListener("focusout", () => queueMicrotask(scheduleControlsHide));
}
