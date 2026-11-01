/**
 * Text-quote anchoring (same idea as W3C Web Annotation TextQuoteSelector / Hypothesis):
 * store the exact text plus a little surrounding context and the character offset,
 * so highlights survive when the upstream notes are edited.
 */
export type TextAnchor = {
  exact: string;
  prefix: string;
  suffix: string;
  /** Character offset in the container's text content when the anchor was created (a hint only). */
  start: number;
  /** Heading the anchor sits under, for display. */
  heading?: string;
};

const CONTEXT = 32;

function offsetOf(root: Node, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(root);
  r.setEnd(node, offset);
  return r.toString().length;
}

export function describeRange(root: HTMLElement, range: Range, heading?: string): TextAnchor {
  const text = root.textContent ?? "";
  const start = offsetOf(root, range.startContainer, range.startOffset);
  const end = offsetOf(root, range.endContainer, range.endOffset);
  return {
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
    start,
    heading,
  };
}

function commonSuffixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefixLen(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Find the best match for the anchor in the current text; returns [start, end] or null. */
function locate(text: string, a: TextAnchor): [number, number] | null {
  if (!a.exact) return null;
  if (text.slice(a.start, a.start + a.exact.length) === a.exact &&
      text.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix) {
    return [a.start, a.start + a.exact.length];
  }
  let best: [number, number] | null = null;
  let bestScore = -Infinity;
  for (let i = text.indexOf(a.exact); i !== -1; i = text.indexOf(a.exact, i + 1)) {
    const before = text.slice(Math.max(0, i - a.prefix.length), i);
    const after = text.slice(i + a.exact.length, i + a.exact.length + a.suffix.length);
    const score =
      commonSuffixLen(before, a.prefix) + commonPrefixLen(after, a.suffix) -
      Math.abs(i - a.start) / 10_000;
    if (score > bestScore) {
      bestScore = score;
      best = [i, i + a.exact.length];
    }
  }
  return best;
}

function rangeFromOffsets(root: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let pos = 0;
  let startSet = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = (n as Text).length;
    if (!startSet && start <= pos + len) {
      range.setStart(n, start - pos);
      startSet = true;
    }
    if (startSet && end <= pos + len) {
      range.setEnd(n, end - pos);
      return range;
    }
    pos += len;
  }
  return null;
}

export function anchorToRange(root: HTMLElement, a: TextAnchor): Range | null {
  const hit = locate(root.textContent ?? "", a);
  return hit ? rangeFromOffsets(root, hit[0], hit[1]) : null;
}
