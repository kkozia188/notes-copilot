import Anthropic from "@anthropic-ai/sdk";
import type { Backend } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function apiBackend(opts: { apiKey?: string; model: string; effort: Effort }): Backend {
  // Only the key from .env: ignore ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL inherited from other tools.
  const client = new Anthropic({ apiKey: opts.apiKey ?? null, authToken: null, baseURL: "https://api.anthropic.com" });

  return {
    name: "api",
    async run(input, emit, signal) {
      if (!opts.apiKey) {
        await emit({
          type: "error",
          code: "auth",
          message: "未配置 API Key：在 .env 写入 ANTHROPIC_API_KEY=sk-ant-...，或设置 NOTES_COPILOT_BACKEND=cli 使用本机 Claude Code 登录。",
        });
        return;
      }
      try {
        const s = client.beta.messages.stream({
          model: opts.model,
          max_tokens: 64000,
          thinking: { type: "adaptive" },
          output_config: { effort: opts.effort },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          // Stable per chapter → cached across turns.
          system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
          messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
        });
        signal.addEventListener("abort", () => s.abort());
        for await (const ev of s) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            await emit({ type: "text", text: ev.delta.text });
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") await emit({ type: "error", message: "模型拒绝回答该请求。" });
        else if (final.stop_reason === "max_tokens") await emit({ type: "error", message: "回答过长被截断。" });
        await emit({ type: "done" });
      } catch (err) {
        if (signal.aborted) return;
        await emit(
          err instanceof Anthropic.AuthenticationError
            ? { type: "error", code: "auth", message: "API Key 无效（检查 .env 中的 ANTHROPIC_API_KEY）" }
            : err instanceof Anthropic.RateLimitError
              ? { type: "error", message: "触发速率限制，请稍后再试" }
              : err instanceof Anthropic.APIError
                ? { type: "error", message: `API 错误 ${err.status ?? ""}: ${err.message}` }
                : { type: "error", message: String(err) },
        );
      }
    },
  };
}
