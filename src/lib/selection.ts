/** Selection helpers that understand KaTeX-rendered math. */

function closestKatex(node: Node): Element | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return el?.closest(".katex-display, .katex") ?? null;
}

/** Grow the range so it never cuts a formula in half. */
export function expandToWholeMath(range: Range): Range {
  const r = range.cloneRange();
  const s = closestKatex(r.startContainer);
  if (s) r.setStartBefore(s);
  const e = closestKatex(r.endContainer);
  if (e) r.setEndAfter(e);
  return r;
}

/** Text of the range with formulas turned back into their LaTeX source. */
export function rangeToMarkdown(range: Range): string {
  const div = document.createElement("div");
  div.appendChild(range.cloneContents());
  for (const el of Array.from(div.querySelectorAll(".katex-display"))) {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
    el.replaceWith(`\n$$\n${tex.trim()}\n$$\n`);
  }
  for (const el of Array.from(div.querySelectorAll(".katex"))) {
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? "";
    el.replaceWith(`$${tex.trim()}$`);
  }
  return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Nearest heading at or before the range start, within the article root. */
export function headingFor(root: HTMLElement, range: Range): HTMLElement | null {
  let node: Node | null = range.startContainer;
  while (node && node.parentNode !== root) node = node.parentNode;
  for (let el = node as Element | null; el; el = el.previousElementSibling) {
    if (/^H[1-4]$/.test(el.tagName)) return el as HTMLElement;
  }
  return null;
}

/** Markdown source of the section that starts at the given heading text. */
export function extractSection(markdown: string, heading: string | undefined): string {
  if (!heading) return "";
  const lines = markdown.split("\n");
  const norm = (s: string) => s.replace(/[*_`$\\]/g, "").replace(/\s+/g, "").trim();
  const target = norm(heading);
  const i = lines.findIndex((l) => /^#{1,6}\s/.test(l) && norm(l.replace(/^#+\s*/, "")) === target);
  if (i === -1) return "";
  const level = lines[i].match(/^#+/)![0].length;
  let j = i + 1;
  while (j < lines.length && !(lines[j].match(/^(#+)\s/) && lines[j].match(/^#+/)![0].length <= level)) j++;
  return lines.slice(i, j).join("\n");
}
