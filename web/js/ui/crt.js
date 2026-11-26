// CRT effect: the baked beam texture, tube sizing and the toggle. State is data-crt on the screen.
import {$} from "../dom.js";
import {pref, setPref, savePrefs} from "../prefs.js";

// Bake one scanline period (pitch device pixels tall): black whose opacity is the shadow between beams. The browser
// lays this tile over the live iframe with plain transparency, so the player never reads a video frame, and every
// browser draws it alike: iOS Safari cannot blend a video with a blend mode and paints a blended layer as solid grey.
const GAP_SHADOW = 0.23;
const textures = new Map();

function beamTexture(pitch) {
  if (textures.has(pitch)) {
    return textures.get(pitch);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = pitch;
  const context = canvas.getContext("2d");
  const image = context.createImageData(1, pitch);
  for (let row = 0; row < pitch; row++) {
    // The beam fills the bottom row of the period and fades into the dark gap between lines.
    const gap = 0.5 - 0.5 * Math.cos(2 * Math.PI * (pitch - 1 - row) / pitch);
    image.data[row * 4 + 3] = Math.round(GAP_SHADOW * gap * gap * 255);
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  textures.set(pitch, url);
  return url;
}

function sizeTube() {
  if (!pref("crt")) {
    return;
  }
  const screen = $("screen");
  const dpr = window.devicePixelRatio || 1;
  const pitch = Math.max(2, Math.round(screen.clientHeight * dpr / 420));
  screen.style.setProperty("--beam", pitch / dpr + "px");
  screen.style.setProperty("--tube-texture", 'url("' + beamTexture(pitch) + '")');
}

// The tile is sized in device pixels, so it is baked again when the density changes without a resize
// (the window moves to a screen with another scale).
function watchDensity() {
  matchMedia("(resolution: " + devicePixelRatio + "dppx)").addEventListener("change", () => {
    sizeTube();
    watchDensity();
  }, {once: true});
}

function applyTube() {
  $("screen").toggleAttribute("data-crt", pref("crt"));
  $("crt").setAttribute("aria-pressed", String(pref("crt")));
  sizeTube();
}

export function initCrt() {
  applyTube();
  new ResizeObserver(sizeTube).observe($("screen"));
  watchDensity();
  $("crt").onclick = () => {
    setPref("crt", !pref("crt"));
    applyTube();
    savePrefs();
  };
}
