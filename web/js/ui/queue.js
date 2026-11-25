// Queue: the up-next list, poster loading and fitting rows to the space beside the player.
import {$, el} from "../dom.js";
import {posterUrls} from "../catalog.js";
import {skipTo} from "../playback/controller.js";

function queueRow(film) {
  const li = el("li");
  const button = el("button", "button queue-row");
  const text = el("span");
  const fallback = el("span", "poster", film.title[0]);
  fallback.setAttribute("aria-hidden", "true");
  button.append(fallback, text);
  text.append(el("span", "queue-title", film.title), el("span", "queue-sub", film.year));
  li.append(button);
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

export function fitQueuePreview() {
  const list = $("queue");
  const preview = list.parentElement;
  const layout = list.closest("main");
  const besidePlayer = matchMedia("(width > 54rem)").matches && !layout.hasAttribute("data-theater");
  let slots = 4;
  if (besidePlayer) {
    const aside = list.closest("aside");
    const below = aside.querySelector(".sources").getBoundingClientRect().height +
      parseFloat(getComputedStyle(aside).rowGap) + parseFloat(getComputedStyle(layout).paddingBottom);
    const available = innerHeight - (preview.getBoundingClientRect().top + scrollY) - below;
    const rowHeight = parseFloat(getComputedStyle(preview).minHeight) / 4;
    slots = Math.max(4, Math.min(12, Math.floor(available / rowHeight)));
  }
  preview.style.setProperty("--queue-rows", slots);
  const rows = Array.from(list.children);
  rows.forEach((row, i) => {
    row.hidden = i >= slots;
  });
  // Wrapped titles can consume more than one slot.
  const limit = list.getBoundingClientRect().top + preview.clientHeight;
  const overflow = rows.slice(4).filter(row => !row.hidden && row.getBoundingClientRect().bottom > limit + .5);
  for (const row of overflow) {
    row.hidden = true;
  }
  let preloadNext = !navigator.connection?.saveData;
  for (const row of list.children) {
    if (!row.hidden) {
      row.loadPoster?.();
    } else if (preloadNext) {
      row.loadPoster?.();
      preloadNext = false;
    }
  }
}

// pending: enabled sources are still loading. anyEnabled: at least one source is switched on.
export function renderQueue(queue, pending, anyEnabled) {
  $("queue").closest(".queue").setAttribute("aria-busy", String(pending));
  const list = $("queue");
  const previous = new Map(Array.from(list.children, row => [row.dataset.id, row]));
  $("remaining").textContent = queue.length ? queue.length.toLocaleString() + " queued" : "";
  // Keep the existing image nodes when the next film moves up a row.
  const preview = queue.slice(0, 13);
  for (const [index, film] of preview.entries()) {
    const row = previous.get(film.id) || queueRow(film);
    row.firstChild.onclick = () => skipTo(film);
    if (list.children[index] !== row) {
      list.insertBefore(row, list.children[index] || null);
    }
  }
  while (list.children.length > preview.length) {
    list.lastChild.remove();
  }
  $("queueEmpty").textContent = queue.length || pending ? "" :
    anyEnabled ? "No more films in this queue." : "Select a film source to build your queue.";
  fitQueuePreview();
}

export function initQueue() {
  window.addEventListener("resize", fitQueuePreview);
  new ResizeObserver(fitQueuePreview).observe($("queue").closest("main").querySelector(".sources"));
}
