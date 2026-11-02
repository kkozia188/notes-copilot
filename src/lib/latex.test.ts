import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../components/Markdown";
import { normalizeMathBlocks } from "./latex";

const render = (markdown: string) => renderToStaticMarkup(createElement(Markdown, { markdown }));

test("multi-line equations keep their opening command and leave following prose outside math", () => {
  const markdown = String.raw`前文
$$\begin{pmatrix}
x \\
y \\
\theta
\end{pmatrix}_k = \boldsymbol{x}_{k-1}$$
学过现代控制理论的同学可以继续阅读。
`;
  const html = render(markdown);
  assert(!html.includes("katex-error"));
  assert(html.includes("<p>学过现代控制理论的同学可以继续阅读。</p>"));
  assert(html.includes('class="katex-display"'));
  assert(normalizeMathBlocks(markdown).includes("$$\n\\begin{pmatrix}"));
});

test("inline formulas, prices and escaped dollars retain their original meaning", () => {
  const markdown = String.raw`使用 $$x_k$$ 和 $y_k$，价格为 \$20，字面分隔符是 \$$。`;
  assert.equal(normalizeMathBlocks(markdown), markdown);
});

test("a row break before the closing dollars is not treated as an escaped dollar", () => {
  const markdown = String.raw`$$u = x \\
v = y \\$$
普通正文`;
  const html = render(markdown);
  assert(!html.includes("katex-error"));
  assert(html.includes("<p>普通正文</p>"));
});

test("fenced code, long backtick spans and unterminated code fences are unchanged", () => {
  const examples = [
    '```latex\n$$\\begin{matrix}\nx\n\\end{matrix}$$\n```\n',
    '~~~latex\n$$x\ny$$\n~~~\n',
    '````md\n```latex\n$$x\ny$$\n```\n````\n',
    '代码 ``公式 `$$x\ny$$` 不渲染``。',
    '```latex\n$$x\ny$$\n',
  ];
  for (const markdown of examples) assert.equal(normalizeMathBlocks(markdown), markdown);
});

test("empty formula placeholders do not consume subsequent paragraphs", () => {
  const html = render("主动变换\n\n$$$$\n\n普通正文\n\n$$x^2$$");
  assert(!html.includes("katex-error"));
  assert(html.includes("<p>普通正文</p>"));
});

test("existing standalone display equations are stable across repeated normalization", () => {
  const markdown = "前文\n\n$$\nx+y\n$$\n\n后文";
  const normalized = normalizeMathBlocks(markdown);
  assert.equal(normalizeMathBlocks(normalized), normalized);
  assert.equal(normalized, markdown);
});

test("the actual SLAM theory chapter renders without KaTeX errors", async () => {
  const markdown = await readFile(new URL("../../notes/03_SLAM/10_SLAM理论/10_SLAM理论基础.md", import.meta.url), "utf8");
  const html = render(markdown);
  assert(!html.includes('class="katex-error"'));
  assert(html.includes("<p>学过现代控制理论"));
  assert.equal(normalizeMathBlocks(normalizeMathBlocks(markdown)), normalizeMathBlocks(markdown));
});
