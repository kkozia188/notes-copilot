import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { parse } from "smol-toml";
import type { Backend, ChatEvent, ChatTurn } from "./types";

export type CodexSettings = { model?: string; mcpServers: string[] };

/** Keep the user's provider/login, while disabling unrelated MCP integrations for this app. */
export async function readCodexSettings(): Promise<CodexSettings> {
  const home = process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
  try {
    const config = parse(await readFile(path.join(home, "config.toml"), "utf8"));
    return {
      model: typeof config.model === "string" ? config.model : undefined,
      mcpServers: Object.keys(config.mcp_servers ?? {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mcpServers: [] };
    throw new Error("无法读取 Codex 配置，请检查 CODEX_HOME/config.toml。", { cause: error });
  }
}

export function transcript(messages: ChatTurn[]): string {
  return messages.map((m) => `<${m.role}>\n${m.content}\n</${m.role}>`).join("\n\n");
}

type CodexItem = { id: string; type: string; text?: string; command?: string };
type CodexEvent = {
  type: string;
  thread_id?: string;
  item?: CodexItem;
  error?: { message?: string };
  message?: string;
};

/** Codex emits text snapshots, sometimes both updated and completed; only send new text. */
export function codexEventMapper() {
  const texts = new Map<string, string>();
  const tools = new Set<string>();
  return (event: CodexEvent): ChatEvent[] => {
    if (event.type === "thread.started" && event.thread_id) {
      return [{ type: "session", id: `codex:${event.thread_id}` }];
    }
    const item = event.item;
    if (!item) return [];
    if (item.type === "agent_message" && typeof item.text === "string") {
      const before = texts.get(item.id) ?? "";
      const text = item.text.startsWith(before) ? item.text.slice(before.length) : item.text;
      texts.set(item.id, item.text);
      return text ? [{ type: "text", text }] : [];
    }
    if (item.type === "command_execution" && !tools.has(item.id)) {
      tools.add(item.id);
      return [{ type: "tool", name: "查阅笔记", detail: item.command ?? "读取相关章节" }];
    }
    return [];
  };
}

export function codexBackend(opts: {
  notesDir: string;
  bin: string;
  model?: string;
  effort: string;
  timeoutMs?: number;
}): Backend {
  return {
    name: "codex",
    async run(input, emit, signal) {
      if (signal.aborted) return;
      // Prefix sessions so switching from Claude cannot resume an unrelated conversation.
      if (input.sessionId && !/^codex:[0-9a-f-]{36}$/i.test(input.sessionId)) {
        await emit({ type: "error", code: "session_lost", message: "会话属于其他后端，将根据当前对话重新开始。" });
        return;
      }
      const started = Date.now();
      const dir = await mkdtemp(path.join(tmpdir(), "notes-copilot-codex-"));
      try {
        const instructionsFile = path.join(dir, "instructions.md");
        await writeFile(instructionsFile, input.system + "\n\n你是只读学习导师。只允许查阅笔记并回答问题。禁止修改文件、安装软件、联网或启动其他代理。", { mode: 0o600 });
        const config = await readCodexSettings();
        const args = ["exec"];
        if (input.sessionId) args.push("resume");
        args.push(
          "--json",
          "-c", 'sandbox_mode="read-only"',
          "-c", 'approval_policy="never"',
          "-c", 'web_search="disabled"',
          "-c", "project_doc_max_bytes=0",
          "-c", `model_instructions_file=${JSON.stringify(instructionsFile)}`,
          "-c", `model_reasoning_effort=${JSON.stringify(opts.effort)}`,
        );
        for (const feature of ["hooks", "apps", "plugins", "multi_agent", "multi_agent_v2", "browser_use", "computer_use", "image_generation", "memories"]) {
          args.push("--disable", feature);
        }
        for (const name of config.mcpServers) {
          if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Codex MCP 名称不支持命令行覆盖：${name}`);
          args.push("-c", `mcp_servers.${name}.enabled=false`);
        }
        if (opts.model) args.push("--model", opts.model);
        if (input.sessionId) args.push(input.sessionId.slice("codex:".length));
        args.push("-"); // stdin supports long questions/history without shell quoting or argv limits.

        const grouped = process.platform !== "win32";
        const child = spawn(opts.bin, args, { cwd: opts.notesDir, env: process.env, detached: grouped, stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        let spawnError: Error | undefined;
        let timedOut = false;
        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const kill = (sig: NodeJS.Signals) => {
          try {
            if (grouped && child.pid) process.kill(-child.pid, sig);
            else child.kill(sig);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
          }
        };
        const stop = () => {
          kill("SIGTERM");
          killTimer ??= setTimeout(() => kill("SIGKILL"), 2_000);
          killTimer.unref();
        };
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
        const timeout = setTimeout(() => { timedOut = true; stop(); }, opts.timeoutMs ?? 180_000);
        timeout.unref();
        child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
        child.stdin.on("error", () => {}); // An early CLI exit can close stdin before the prompt is sent.
        const exited = new Promise<number | null>((resolve) => {
          child.once("error", (error) => { spawnError = error; });
          child.once("close", resolve);
        });
        child.stdin.end(input.sessionId ? input.messages.at(-1)!.content : transcript(input.messages));
        const map = codexEventMapper();
        let completed = false;
        let failure: string | undefined;
        try {
          for await (const line of createInterface({ input: child.stdout })) {
            if (signal.aborted) continue;
            let event: CodexEvent;
            try { event = JSON.parse(line); } catch { continue; }
            for (const mapped of map(event)) await emit(mapped);
            if (event.type === "turn.completed") completed = true;
            if (event.type === "turn.failed") failure = event.error?.message ?? "Codex 本轮对话失败";
            if (event.type === "error") failure = event.message ?? event.error?.message ?? "Codex 运行出错";
          }
          const code = await exited;
          if (signal.aborted) return;
          if (completed && code === 0 && !timedOut) {
            await emit({ type: "done", durationMs: Date.now() - started });
            return;
          }
          const details = failure ?? spawnError?.message ?? stderr.trim();
          const lost = /no (?:conversation|session|thread)|not found.*(?:session|thread)|(?:session|thread).*not found/i.test(details);
          const auth = /unauthorized|not logged in|authentication|invalid api key|401/i.test(details);
          const message = timedOut
            ? "Codex 响应超时，请稍后重试。"
            : (spawnError as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
              ? `找不到 Codex CLI（${opts.bin}）。请安装 @openai/codex，或设置 NOTES_COPILOT_CODEX_BIN。`
              : auth
                ? "Codex 登录已失效，请在终端运行 codex login 后重试。"
                : `Codex CLI 退出（code ${code}）：${details.slice(-800) || "没有返回有效回答"}`;
          await emit({ type: "error", message, code: lost ? "session_lost" : auth ? "auth" : undefined });
        } finally {
          signal.removeEventListener("abort", stop);
          clearTimeout(timeout);
          // If the client disconnected while an event was being written, stop the whole CLI group.
          if (child.exitCode === null && child.signalCode === null) {
            stop();
            await exited;
          }
          if (killTimer) clearTimeout(killTimer);
        }
      } catch (error) {
        if (!signal.aborted) await emit({ type: "error", message: (error as Error).message });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
