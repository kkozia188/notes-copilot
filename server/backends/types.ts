export type ChatTurn = { role: "user" | "assistant"; content: string };

/** Events streamed to the browser as NDJSON. */
export type ChatEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "done"; costUsd?: number; durationMs?: number }
  | { type: "error"; message: string; code?: "session_lost" | "auth" };

export type ChatInput = {
  /** Repo-relative note path; the conversation is scoped to this chapter. */
  notePath?: string;
  /** System prompt including the current note. Stable per chapter → cache friendly. */
  system: string;
  /** Full visible history, last item is the new user turn. */
  messages: ChatTurn[];
  /** CLI session to resume (CLI backend only). */
  sessionId?: string;
};

export type Backend = {
  name: "codex" | "cli" | "api";
  run(input: ChatInput, emit: (e: ChatEvent) => Promise<void>, signal: AbortSignal): Promise<void>;
};
