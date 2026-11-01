import { useCallback, useEffect, useState } from "react";
import type { TextAnchor } from "./anchor";

export type HighlightColor = "yellow" | "green" | "red" | "blue";
export const COLORS: HighlightColor[] = ["yellow", "green", "red", "blue"];

export type Annotation = {
  id: string;
  notePath: string;
  color: HighlightColor;
  anchor: TextAnchor;
  /** Human-readable copy of the passage (math as LaTeX), for lists and export. */
  quote?: string;
  comment?: string;
  createdAt: number;
  updatedAt: number;
};

const KEY = "notes-copilot:annotations:v1";

function loadAll(): Annotation[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}
function saveAll(all: Annotation[]) {
  localStorage.setItem(KEY, JSON.stringify(all));
  window.dispatchEvent(new Event("annotations-changed"));
}

type NewAnnotation = Omit<Annotation, "id" | "createdAt" | "updatedAt" | "notePath">;

export function addAnnotation(notePath: string, a: NewAnnotation): Annotation {
  const now = Date.now();
  const item: Annotation = { ...a, id: crypto.randomUUID(), notePath, createdAt: now, updatedAt: now };
  saveAll([...loadAll(), item]);
  return item;
}

/** Annotations for one note, persisted in localStorage (local-first; export with exportAnnotations). */
export function useAnnotations(notePath: string | null) {
  const [items, setItems] = useState<Annotation[]>([]);

  useEffect(() => {
    const refresh = () => setItems(loadAll().filter((a) => a.notePath === notePath));
    refresh();
    window.addEventListener("annotations-changed", refresh);
    return () => window.removeEventListener("annotations-changed", refresh);
  }, [notePath]);

  const add = useCallback(
    (a: NewAnnotation) => (notePath ? addAnnotation(notePath, a) : null),
    [notePath],
  );

  const update = useCallback((id: string, patch: Partial<Pick<Annotation, "color" | "comment">>) => {
    saveAll(loadAll().map((a) => (a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a)));
  }, []);

  const remove = useCallback((id: string) => saveAll(loadAll().filter((a) => a.id !== id)), []);

  return { items, add, update, remove };
}

export function exportAnnotations() {
  const blob = new Blob([JSON.stringify(loadAll(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `notes-copilot-annotations-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
