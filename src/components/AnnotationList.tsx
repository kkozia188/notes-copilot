import type { Annotation } from "../lib/store";
import { exportAnnotations } from "../lib/store";

type Props = { items: Annotation[]; onJump: (a: Annotation) => void; onRemove: (id: string) => void };

export function AnnotationList({ items, onJump, onRemove }: Props) {
  const sorted = [...items].sort((a, b) => a.anchor.start - b.anchor.start);
  return (
    <div className="ann-list">
      <div className="ann-toolbar">
        <span>{items.length} 条高亮 / 批注</span>
        <span className="grow" />
        <button onClick={exportAnnotations} title="导出全部笔记的批注为 JSON">导出</button>
      </div>
      {sorted.length === 0 && <div className="chat-empty">本篇还没有高亮。选中文字试试。</div>}
      {sorted.map((a) => (
        <div key={a.id} className="ann-item" onClick={() => onJump(a)}>
          <div className="ann-head">
            <span className={`dot ${a.color}`} />
            <span className="ann-heading">{a.anchor.heading ?? ""}</span>
            <span className="grow" />
            <button onClick={(e) => { e.stopPropagation(); onRemove(a.id); }} title="删除">🗑</button>
          </div>
          <div className="ann-exact">{(a.quote ?? a.anchor.exact).slice(0, 160)}{(a.quote ?? a.anchor.exact).length > 160 ? "…" : ""}</div>
          {a.comment && <div className="ann-comment">{a.comment.slice(0, 300)}</div>}
        </div>
      ))}
    </div>
  );
}
