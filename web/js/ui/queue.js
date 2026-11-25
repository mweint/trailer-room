// Queue: the up-next list, poster loading and sizing the list to the space beside the player.
import {$, el, glide, places} from "../dom.js";
import {posterUrls} from "../catalog.js";
import {skipTo, removeFromQueue} from "../playback/controller.js";

function removeButton(film) {
  const button = el("button", "button button--icon queue-remove");
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", "#i-remove");
  icon.setAttribute("class", "icon icon--sm");
  icon.setAttribute("aria-hidden", "true");
  icon.append(use);
  button.append(icon);
  button.title = "Remove from queue";
  button.setAttribute("aria-label", "Remove " + film.title + " from queue");
  button.onclick = () => removeFromQueue(film);
  return button;
}

function queueRow(film) {
  const li = el("li", "queue-item");
  const button = el("button", "button button--flush queue-row");
  button.title = film.title;
  const text = el("span");
  const fallback = el("span", "poster", film.title[0]);
  fallback.setAttribute("aria-hidden", "true");
  button.append(fallback, text);
  text.append(el("span", "queue-title", film.title), el("span", "queue-sub", film.year));
  li.append(button, removeButton(film));
  li.dataset.id = film.id;
  li.loadPoster = () => {
    li.loadPoster = null;
    const urls = posterUrls(film);
    if (!urls.length) {
      return;
    }
    const img = el("img");
    img.alt = "";
    img.width = 38;
    img.height = 56;
    img.decoding = "async";
    img.onload = () => fallback.replaceWith(img);
    img.onerror = () => {
      if (urls.length) {
        img.src = urls.shift();
      }
    };
    img.src = urls.shift();
  };
  return li;
}

// Beside the player the list fills the column down to the sources; elsewhere CSS gives it four rows.
export function fitQueuePreview() {
  const list = $("queue");
  const preview = list.parentElement;
  const layout = list.closest("main");
  const besidePlayer = matchMedia("(width > 54rem)").matches && !layout.hasAttribute("data-theater");
  if (!besidePlayer) {
    preview.style.removeProperty("--queue-height");
    return;
  }
  const aside = list.closest("aside");
  const below = aside.querySelector(".sources").getBoundingClientRect().height +
    parseFloat(getComputedStyle(aside).rowGap) + parseFloat(getComputedStyle(layout).paddingBottom);
  const available = innerHeight - (preview.getBoundingClientRect().top + scrollY) - below;
  preview.style.setProperty("--queue-height", Math.floor(available) + "px");
}

let posterWatch;

// Posters load as their rows scroll near the visible part of the list.
function watchPosters() {
  const margin = navigator.connection?.saveData ? "0px" : "0px 0px 50% 0px";
  posterWatch = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.loadPoster?.();
        posterWatch.unobserve(entry.target);
      }
    }
  }, {root: $("queue").parentElement, rootMargin: margin});
}

// pending: enabled sources are still loading. anyEnabled: at least one source is switched on.
export function renderQueue(queue, pending, anyEnabled) {
  $("queue").closest(".queue").setAttribute("aria-busy", String(pending));
  const list = $("queue");
  const previous = new Map(Array.from(list.children, row => [row.dataset.id, row]));
  const before = places(list.children);
  $("remaining").textContent = queue.length ? queue.length.toLocaleString() + " queued" : "";
  // Keep the existing image nodes when the next film moves up a row.
  const preview = queue.slice(0, 13);
  for (const [index, film] of preview.entries()) {
    let row = previous.get(film.id);
    if (!row) {
      row = queueRow(film);
      posterWatch.observe(row);
    }
    row.firstChild.onclick = () => skipTo(film);
    if (list.children[index] !== row) {
      list.insertBefore(row, list.children[index] || null);
    }
  }
  while (list.children.length > preview.length) {
    posterWatch.unobserve(list.lastChild);
    list.lastChild.remove();
  }
  glide(list.children, before);
  $("queueEmpty").textContent = queue.length || pending ? "" :
    anyEnabled ? "No more films in this queue." : "Select a film source to build your queue.";
  fitQueuePreview();
}

export function initQueue() {
  watchPosters();
  window.addEventListener("resize", fitQueuePreview);
  new ResizeObserver(fitQueuePreview).observe($("queue").closest("main").querySelector(".sources"));
}
