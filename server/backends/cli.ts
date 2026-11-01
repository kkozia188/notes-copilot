import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Backend, ChatTurn } from "./types";

/**
 * Runs the locally installed Claude Code CLI in headless mode (`claude -p`), using the
 * user's own Claude login. Tools are restricted to read-only file access inside the notes dir.
 */
export function cliBackend(opts: { notesDir: string; bin: string; model?: string; effort: string }): Backend {
  // Never pass through credentials/session vars from a parent Claude Code or from .env:
  // the CLI should use the user's own login.
  const childEnv = () => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k.startsWith("ANTHROPIC_") || k.startsWith("CLAUDE_CODE_") || k === "CLAUDECODE" || k.startsWith("CLAUDE_")) {
        delete env[k];
      }
    }
    return env;
  };

  const toolDetail = (name: string, input: Record<string, unknown>) => {
    const raw = String(input.file_path ?? input.pattern ?? input.path ?? "");
    const rel = raw.startsWith(opts.notesDir) ? raw.slice(opts.notesDir.length + 1) : raw;
    return name === "Grep" && input.path ? `${input.pattern}  ·  ${String(input.path).replace(opts.notesDir + "/", "")}` : rel;
  };

  /** When a session can't be resumed, replay the visible history as text. */
  const withTranscript = (messages: ChatTurn[]) => {
    const prev = messages.slice(0, -1);
    const last = messages[messages.length - 1].content;
    if (!prev.length) return last;
    const t = prev.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n");
    return `以下是我们在本章之前的对话记录：\n<history>\n${t}\n</history>\n\n${last}`;
  };

  return {
    name: "cli",
    async run(input, emit, signal) {
      const dir = await mkdtemp(path.join(tmpdir(), "notes-copilot-"));
      const sysFile = path.join(dir, "system.md");
      await writeFile(sysFile, input.system);
      const prompt = input.sessionId ? input.messages[input.messages.length - 1].content : withTranscript(input.messages);

      const args = [
        "-p", prompt,
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
        "--system-prompt-file", sysFile,
        "--tools", "Read", "Grep", "Glob",
        "--permission-mode", "dontAsk",
        "--strict-mcp-config",
        "--disable-slash-commands",
        "--effort", opts.effort,
      ];
      if (opts.model) args.push("--model", opts.model);
      if (input.sessionId) args.push("--resume", input.sessionId);

      const child = spawn(opts.bin, args, { cwd: opts.notesDir, env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
      const onAbort = () => child.kill("SIGTERM");
      signal.addEventListener("abort", onAbort);
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      const exited = new Promise<number | null>((res) => {
        child.on("close", res);
        child.on("error", (e) => {
          stderr += String(e);
          res(-1);
        });
      });

      let gotResult = false;
      try {
        for await (const line of createInterface({ input: child.stdout })) {
          if (!line.trim()) continue;
          let o: any;
          try { o = JSON.parse(line); } catch { continue; }

          if (o.type === "system" && o.subtype === "init") {
            await emit({ type: "session", id: o.session_id });
          } else if (o.type === "stream_event") {
            const ev = o.event;
            if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              await emit({ type: "text", text: ev.delta.text });
            }
          } else if (o.type === "assistant") {
            for (const b of o.message?.content ?? []) {
              if (b.type === "tool_use") await emit({ type: "tool", name: b.name, detail: toolDetail(b.name, b.input ?? {}) });
            }
          } else if (o.type === "result") {
            gotResult = true;
            if (o.is_error) {
              const msg = (o.errors ?? []).join("; ") || o.result || "Claude CLI 运行出错";
              await emit({ type: "error", message: msg, code: /No conversation found/i.test(msg) ? "session_lost" : undefined });
            } else {
              await emit({ type: "done", costUsd: o.total_cost_usd, durationMs: o.duration_ms });
            }
          }
        }
        const code = await exited;
        if (!gotResult && !signal.aborted) {
          const hint = /ENOENT/.test(stderr)
            ? `找不到 Claude Code（${opts.bin}）。请先安装并运行一次 claude 完成登录，或用 NOTES_COPILOT_CLAUDE_BIN 指定路径。`
            : /log ?in|auth|credential/i.test(stderr)
              ? "Claude Code 未登录：在终端运行 claude 并完成 /login。"
              : `Claude CLI 退出（code ${code}）：${stderr.trim().slice(-400)}`;
          await emit({ type: "error", message: hint, code: /log ?in|auth/i.test(stderr) ? "auth" : undefined });
        }
      } finally {
        signal.removeEventListener("abort", onAbort);
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
