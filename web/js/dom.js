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
