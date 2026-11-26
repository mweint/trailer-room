// CRT effect: the baked beam texture, tube sizing and the toggle. State is data-crt on the screen.
import {$} from "../dom.js";
import {pref, setPref, savePrefs} from "../prefs.js";

// Bake one physical RGB stripe (three device pixels wide) and one scanline period (pitch device pixels tall).
// The browser composites this tile over the live iframe, so the player never copies or reads a video frame.
// Each value is an overlay-blend level: .5 leaves the picture as it is, more brightens, less darkens.
const textures = new Map();

function beamTexture(pitch) {
  if (textures.has(pitch)) {
    return textures.get(pitch);
  }
  const canvas = document.createElement("canvas");
  canvas.width = 3;
  canvas.height = pitch;
  const context = canvas.getContext("2d");
  const image = context.createImageData(3, pitch);
  for (let row = 0; row < pitch; row++) {
    // The bright beam fills the bottom row of the period and fades into the dark gap between lines.
    const gap = 0.5 - 0.5 * Math.cos(2 * Math.PI * (pitch - 1 - row) / pitch);
    const beam = 0.525 - 0.12 * gap * gap;
    for (let column = 0; column < 3; column++) {
      for (let channel = 0; channel < 3; channel++) {
        // Column 0 leans red, 1 green, 2 blue: the phosphor stripes of an aperture grille.
        const level = beam + (channel === column ? 0.018 : -0.009);
        image.data[(row * 3 + column) * 4 + channel] = Math.round(level * 255);
      }
      image.data[(row * 3 + column) * 4 + 3] = 255;
    }
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
  screen.style.setProperty("--triad", 3 / dpr + "px");
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
