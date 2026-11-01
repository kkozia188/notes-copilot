import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { anchorToRange, describeRange, type TextAnchor } from "../lib/anchor";
import { expandToWholeMath, extractSection, headingFor, rangeToMarkdown } from "../lib/selection";
import { COLORS, type Annotation, type HighlightColor } from "../lib/store";

export type AskPayload = {
  quote: string;
  section: string;
  anchor: TextAnchor;
  notePath: string;
  /** If set, send this question immediately instead of just attaching the quote. */
  preset?: string;
};

export const PRESETS: { label: string; prompt: string }[] = [
  { label: "解释", prompt: "用通俗的语言解释这段内容，先讲直觉再讲细节。" },
  { label: "推导", prompt: "把这段的推导拆成每一步，写清每一步用到的定义或定理。" },
  { label: "举例", prompt: "给一个机器人中的具体例子（最好带数值或代码）来说明这段内容。" },
];

type Props = {
  notePath: string;
  markdown: string;
  annotations: Annotation[];
  onAdd: (a: { color: HighlightColor; anchor: TextAnchor; quote?: string; comment?: string }) => Annotation | null;
  onUpdate: (id: string, patch: { color?: HighlightColor; comment?: string }) => void;
  onRemove: (id: string) => void;
  onAsk: (p: AskPayload) => void;
  onNavigate: (path: string) => void;
};

type Toolbar = { x: number; y: number; range: Range };
type Popover = { x: number; y: number; id: string; editing: boolean };

const supportsHighlights = typeof CSS !== "undefined" && "highlights" in CSS;

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = d.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

export function NoteView({ notePath, markdown, annotations, onAdd, onUpdate, onRemove, onAsk, onNavigate }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);
  const rangesRef = useRef(new Map<string, Range>());
  const [toolbar, setToolbar] = useState<Toolbar | null>(null);
  const [popover, setPopover] = useState<Popover | null>(null);
  const [orphans, setOrphans] = useState(0);

  // Reset scroll and floating UI when the note changes.
  useLayoutEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
    setToolbar(null);
    setPopover(null);
  }, [notePath]);

  // Paint highlights with the CSS Custom Highlight API (no DOM mutation → safe with KaTeX & React).
  useEffect(() => {
    const root = articleRef.current;
    if (!root) return;
    const byColor = new Map<string, Range[]>();
    const commented: Range[] = [];
    const map = new Map<string, Range>();
    let missing = 0;
    for (const a of annotations) {
      const r = anchorToRange(root, a.anchor);
      if (!r) { missing++; continue; }
      map.set(a.id, r);
      byColor.set(a.color, [...(byColor.get(a.color) ?? []), r]);
      if (a.comment) commented.push(r);
    }
    rangesRef.current = map;
    setOrphans(missing);
    if (!supportsHighlights) return;
    for (const c of COLORS) CSS.highlights.set(`hl-${c}`, new Highlight(...(byColor.get(c) ?? [])));
    CSS.highlights.set("hl-comment", new Highlight(...commented));
  }, [annotations, markdown]);

  // Scroll-to requests from the annotation list.
  useEffect(() => {
    const onScrollTo = (e: Event) => {
      // detail: annotation id, or a raw anchor (e.g. a chat quote that was never highlighted)
      const detail = (e as CustomEvent<string | TextAnchor>).detail;
      const r =
        typeof detail === "string"
          ? rangesRef.current.get(detail)
          : articleRef.current && anchorToRange(articleRef.current, detail);
      if (!r) return;
      const el = r.startContainer.parentElement;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (supportsHighlights) {
        CSS.highlights.set("hl-flash", new Highlight(r));
        setTimeout(() => CSS.highlights.delete("hl-flash"), 1200);
      }
    };
    window.addEventListener("scroll-to-annotation", onScrollTo);
    return () => window.removeEventListener("scroll-to-annotation", onScrollTo);
  }, []);

  const relPos = (rect: DOMRect) => {
    const box = scrollRef.current!.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - box.left, y: rect.top - box.top + scrollRef.current!.scrollTop };
  };

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(".floating")) return;
    const root = articleRef.current;
    const sel = window.getSelection();
    if (!root || !sel) return;

    if (sel.isCollapsed) {
      setToolbar(null);
      // Did the user click on an existing highlight?
      const caret = caretAt(e.clientX, e.clientY);
      if (caret) {
        for (const [id, r] of rangesRef.current) {
          if (r.isPointInRange(caret.node, caret.offset)) {
            const p = relPos(r.getBoundingClientRect());
            setPopover({ ...p, id, editing: false });
            return;
          }
        }
      }
      setPopover(null);
      return;
    }
    const raw = sel.getRangeAt(0);
    if (!root.contains(raw.commonAncestorContainer)) return;
    const range = expandToWholeMath(raw);
    if (!range.toString().trim()) return;
    setPopover(null);
    setToolbar({ ...relPos(range.getBoundingClientRect()), range });
  }, []);

  const currentAnchor = (range: Range) => {
    const root = articleRef.current!;
    const h = headingFor(root, range);
    return describeRange(root, range, h?.textContent ?? undefined);
  };

  const highlight = (color: HighlightColor, comment?: string) => {
    if (!toolbar) return;
    const anchor = currentAnchor(toolbar.range);
    const a = onAdd({ color, anchor, quote: rangeToMarkdown(toolbar.range), comment });
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
    return a;
  };

  const ask = (preset?: string) => {
    if (!toolbar) return;
    const anchor = currentAnchor(toolbar.range);
    onAsk({
      quote: rangeToMarkdown(toolbar.range),
      section: extractSection(markdown, anchor.heading),
      anchor,
      notePath,
      preset,
    });
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
  };

  const active = popover ? annotations.find((a) => a.id === popover.id) : undefined;

  return (
    <div className="note-scroll" ref={scrollRef} onMouseUp={onMouseUp}>
      <div className="note-header">
        <span className="note-path">{notePath}</span>
        {orphans > 0 && <span className="orphans" title="笔记更新后无法重新定位的高亮">⚠ {orphans} 条高亮未能定位</span>}
      </div>
      <article ref={articleRef} className="note-article">
        <Markdown markdown={markdown} notePath={notePath} onNavigate={onNavigate} />
      </article>
      <footer className="note-footer">
        笔记内容来自{" "}
        <a href="https://github.com/Michael-Jetson/Robotics_Tutorial" target="_blank" rel="noreferrer">
          Michael-Jetson/Robotics_Tutorial
        </a>
        ，© Pengfei Guo，以{" "}
        <a href="https://creativecommons.org/licenses/by-nc/4.0/" target="_blank" rel="noreferrer">CC BY-NC 4.0</a>{" "}
        许可。
      </footer>

      {toolbar && (
        <div className="floating toolbar" style={{ left: toolbar.x, top: toolbar.y }}>
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${c}`} title="高亮" onClick={() => highlight(c)} />
          ))}
          <span className="sep" />
          <button
            onClick={() => {
              const a = highlight("yellow", "");
              if (a && toolbar) setPopover({ x: toolbar.x, y: toolbar.y, id: a.id, editing: true });
            }}
          >
            ✏️ 批注
          </button>
          <button onClick={() => ask()}>💬 问 AI</button>
          <span className="sep" />
          {PRESETS.map((p) => (
            <button key={p.label} className="preset" onClick={() => ask(p.prompt)}>{p.label}</button>
          ))}
        </div>
      )}

      {popover && active && (
        <AnnotationPopover
          key={active.id}
          annotation={active}
          x={popover.x}
          y={popover.y}
          startEditing={popover.editing}
          onSave={(comment) => onUpdate(active.id, { comment })}
          onColor={(color) => onUpdate(active.id, { color })}
          onDelete={() => { onRemove(active.id); setPopover(null); }}
          onAsk={() => {
            const r = rangesRef.current.get(active.id);
            onAsk({
              quote: r ? rangeToMarkdown(r) : active.anchor.exact,
              section: extractSection(markdown, active.anchor.heading),
              anchor: active.anchor,
              notePath,
            });
            setPopover(null);
          }}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}

function AnnotationPopover(props: {
  annotation: Annotation; x: number; y: number; startEditing: boolean;
  onSave: (c: string) => void; onColor: (c: HighlightColor) => void;
  onDelete: () => void; onAsk: () => void; onClose: () => void;
}) {
  const { annotation: a } = props;
  const [editing, setEditing] = useState(props.startEditing || !a.comment);
  const [text, setText] = useState(a.comment ?? "");
  return (
    <div className="floating popover" style={{ left: props.x, top: props.y }}>
      <div className="popover-row">
        {COLORS.map((c) => (
          <button key={c} className={`swatch ${c} ${a.color === c ? "on" : ""}`} onClick={() => props.onColor(c)} />
        ))}
        <span className="grow" />
        <button onClick={props.onAsk}>💬 问 AI</button>
        <button onClick={props.onDelete} title="删除">🗑</button>
        <button onClick={props.onClose} title="关闭">✕</button>
      </div>
      {editing ? (
        <>
          <textarea
            autoFocus
            value={text}
            placeholder="写下你的批注…（支持 Markdown 和 $公式$）"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { props.onSave(text); setEditing(false); }
            }}
          />
          <div className="popover-row">
            <span className="hint">⌘/Ctrl + Enter 保存</span>
            <span className="grow" />
            <button className="primary" onClick={() => { props.onSave(text); setEditing(false); }}>保存</button>
          </div>
        </>
      ) : (
        <div className="popover-comment" onDoubleClick={() => setEditing(true)} title="双击编辑">
          <Markdown markdown={a.comment ?? ""} />
        </div>
      )}
    </div>
  );
}
