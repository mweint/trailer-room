// DOM helpers shared by every module: element lookup and element construction.
export const $ = id => document.getElementById(id);

export const el = (tag, cls, content) => {
  const node = document.createElement(tag);
  if (cls) {
    node.className = cls;
  }
  if (content !== undefined) {
    node.textContent = content;
  }
  return node;
};

// Motion for show and hide. Every element that opens, closes, appears or disappears in place goes through
// expand() or reveal(), so the rule in DESIGN.md is applied in one place. Timings come from the CSS tokens.
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Content entering or leaving (opening, closing, appearing) eases out; an item moving to a new place eases in and out.
function timing(opening, moving = false) {
  return {
    duration: parseFloat(token(opening ? "--motion-layout" : "--motion-layout-exit")),
    easing: token(moving ? "--ease-in-out" : "--ease-out")
  };
}

// Animates a node's height across change(), starting from wherever an interrupted animation left it.
// fade also fades the content in or out; while closing it stays visible until the motion ends.
// Used directly when a region's own content grows or shrinks (a chip group showing more chips).
export function resize(node, change, opening, fade = false) {
  const from = node.getBoundingClientRect().height;
  node.getAnimations().forEach(animation => animation.cancel());
  change();
  const to = node.getBoundingClientRect().height;
  if (still() || Math.abs(from - to) <= .5) {
    return;
  }
  // The closed state's max-height would cap the animated height, so it is lifted while the motion runs.
  const frames = {height: [from + "px", to + "px"], maxHeight: ["none", "none"]};
  if (fade) {
    frames.opacity = opening ? [0, 1] : [1, 0];
    frames.visibility = ["visible", "visible"];
  }
  node.animate(frames, timing(opening));
}

// A collapsible region (.collapse) controlled by a toggle button through aria-controls.
export function expand(toggle, expanded, animate = true) {
  const region = document.getElementById(toggle.getAttribute("aria-controls"));
  const change = () => {
    toggle.setAttribute("aria-expanded", String(expanded));
    region.toggleAttribute("data-collapsed", !expanded);
  };
  if (animate) {
    resize(region, change, expanded, !region.classList.contains("collapse--preview"));
  } else {
    change();
  }
}

// Shows or hides a node (.collapse) that has no toggle of its own, growing or shrinking it in place.
export function reveal(node, shown) {
  if (node.hidden !== shown) {
    return;
  }
  if (shown) {
    resize(node, () => {
      node.hidden = false;
    }, true, true);
    return;
  }
  const from = node.getBoundingClientRect().height;
  node.getAnimations().forEach(animation => animation.cancel());
  if (still()) {
    node.hidden = true;
    return;
  }
  const closing = node.animate({height: [from + "px", "0px"], opacity: [1, 0]}, timing(false));
  closing.onfinish = () => {
    node.hidden = true;
  };
}

// Overlay motion for <dialog>: a sheet slides in from its edge, a centred dialog grows from 95%; both fade, with the
// backdrop. Closing runs the same motion in reverse, faster, then closes. Esc and a click on the backdrop close too.
function overlayFrames(dialog) {
  if (still()) {
    return {opacity: [0, 1]};
  }
  return dialog.classList.contains("dialog--sheet") ?
    {opacity: [0, 1], transform: ["translateX(100%)", "none"]} :
    {opacity: [0, 1], transform: ["scale(.95)", "none"]};
}

export function openDialog(dialog) {
  // Reopening while it closes: drop the closing motion and open from where it is.
  if (dialog.dataset.closing !== undefined) {
    delete dialog.dataset.closing;
    dialog.getAnimations({subtree: true}).forEach(animation => animation.cancel());
  } else if (dialog.open) {
    return;
  } else {
    dialog.showModal();
  }
  const time = timing(true);
  dialog.animate(overlayFrames(dialog), time);
  dialog.animate({opacity: [0, 1]}, {...time, pseudoElement: "::backdrop"});
}

export function closeDialog(dialog) {
  if (!dialog.open || dialog.dataset.closing !== undefined) {
    return;
  }
  dialog.dataset.closing = "";
  const time = {...timing(false), direction: "reverse", fill: "forwards"};
  const closing = dialog.animate(overlayFrames(dialog), time);
  const backdrop = dialog.animate({opacity: [0, 1]}, {...time, pseudoElement: "::backdrop"});
  // Both hold their last frame until the dialog is closed, then are cancelled so the next opening starts clean.
  closing.onfinish = () => {
    delete dialog.dataset.closing;
    dialog.close();
    closing.cancel();
    backdrop.cancel();
  };
}

export function dismissible(dialog) {
  dialog.addEventListener("cancel", event => {
    event.preventDefault();
    closeDialog(dialog);
  });
  // The backdrop belongs to the dialog element, so a click counts as outside only by position.
  dialog.addEventListener("click", event => {
    const box = dialog.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right &&
      event.clientY >= box.top && event.clientY <= box.bottom;
    if (event.target === dialog && !inside) {
      closeDialog(dialog);
    }
  });
}

// List motion: note where a list's items are, change the list, then glide() moves each item that stayed
// from its old place to its new one and fades in the items that are new.
export function places(items) {
  return new Map(Array.from(items, item => [item, item.getBoundingClientRect().top]));
}

export function glide(items, before) {
  if (still()) {
    return;
  }
  for (const item of items) {
    const top = before.get(item);
    if (top === undefined) {
      item.animate({opacity: [0, 1]}, timing(true));
      continue;
    }
    const offset = top - item.getBoundingClientRect().top;
    if (Math.abs(offset) > .5) {
      item.animate({transform: [`translateY(${offset}px)`, "none"]}, timing(true, true));
    }
  }
}

// Put one external link inside a heading, reusing the existing anchor when it is unchanged.
export function headingLink(heading, {href, text, title}) {
  const link = heading.firstElementChild || el("a");
  if (link.href !== href || link.textContent !== text) {
    link.href = href;
    link.textContent = text;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = title;
    link.setAttribute("aria-label", text + " — " + title);
  }
  if (!link.parentNode) {
    heading.replaceChildren(link);
  }
}
