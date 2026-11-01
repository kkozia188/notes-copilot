/**
 * Normalise math delimiters in model output so remark-math can render them:
 * \( .. \) → $..$, \[ .. \] → $$..$$. Code spans/blocks are left untouched.
 * (Idea from HKUDS/DeepTutor web/lib/latex-normalize.ts, Apache-2.0; simplified rewrite.)
 */
export function normalizeMath(md: string): string {
  const masks: string[] = [];
  const masked = md.replace(/```[\s\S]*?(```|$)|`[^`\n]*`/g, (m) => {
    masks.push(m);
    return `\u0000${masks.length - 1}\u0000`;
  });
  const out = masked
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => masks[Number(i)]);
}
