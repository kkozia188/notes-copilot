import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { NoteTree } from "./components/NoteTree";
import { NoteView, type AskPayload } from "./components/NoteView";
import { ChatPanel } from "./components/ChatPanel";
import { AnnotationList } from "./components/AnnotationList";
import { fetchNote, fetchTree, type TreeNode } from "./lib/api";
import { addAnnotation, useAnnotations } from "./lib/store";
import type { TextAnchor } from "./lib/anchor";

const DEFAULT_NOTE = "00_项目导航/README.md";
const pathFromHash = () => decodeURIComponent(location.hash.replace(/^#\/?/, "")) || DEFAULT_NOTE;

export default function App() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [notePath, setNotePath] = useState<string>(pathFromHash);
  const [markdown, setMarkdown] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<(AskPayload & { nonce: number }) | null>(null);
  const [tab, setTab] = useState<"chat" | "notes">("chat");
  const ann = useAnnotations(notePath);

  useEffect(() => {
    fetchTree().then(setTree).catch(() => setError("无法加载目录，后端是否已启动？"));
    const onHash = () => setNotePath(pathFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    setError(null);
    fetchNote(notePath).then(setMarkdown).catch((e) => setError((e as Error).message));
    document.title = `${notePath.split("/").pop()?.replace(/\.md$/, "")} · Notes Copilot`;
  }, [notePath]);

  const open = useCallback((path: string) => {
    location.hash = `/${path}`;
  }, []);

  const jumpTo = useCallback(
    (path: string, target: TextAnchor | string) => {
      const go = () => window.dispatchEvent(new CustomEvent("scroll-to-annotation", { detail: target }));
      if (path !== notePath) {
        open(path);
        setTimeout(go, 600);
      } else go();
    },
    [notePath, open],
  );

  return (
    <Group orientation="horizontal" className="app">
      <Panel defaultSize="18%" minSize="10%" collapsible>
        <div className="pane pane-tree">
          <div className="brand">🤖 Notes Copilot</div>
          <NoteTree tree={tree} current={notePath} onOpen={open} />
        </div>
      </Panel>
      <Separator className="resize-handle" />
      <Panel defaultSize="50%" minSize="30%">
        <div className="pane pane-note">
          {error ? (
            <div className="error-box">{error}</div>
          ) : (
            <NoteView
              notePath={notePath}
              markdown={markdown}
              annotations={ann.items}
              onAdd={ann.add}
              onUpdate={ann.update}
              onRemove={ann.remove}
              onAsk={(p) => { setTab("chat"); setAsk({ ...p, nonce: Date.now() }); }}
              onNavigate={open}
            />
          )}
        </div>
      </Panel>
      <Separator className="resize-handle" />
      <Panel defaultSize="32%" minSize="20%">
        <div className="pane pane-chat">
          <div className="tabs">
            <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")}>💬 对话</button>
            <button className={tab === "notes" ? "on" : ""} onClick={() => setTab("notes")}>
              🖍 批注 {ann.items.length > 0 && <span className="badge">{ann.items.length}</span>}
            </button>
          </div>
          <div style={{ display: tab === "chat" ? "contents" : "none" }}>
            <ChatPanel
              notePath={notePath}
              ask={ask}
              onJump={jumpTo}
              onPin={(path, anchor, quote, text) => {
                addAnnotation(path, { color: "blue", anchor, quote, comment: text });
              }}
            />
          </div>
          {tab === "notes" && (
            <AnnotationList items={ann.items} onRemove={ann.remove} onJump={(a) => jumpTo(a.notePath, a.id)} />
          )}
        </div>
      </Panel>
    </Group>
  );
}
