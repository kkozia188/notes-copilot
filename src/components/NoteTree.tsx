import { useMemo, useState } from "react";
import type { TreeNode } from "../lib/api";

type Props = { tree: TreeNode[]; current: string | null; onOpen: (path: string) => void };

function filterTree(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q) return nodes;
  return nodes.flatMap((n) => {
    if (n.children) {
      const kids = filterTree(n.children, q);
      return kids.length || n.name.toLowerCase().includes(q) ? [{ ...n, children: kids.length ? kids : n.children }] : [];
    }
    return n.name.toLowerCase().includes(q) ? [n] : [];
  });
}

const prettify = (name: string) => name.replace(/^\d+_/, "");

function Node({ node, depth, current, onOpen, forceOpen }: {
  node: TreeNode; depth: number; current: string | null; onOpen: (p: string) => void; forceOpen: boolean;
}) {
  const [open, setOpen] = useState(() => !!current?.startsWith(node.path + "/"));
  const isOpen = forceOpen || open;
  if (!node.children) {
    return (
      <div
        className={`tree-item file ${current === node.path ? "active" : ""}`}
        style={{ paddingLeft: 12 + depth * 12 }}
        onClick={() => onOpen(node.path)}
        title={node.path}
      >
        {prettify(node.name)}
      </div>
    );
  }
  return (
    <div>
      <div className="tree-item dir" style={{ paddingLeft: 12 + depth * 12 }} onClick={() => setOpen(!isOpen)}>
        <span className="caret">{isOpen ? "▾" : "▸"}</span>
        {prettify(node.name)}
      </div>
      {isOpen && node.children.map((c) => (
        <Node key={c.path} node={c} depth={depth + 1} current={current} onOpen={onOpen} forceOpen={forceOpen} />
      ))}
    </div>
  );
}

export function NoteTree({ tree, current, onOpen }: Props) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => filterTree(tree, q.trim().toLowerCase()), [tree, q]);
  return (
    <div className="tree">
      <input className="tree-search" placeholder="搜索笔记…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="tree-body">
        {shown.map((n) => (
          <Node key={n.path} node={n} depth={0} current={current} onOpen={onOpen} forceOpen={!!q} />
        ))}
      </div>
    </div>
  );
}
