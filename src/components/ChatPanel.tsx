import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import type { AskPayload } from "./NoteView";
import { streamChat, type ChatTurn } from "../lib/api";
import type { TextAnchor } from "../lib/anchor";

type Turn = ChatTurn & {
  /** Quoted passage shown above the user's question. */
  quote?: string;
  anchor?: TextAnchor;
  notePath?: string;
  error?: string;
};

type Props = {
  notePath: string | null;
  /** Latest "ask about this passage" request from the note view; nonce makes repeats distinct. */
  ask: (AskPayload & { nonce: number }) | null;
  onPin: (notePath: string, anchor: TextAnchor, quote: string | undefined, text: string) => void;
  onJump: (notePath: string, anchor: TextAnchor) => void;
};

/** What the model sees for a user turn: quote + question. */
const toModelContent = (t: Turn) => (t.quote ? `<quote>\n${t.quote}\n</quote>\n\n${t.content}` : t.content);

export function ChatPanel({ notePath, ask, onPin, onJump }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<AskPayload | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [turns]);

  useEffect(() => {
    if (!ask) return;
    if (ask.preset) void send(ask.preset, ask);
    else {
      setPending(ask);
      inputRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.nonce]);

  async function send(text: string, ctx: AskPayload | null = pending) {
    if (!text.trim() || busy) return;
    const user: Turn = {
      role: "user",
      content: text.trim(),
      quote: ctx?.quote,
      anchor: ctx?.anchor,
      notePath: ctx?.notePath ?? notePath ?? undefined,
    };
    const history = [...turns.filter((t) => !t.error), user];
    setTurns([...turns, user, { role: "assistant", content: "" }]);
    setInput("");
    setPending(null);
    setBusy(true);

    const ac = new AbortController();
    abortRef.current = ac;
    const patchLast = (fn: (t: Turn) => Turn) =>
      setTurns((ts) => [...ts.slice(0, -1), fn(ts[ts.length - 1])]);
    try {
      await streamChat(
        {
          notePath: user.notePath,
          section: ctx?.section,
          messages: history.map((t) => ({ role: t.role, content: t.role === "user" ? toModelContent(t) : t.content })),
        },
        (chunk) => patchLast((t) => ({ ...t, content: t.content + chunk })),
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) patchLast((t) => ({ ...t, error: (err as Error).message }));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="chat">
      <div className="chat-list" ref={listRef}>
        {turns.length === 0 && (
          <div className="chat-empty">
            <p>在左侧选中任意文字，可以高亮、批注，或者直接问我。</p>
            <p>我能看到你当前打开的整篇笔记。</p>
          </div>
        )}
        {turns.map((t, i) => {
          const prevUser = t.role === "assistant" ? turns[i - 1] : undefined;
          return (
            <div key={i} className={`turn ${t.role}`}>
              {t.quote && (
                <blockquote
                  className="quote clickable"
                  title="跳转到原文"
                  onClick={() => t.anchor && t.notePath && onJump(t.notePath, t.anchor)}
                >
                  <Markdown markdown={t.quote} />
                </blockquote>
              )}
              {t.role === "user" ? (
                <div className="bubble">{t.content}</div>
              ) : (
                <div className="answer">
                  {t.content ? <Markdown markdown={t.content} /> : !t.error && <span className="typing">思考中…</span>}
                  {t.error && <div className="error">⚠ {t.error}</div>}
                  {t.content && !(busy && i === turns.length - 1) && (
                    <div className="answer-actions">
                      <button onClick={() => navigator.clipboard.writeText(t.content)}>复制</button>
                      {prevUser?.anchor && prevUser.notePath && (
                        <button onClick={() => onPin(prevUser.notePath!, prevUser.anchor!, prevUser.quote, t.content)}>
                          📌 钉到原文
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="composer">
        {pending && (
          <div className="pending-quote">
            <div className="pending-text">{pending.quote}</div>
            <button onClick={() => setPending(null)} title="移除引用">✕</button>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          placeholder={pending ? "针对这段内容提问…" : "问点什么…（Enter 发送，Shift+Enter 换行）"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="composer-row">
          <button onClick={() => setTurns([])} disabled={busy || turns.length === 0}>清空对话</button>
          <span className="grow" />
          {busy ? (
            <button onClick={() => abortRef.current?.abort()}>停止</button>
          ) : (
            <button className="primary" onClick={() => void send(input)} disabled={!input.trim()}>发送</button>
          )}
        </div>
      </div>
    </div>
  );
}
