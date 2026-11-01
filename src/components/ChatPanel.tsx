import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import type { AskPayload } from "./NoteView";
import { fetchConfig, streamChat, type ChatEvent, type ChatTurn } from "../lib/api";
import type { TextAnchor } from "../lib/anchor";
import {
  answerText, clearConversation, getConversation, updateConversation, useChattedNotes, useConversation,
  type AssistantTurn, type Part, type UserTurn,
} from "../lib/chats";
import { normalizeMath } from "../lib/latex";

type Props = {
  notePath: string;
  /** Latest "ask about this passage" request from the note view; nonce makes repeats distinct. */
  ask: (AskPayload & { nonce: number }) | null;
  onPin: (notePath: string, anchor: TextAnchor, quote: string | undefined, text: string) => void;
  onJump: (notePath: string, anchor: TextAnchor) => void;
  onNavigate: (path: string) => void;
};

const STARTERS = [
  { icon: "📋", label: "概括本章", prompt: "用 5 个要点概括本章的核心内容，并说明它们之间的逻辑关系。" },
  { icon: "🧭", label: "前置知识", prompt: "学习本章需要哪些前置知识？笔记库里哪些章节讲了它们？请给出链接。" },
  { icon: "❓", label: "出题考我", prompt: "针对本章出 3 道能区分「会用」和「会背」的题。先只出题，等我作答后再批改。" },
  { icon: "⚠️", label: "易错点", prompt: "本章最容易误解或混淆的 3 个地方是什么？各用一个例子说明。" },
];

const chapterTitle = (p: string) => (p.split("/").pop() ?? p).replace(/\.md$/, "").replace(/^\d+_/, "");

/** What the model sees for a user turn: quote + question. */
const toModel = (t: UserTurn | AssistantTurn): ChatTurn =>
  t.role === "user"
    ? { role: "user", content: t.quote ? `<quote>\n${t.quote}\n</quote>\n\n${t.content}` : t.content }
    : { role: "assistant", content: answerText(t) };

// Streams keep running when the user switches chapters; track them outside React state.
const running = new Map<string, AbortController>();

export function ChatPanel({ notePath, ask, onPin, onJump, onNavigate }: Props) {
  const conv = useConversation(notePath);
  const chatted = useChattedNotes();
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  const [pending, setPending] = useState<AskPayload | null>(null);
  const [input, setInput] = useState("");
  const [backend, setBackend] = useState<{ backend: "cli" | "api"; model: string | null } | null>(null);
  const [showChats, setShowChats] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = running.has(notePath);

  useEffect(() => { fetchConfig().then(setBackend).catch(() => {}); }, []);

  // Pending quote belongs to the chapter it came from.
  useEffect(() => { if (pending && pending.notePath !== notePath) setPending(null); }, [notePath]); // eslint-disable-line

  // Stick to bottom while streaming, unless the user scrolled up.
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [conv]);
  useLayoutEffect(() => { stick.current = true; }, [notePath]);

  useEffect(() => {
    if (!ask) return;
    if (ask.preset) void send(ask.preset, ask);
    else { setPending(ask); inputRef.current?.focus(); }
  }, [ask?.nonce]); // eslint-disable-line

  // Auto-grow the textarea.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  async function send(text: string, ctx: AskPayload | null = pending) {
    const path = ctx?.notePath ?? notePath;
    if (!text.trim() || running.has(path)) return;
    const before = getConversation(path);
    const user: UserTurn = { role: "user", content: text.trim(), quote: ctx?.quote, anchor: ctx?.anchor };
    updateConversation(path, (c) => ({
      ...c,
      turns: [...c.turns, user, { role: "assistant", parts: [], pending: true }],
    }));
    setInput("");
    setPending(null);
    stick.current = true;
    const history = [...before.turns, user]
      .filter((t) => t.role === "user" || answerText(t))
      .map(toModel);
    await run(path, history, before.sessionId, ctx?.section);
  }

  async function run(path: string, history: ChatTurn[], sessionId: string | undefined, section?: string, retried = false) {
    const ac = new AbortController();
    running.set(path, ac);
    rerender();
    const patch = (fn: (t: AssistantTurn) => AssistantTurn) =>
      updateConversation(path, (c) => ({
        ...c,
        turns: [...c.turns.slice(0, -1), fn(c.turns[c.turns.length - 1] as AssistantTurn)],
      }));
    let sessionLost = false;
    const onEvent = (e: ChatEvent) => {
      switch (e.type) {
        case "session":
          updateConversation(path, (c) => ({ ...c, sessionId: e.id }));
          break;
        case "text":
          patch((t) => {
            const last = t.parts[t.parts.length - 1];
            const parts: Part[] =
              last?.kind === "text"
                ? [...t.parts.slice(0, -1), { kind: "text", text: last.text + e.text }]
                : [...t.parts, { kind: "text", text: e.text }];
            return { ...t, parts };
          });
          break;
        case "tool":
          patch((t) => ({ ...t, parts: [...t.parts, { kind: "tool", name: e.name, detail: e.detail }] }));
          break;
        case "done":
          patch((t) => ({ ...t, durationMs: e.durationMs }));
          break;
        case "error":
          if (e.code === "session_lost" && !retried) sessionLost = true;
          else patch((t) => ({ ...t, error: e.message }));
      }
    };
    try {
      await streamChat({ notePath: path, section, sessionId, messages: history }, onEvent, ac.signal);
    } catch (err) {
      if (!ac.signal.aborted) patch((t) => ({ ...t, error: (err as Error).message }));
    } finally {
      running.delete(path);
      patch((t) => ({ ...t, pending: false }));
      rerender();
    }
    if (sessionLost) {
      // The CLI session is gone (e.g. cleaned up) — start a new one, replaying the visible history.
      updateConversation(path, (c) => ({ ...c, sessionId: undefined }));
      patch((t) => ({ ...t, parts: [], pending: true }));
      await run(path, history, undefined, section, true);
    }
  }

  const turns = conv.turns;
  const lastIdx = turns.length - 1;

  return (
    <div className="chat">
      <header className="chat-header">
        <div className="chat-title">
          <span className="spark">✻</span>
          <div className="chat-title-text">
            <div className="chat-chapter" title={notePath}>{chapterTitle(notePath)}</div>
            <div className="chat-sub">本章对话{turns.length ? ` · ${Math.ceil(turns.length / 2)} 轮` : ""}</div>
          </div>
        </div>
        <div className="chat-header-actions">
          <div className="dropdown">
            <button className="ghost" onClick={() => setShowChats((v) => !v)} disabled={!chatted.length}>
              其他章节 {chatted.length > 0 && <span className="count">{chatted.length}</span>}
            </button>
            {showChats && (
              <div className="dropdown-menu" onMouseLeave={() => setShowChats(false)}>
                {chatted.map((p) => (
                  <div key={p} className={`dropdown-item ${p === notePath ? "on" : ""}`}
                    onClick={() => { onNavigate(p); setShowChats(false); }} title={p}>
                    <span>{chapterTitle(p)}</span>
                    <span className="muted">{Math.ceil(getConversation(p).turns.length / 2)} 轮</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="ghost"
            title="清空本章对话"
            disabled={busy || turns.length === 0}
            onClick={() => confirm("清空本章的对话记录？") && clearConversation(notePath)}
          >
            新对话
          </button>
        </div>
      </header>

      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {turns.length === 0 ? (
          <div className="chat-welcome">
            <div className="welcome-spark">✻</div>
            <h2>这一章想从哪里开始？</h2>
            <p>我已经读过「{chapterTitle(notePath)}」全文{backend?.backend === "cli" ? "，也能翻阅笔记库里的其他章节" : ""}。
              在左侧选中任意文字，可以直接引用提问。</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s.label} className="starter" onClick={() => void send(s.prompt, null)}>
                  <span>{s.icon}</span>{s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="turns">
            {turns.map((t, i) =>
              t.role === "user" ? (
                <div key={i} className="turn user">
                  {t.quote && (
                    <blockquote className="quote" title="跳转到原文" onClick={() => t.anchor && onJump(notePath, t.anchor)}>
                      <Markdown markdown={t.quote} />
                    </blockquote>
                  )}
                  <div className="bubble">{t.content}</div>
                </div>
              ) : (
                <AssistantMessage
                  key={i}
                  turn={t}
                  streaming={busy && i === lastIdx}
                  canPin={!!(turns[i - 1] as UserTurn | undefined)?.anchor}
                  onPin={() => {
                    const u = turns[i - 1] as UserTurn;
                    onPin(notePath, u.anchor!, u.quote, answerText(t));
                  }}
                  onRetry={i === lastIdx && !busy ? () => {
                    const u = turns[i - 1] as UserTurn;
                    updateConversation(notePath, (c) => ({ ...c, turns: c.turns.slice(0, -2) }));
                    void send(u.content, u.quote && u.anchor ? { quote: u.quote, anchor: u.anchor, notePath, section: "" } : null);
                  } : undefined}
                  onNavigate={onNavigate}
                />
              ),
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <div className="composer">
          {pending && (
            <div className="pending-quote">
              <div className="pending-text">{pending.quote}</div>
              <button className="icon" onClick={() => setPending(null)} title="移除引用">✕</button>
            </div>
          )}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            placeholder={pending ? "针对这段内容提问…" : "问问这一章…"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
          />
          <div className="composer-row">
            <span className="backend-badge" title={backend?.backend === "cli" ? "通过本机 Claude Code 登录运行" : "通过 Anthropic API 运行"}>
              {backend ? (backend.backend === "cli" ? "Claude Code" : `API · ${backend.model}`) : "…"}
            </span>
            <span className="grow" />
            {busy ? (
              <button className="send stop" onClick={() => running.get(notePath)?.abort()} title="停止">■</button>
            ) : (
              <button className="send" onClick={() => void send(input)} disabled={!input.trim()} title="发送 (Enter)">↑</button>
            )}
          </div>
        </div>
        <div className="composer-hint">Enter 发送 · Shift+Enter 换行 · 回答可能出错，请对照笔记核实</div>
      </div>
    </div>
  );
}

function AssistantMessage({ turn, streaming, canPin, onPin, onRetry, onNavigate }: {
  turn: AssistantTurn; streaming: boolean; canPin: boolean;
  onPin: () => void; onRetry?: () => void; onNavigate: (p: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  // Group consecutive tool calls into one collapsible "activity" row.
  const groups: ({ kind: "text"; text: string } | { kind: "tools"; items: Extract<Part, { kind: "tool" }>[] })[] = [];
  for (const p of turn.parts) {
    const last = groups[groups.length - 1];
    if (p.kind === "tool") {
      if (last?.kind === "tools") last.items.push(p);
      else groups.push({ kind: "tools", items: [p] });
    } else groups.push({ kind: "text", text: p.text });
  }
  const text = answerText(turn);
  const lastIsTool = turn.parts[turn.parts.length - 1]?.kind === "tool";

  return (
    <div className="turn assistant">
      <div className={`avatar ${streaming ? "thinking" : ""}`}>✻</div>
      <div className="answer">
        {groups.map((g, i) =>
          g.kind === "tools" ? (
            <ToolGroup key={i} items={g.items} active={streaming && lastIsTool && i === groups.length - 1} onNavigate={onNavigate} />
          ) : (
            <div key={i} className="answer-text">
              <Markdown markdown={normalizeMath(g.text)} notePath="README.md" onNavigate={onNavigate} />
            </div>
          ),
        )}
        {streaming && !text && !lastIsTool && <div className="thinking-label">思考中…</div>}
        {turn.error && <div className="error">⚠ {turn.error}</div>}
        {!streaming && (text || turn.error) && (
          <div className="answer-actions">
            {text && (
              <button className="ghost" onClick={() => {
                void navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              }}>{copied ? "已复制" : "复制"}</button>
            )}
            {text && canPin && <button className="ghost" onClick={onPin}>📌 钉到原文</button>}
            {onRetry && <button className="ghost" onClick={onRetry}>重新回答</button>}
            {turn.durationMs != null && <span className="muted">{(turn.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
    </div>
  );
}

const TOOL_LABEL: Record<string, string> = { Read: "阅读", Grep: "搜索", Glob: "查找文件" };

function ToolGroup({ items, active, onNavigate }: {
  items: Extract<Part, { kind: "tool" }>[]; active: boolean; onNavigate: (p: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const reads = items.filter((t) => t.name === "Read").length;
  const searches = items.length - reads;
  const summary = [searches && `搜索 ${searches} 次`, reads && `阅读 ${reads} 篇笔记`].filter(Boolean).join("，");
  return (
    <div className={`tool-group ${open ? "open" : ""}`}>
      <button className="tool-summary" onClick={() => setOpen(!open)}>
        <span className={`tool-dot ${active ? "active" : ""}`} />
        {active ? "正在查阅笔记库…" : `查阅了笔记库：${summary}`}
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="tool-items">
          {items.map((t, i) => (
            <li key={i}>
              <span className="tool-name">{TOOL_LABEL[t.name] ?? t.name}</span>
              {t.name === "Read" && t.detail.endsWith(".md") ? (
                <a onClick={() => onNavigate(t.detail)}>{t.detail}</a>
              ) : (
                <code>{t.detail}</code>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
