import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { stream } from "hono/streaming";
import Anthropic from "@anthropic-ai/sdk";

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the real environment
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOTES_DIR = path.join(ROOT, "notes");
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
// Whole notes are sent as cached context; past this size fall back to the selected section only.
const MAX_NOTE_CHARS = 300_000;

const client = new Anthropic();
const app = new Hono();

// ---------- notes ----------

type TreeNode = { name: string; path: string; children?: TreeNode[] };

async function buildTree(dir: string, rel = ""): Promise<TreeNode[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const children = await buildTree(path.join(dir, e.name), relPath);
      if (children.length) nodes.push({ name: e.name, path: relPath, children });
    } else if (e.name.endsWith(".md")) {
      nodes.push({ name: e.name.replace(/\.md$/, ""), path: relPath });
    }
  }
  // Notes are prefixed with numbers like "10_", "110_": sort numerically, README first.
  const key = (n: TreeNode) => (/^readme/i.test(n.name) ? -1 : parseInt(n.name, 10));
  return nodes.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (!Number.isNaN(ka) && !Number.isNaN(kb) && ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function resolveNote(relPath: string): string | null {
  const abs = path.resolve(NOTES_DIR, relPath);
  if (!abs.startsWith(NOTES_DIR + path.sep) || !abs.endsWith(".md")) return null;
  return abs;
}

app.get("/api/tree", async (c) => c.json(await buildTree(NOTES_DIR)));

app.get("/api/note", async (c) => {
  const abs = resolveNote(c.req.query("path") ?? "");
  if (!abs) return c.json({ error: "invalid path" }, 400);
  try {
    return c.text(await readFile(abs, "utf8"));
  } catch {
    return c.json({ error: "not found" }, 404);
  }
});

// ---------- chat ----------

type ChatTurn = { role: "user" | "assistant"; content: string };
type ChatRequest = {
  notePath?: string;
  /** Markdown of the section containing the quote, used when the note is too large. */
  section?: string;
  messages: ChatTurn[];
};

const SYSTEM_PROMPT = `你是一位耐心、严谨的机器人学导师，正在陪用户阅读一套开源的机器人学习笔记（Robotics_Tutorial，作者 Pengfei Guo，CC BY-NC 4.0）。

回答方式：
- 用中文回答，术语可保留英文原文。
- 先给直觉，再给严谨推导；推导要分步，每步说明依据。
- 数学公式用 LaTeX：行内 $...$，独立公式 $$...$$。
- 尽量联系笔记上下文和机器人中的实际例子（SLAM、操作臂、足式机器人、控制等）。
- 如果用户引用了笔记中的一段，围绕这段回答；如果发现笔记本身有错误或不严谨之处，直接指出。
- 不确定的内容要明确说不确定，不要编造文献或 API。`;

app.post("/api/chat", async (c) => {
  const body = (await c.req.json()) as ChatRequest;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: "messages required" }, 400);
  }

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: SYSTEM_PROMPT }];
  const abs = body.notePath ? resolveNote(body.notePath) : null;
  if (abs) {
    const note = await readFile(abs, "utf8").catch(() => "");
    const context =
      note.length <= MAX_NOTE_CHARS
        ? note
        : `（全文过长，仅提供相关小节）\n\n${body.section ?? ""}`;
    system.push({
      type: "text",
      text: `<current_note path="${body.notePath}">\n${context}\n</current_note>`,
      // Stable per note → cached across turns while the user stays on this note.
      cache_control: { type: "ephemeral" },
    });
  }

  const messages: Anthropic.Beta.BetaMessageParam[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  return stream(c, async (out) => {
    const send = (obj: unknown) => out.write(JSON.stringify(obj) + "\n");
    try {
      const s = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages,
      });
      out.onAbort(() => s.abort());
      for await (const event of s) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          await send({ type: "text", text: event.delta.text });
        }
      }
      const final = await s.finalMessage();
      if (final.stop_reason === "refusal") {
        await send({ type: "error", message: "模型拒绝回答该请求。" });
      } else if (final.stop_reason === "max_tokens") {
        await send({ type: "error", message: "回答过长被截断。" });
      }
      await send({ type: "done", usage: final.usage });
    } catch (err) {
      const message =
        err instanceof Anthropic.AuthenticationError
          ? "API Key 无效或未配置（检查 .env 中的 ANTHROPIC_API_KEY）"
          : err instanceof Anthropic.RateLimitError
            ? "触发速率限制，请稍后再试"
            : err instanceof Anthropic.APIError
              ? `API 错误 ${err.status ?? ""}: ${err.message}`
              : String(err);
      await send({ type: "error", message });
    }
  });
});

// Production: serve the built frontend.
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`API listening on http://localhost:${port}`));
