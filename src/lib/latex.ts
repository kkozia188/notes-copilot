/** Protect fenced code (including ~~~ fences) and variable-length inline code spans. */
function outsideCode(md: string, transform: (text: string) => string): string {
  const code: string[] = [];
  const save = (text: string) => `\u0000CODE${code.push(text) - 1}\u0000`;
  let masked = "";
  let block = "";
  let fence: { char: string; length: number } | undefined;
  for (const line of md.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (fence) {
      block += line;
      if (new RegExp(`^\\s{0,3}${fence.char}{${fence.length},}[ \\t]*\\r?\\n?$`).test(line)) {
        masked += save(block);
        block = "";
        fence = undefined;
      }
    } else {
      const start = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (start) {
        fence = { char: start[1][0], length: start[1].length };
        block = line;
      } else masked += line;
    }
  }
  if (block) masked += save(block);
  masked = masked.replace(/(?<!`)(`+)(?!`)[\s\S]*?\1(?!`)/g, save);
  return transform(masked).replace(/\u0000CODE(\d+)\u0000/g, (_, id) => code[Number(id)]);
}

/**
 * Some notes put the expression on the same line as a display delimiter:
 * $$\\begin{matrix} ... (multiple lines) ... \\end{matrix}$$.
 * remark-math treats the opening-line expression as metadata and only accepts
 * a closing fence on its own line. Give multi-line equations standalone fences.
 * Inline $$x$$ stays inline; the source notes and their annotation text stay intact.
 */
export function normalizeMathBlocks(md: string): string {
  return outsideCode(md, (masked) => {
    // Empty placeholders can otherwise open a four-dollar fence over the following prose.
    const text = masked.replace(/^([ \t]*)\${4}[ \t]*$/gm, "$1");
    const fences = [...text.matchAll(/\$\$/g)].filter((match) => {
      const index = match.index!;
      if (text[index - 1] === "$" || text[index + 2] === "$") return false;
      let slashes = 0;
      for (let i = index - 1; text[i] === "\\"; i--) slashes++;
      return slashes % 2 === 0; // \\$$ is escaped, but a LaTeX row break \\\\$$ closes math.
    });
    let out = "";
    let cursor = 0;
    for (let i = 0; i + 1 < fences.length; i += 2) {
      const start = fences[i].index!;
      const end = fences[i + 1].index! + 2;
      const body = text.slice(start + 2, end - 2);
      const before = text.slice(0, start);
      const after = text.slice(end);
      const lineBefore = before.slice(before.lastIndexOf("\n") + 1);
      const lineAfter = after.split("\n", 1)[0];
      const standalone = !lineBefore.trim() && !lineAfter.trim();
      out += text.slice(cursor, start);
      if (!body.includes("\n") && !standalone) out += text.slice(start, end);
      else {
        const prefix = !before || /\n[ \t]*\n[ \t]*$/.test(before) ? "" : /\n[ \t]*$/.test(before) ? "\n" : "\n\n";
        const suffix = !after || /^[ \t]*\n[ \t]*\n/.test(after) ? "" : /^[ \t]*\n/.test(after) ? "\n" : "\n\n";
        out += `${prefix}$$\n${body.trim()}\n$$${suffix}`;
      }
      cursor = end;
    }
    return out + text.slice(cursor);
  });
}

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
