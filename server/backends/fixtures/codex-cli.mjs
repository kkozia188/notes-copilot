#!/usr/bin/env node
// Deterministic stand-in for the CLI process: exercises the real stdin/JSONL/exit boundary.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const args = process.argv.slice(2);
let prompt = "";
for await (const chunk of process.stdin) prompt += chunk;
assert.equal(args[0], "exec");
assert.equal(args.at(-1), "-");
assert(args.includes('sandbox_mode="read-only"'));
assert(args.includes('approval_policy="never"'));
for (const arg of args.filter((value) => value.startsWith("mcp_servers."))) {
  assert.match(arg, /^mcp_servers\.[A-Za-z0-9_-]+\.enabled=false$/);
}
const fileArg = args.find((a) => a.startsWith("model_instructions_file="));
const instructions = await readFile(JSON.parse(fileArg.slice(fileArg.indexOf("=") + 1)), "utf8");
assert(instructions.includes("测试导师"));
const out = (value) => console.log(JSON.stringify(value));
if (prompt.includes("TIMEOUT")) {
  out({ type: "thread.started", thread_id: "11111111-1111-1111-1111-111111111111" });
  setInterval(() => {}, 1000);
} else if (prompt.includes("AUTH_ERROR")) {
  out({ type: "turn.failed", error: { message: "401 Unauthorized: invalid API key" } });
  process.exitCode = 1;
} else if (prompt.includes("SESSION_LOST")) {
  out({ type: "error", message: "No conversation found for session id" });
  process.exitCode = 1;
} else {
  if (args[1] === "resume") {
    assert(args.includes("11111111-1111-1111-1111-111111111111"));
    assert(!prompt.includes("旧问题"));
  } else {
    assert(prompt.includes("旧问题"));
    assert(prompt.includes("旧回答"));
  }
  out({ type: "thread.started", thread_id: "11111111-1111-1111-1111-111111111111" });
  out({ type: "item.started", item: { id: "tool-1", type: "command_execution", command: "rg 贝叶斯 ." } });
  out({ type: "item.completed", item: { id: "tool-1", type: "command_execution", command: "rg 贝叶斯 ." } });
  out({ type: "item.updated", item: { id: "answer", type: "agent_message", text: "预测" } });
  out({ type: "item.completed", item: { id: "answer", type: "agent_message", text: "预测与更新" } });
  out({ type: "turn.completed", usage: { input_tokens: 42, output_tokens: 8 } });
}
