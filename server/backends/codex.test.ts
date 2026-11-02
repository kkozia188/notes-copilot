import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { codexBackend } from "./codex";
import type { ChatEvent, ChatInput } from "./types";

const bin = fileURLToPath(new URL("./fixtures/codex-cli.mjs", import.meta.url));
const input: ChatInput = {
  system: "测试导师",
  messages: [
    { role: "user", content: "旧问题" },
    { role: "assistant", content: "旧回答" },
    { role: "user", content: "新问题" },
  ],
};
const sessionId = "codex:11111111-1111-1111-1111-111111111111";
async function run(overrides: Partial<ChatInput> = {}, options: { bin?: string; timeoutMs?: number } = {}) {
  const events: ChatEvent[] = [];
  const backend = codexBackend({ notesDir: process.cwd(), bin, effort: "low", ...options });
  await backend.run({ ...input, ...overrides }, async (event) => { events.push(event); }, new AbortController().signal);
  return events;
}

test("new conversation replays history, maps tool activity, and avoids duplicated snapshots", async () => {
  const events = await run();
  assert.equal(events[0].type, "session");
  assert.equal(events.filter((e) => e.type === "tool").length, 1);
  assert.equal(events.flatMap((e) => e.type === "text" ? [e.text] : []).join(""), "预测与更新");
  assert.equal(events.at(-1)?.type, "done");
});

test("resume passes the exact Codex thread and only the latest question", async () => {
  const events = await run({ sessionId });
  assert.equal(events.at(-1)?.type, "done");
});

test("a Claude session is rejected so the UI can replay its visible history", async () => {
  const events = await run({ sessionId: "a-claude-session" });
  assert.equal(events.length, 1);
  assert(events[0].type === "error" && events[0].code === "session_lost");
});

test("missing remote thread requests a history replay", async () => {
  const events = await run({ sessionId, messages: [{ role: "user", content: "SESSION_LOST" }] });
  const last = events.at(-1);
  assert(last?.type === "error" && last.code === "session_lost");
});

test("authentication errors are actionable and do not emit success", async () => {
  const events = await run({ messages: [{ role: "user", content: "AUTH_ERROR" }] });
  const last = events.at(-1);
  assert(last?.type === "error" && last.code === "auth");
  assert(!events.some((event) => event.type === "done"));
});

test("an absent executable produces a setup hint", async () => {
  const events = await run({}, { bin: "/does-not-exist/notes-copilot-codex" });
  assert(events[0].type === "error" && events[0].message.includes("NOTES_COPILOT_CODEX_BIN"));
});

test("timeout terminates the CLI and reports a retryable error", async () => {
  const events = await run({ messages: [{ role: "user", content: "TIMEOUT" }] }, { timeoutMs: 300 });
  const last = events.at(-1);
  assert(last?.type === "error" && last.message.includes("超时"));
});

test("stop terminates a running CLI without emitting success or an error", async () => {
  const events: ChatEvent[] = [];
  const ac = new AbortController();
  await codexBackend({ notesDir: process.cwd(), bin, effort: "low" }).run(
    { ...input, messages: [{ role: "user", content: "TIMEOUT" }] },
    async (event) => {
      events.push(event);
      if (event.type === "session") ac.abort();
    },
    ac.signal,
  );
  assert.deepEqual(events.map((event) => event.type), ["session"]);
});
