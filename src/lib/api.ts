export type TreeNode = { name: string; path: string; children?: TreeNode[] };
export type ChatTurn = { role: "user" | "assistant"; content: string };

export const fetchTree = (): Promise<TreeNode[]> => fetch("/api/tree").then((r) => r.json());

export async function fetchNote(path: string): Promise<string> {
  const r = await fetch(`/api/note?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error(`无法加载笔记：${path}`);
  return r.text();
}

export type ChatEvent =
  | { type: "session"; id: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "done"; costUsd?: number; durationMs?: number }
  | { type: "error"; message: string; code?: "session_lost" | "auth" };

export type BackendConfig = { backend: "codex" | "cli" | "api"; model: string | null };
export const fetchConfig = (): Promise<BackendConfig> =>
  fetch("/api/config").then((r) => r.json());

/** Stream a chat turn; calls onEvent for each server event. */
export async function streamChat(
  body: { notePath?: string; section?: string; sessionId?: string; messages: ChatTurn[] },
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`请求失败：${res.status}`);
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as ChatEvent);
    }
  }
}
