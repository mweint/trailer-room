// Loads a provider's player script once and resolves when its API is ready.
import {el} from "../dom.js";

const sdkPromises = {};

export function sdk(name) {
  if (name === "youtube" && window.YT?.Player) {
    return Promise.resolve();
  }
  if (name === "vimeo" && window.Vimeo?.Player) {
    return Promise.resolve();
  }
  if (!sdkPromises[name]) {
    sdkPromises[name] = new Promise((resolve, reject) => {
      const script = el("script");
      const fail = () => {
        script.remove();
        delete sdkPromises[name];
        reject(new Error("Player SDK unavailable"));
      };
      const timeout = setTimeout(fail, 13000);
      const ready = () => {
        clearTimeout(timeout);
        resolve();
      };
      if (name === "youtube") {
        window.onYouTubeIframeAPIReady = ready;
      } else {
        script.onload = ready;
      }
      script.onerror = () => {
        clearTimeout(timeout);
        fail();
      };
      script.src = name === "youtube" ? "https://www.youtube.com/iframe_api" : "https://player.vimeo.com/api/player.js";
      document.head.append(script);
    });
  }
  return sdkPromises[name];
}
