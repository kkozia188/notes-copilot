import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { stream } from "hono/streaming";
import { apiBackend } from "./backends/api";
import { cliBackend } from "./backends/cli";
import type { Backend, ChatEvent, ChatTurn } from "./backends/types";
import { buildSystemPrompt } from "./prompt";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(ROOT, ".env"));
} catch {
  // no .env file — rely on the real environment
}

const NOTES_DIR = path.join(ROOT, "notes");
// App-specific variable names, so settings inherited from other tools (e.g. a Claude Code shell) don't leak in.
const MODEL = process.env.NOTES_COPILOT_MODEL ?? "claude-opus-5-5"; // API backend default; CLI uses its own default unless set
const EFFORT = (process.env.NOTES_COPILOT_EFFORT ?? "medium") as "low" | "medium" | "high" | "xhigh" | "max";
// Whole notes go into the (cached) system prompt; past this size fall back to the selected section only.
const MAX_NOTE_CHARS = 300_000;
const BACKEND = (process.env.NOTES_COPILOT_BACKEND ?? "cli") as "cli" | "api";

const backend: Backend =
  BACKEND === "api"
    ? apiBackend({ apiKey: process.env.ANTHROPIC_API_KEY, model: MODEL, effort: EFFORT })
    : cliBackend({
        notesDir: NOTES_DIR,
        bin: process.env.NOTES_COPILOT_CLAUDE_BIN ?? "claude",
        model: process.env.NOTES_COPILOT_MODEL,
        effort: EFFORT,
      });
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

type ChatRequest = {
  notePath?: string;
  /** Markdown of the section containing the quote, used when the note is too large. */
  section?: string;
  messages: ChatTurn[];
  sessionId?: string;
};

app.get("/api/config", (c) => c.json({ backend: backend.name, model: backend.name === "api" ? MODEL : process.env.NOTES_COPILOT_MODEL ?? null }));

app.post("/api/chat", async (c) => {
  const body = (await c.req.json()) as ChatRequest;
  if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.at(-1)?.role !== "user") {
    return c.json({ error: "messages must end with a user turn" }, 400);
  }
  const abs = body.notePath ? resolveNote(body.notePath) : null;
  const note = abs ? await readFile(abs, "utf8").catch(() => "") : "";
  const system = buildSystemPrompt({
    notePath: body.notePath,
    note: note.length <= MAX_NOTE_CHARS ? note : `（全文过长，仅提供相关小节）\n\n${body.section ?? ""}`,
    canBrowse: backend.name === "cli",
  });

  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  return stream(c, async (out) => {
    const ac = new AbortController();
    out.onAbort(() => ac.abort());
    const emit = (e: ChatEvent) => out.write(JSON.stringify(e) + "\n").then(() => undefined);
    await backend.run({ notePath: body.notePath, system, messages: body.messages, sessionId: body.sessionId }, emit, ac.signal);
  });
});

// Production: serve the built frontend.
app.use("/*", serveStatic({ root: "./dist" }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on http://localhost:${port}  (backend: ${backend.name}, effort: ${EFFORT})`);
  if (backend.name === "api" && !process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠ ANTHROPIC_API_KEY 未设置：请在 .env 中配置，或改用 NOTES_COPILOT_BACKEND=cli。");
  }
});
