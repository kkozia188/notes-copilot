import { useSyncExternalStore } from "react";
import type { TextAnchor } from "./anchor";

/** One conversation per chapter (note file), persisted in localStorage. */

export type Part = { kind: "text"; text: string } | { kind: "tool"; name: string; detail: string };

export type UserTurn = {
  role: "user";
  content: string;
  quote?: string;
  anchor?: TextAnchor;
};
export type AssistantTurn = {
  role: "assistant";
  parts: Part[];
  error?: string;
  durationMs?: number;
  pending?: boolean;
};
export type Turn = UserTurn | AssistantTurn;

export type Conversation = {
  notePath: string;
  /** Claude Code session (CLI backend) so follow-ups keep full context including tool results. */
  sessionId?: string;
  turns: Turn[];
  updatedAt: number;
};

const KEY = "notes-copilot:chats:v1";
let cache: Record<string, Conversation> | null = null;
const listeners = new Set<() => void>();

function all(): Record<string, Conversation> {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch {
      cache = {};
    }
  }
  return cache!;
}

let saveTimer: number | undefined;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => localStorage.setItem(KEY, JSON.stringify(all())), 300);
}

export function getConversation(notePath: string): Conversation {
  return all()[notePath] ?? { notePath, turns: [], updatedAt: 0 };
}

export function updateConversation(notePath: string, fn: (c: Conversation) => Conversation) {
  cache = { ...all(), [notePath]: { ...fn(getConversation(notePath)), updatedAt: Date.now() } };
  persist();
  listeners.forEach((l) => l());
}

export function clearConversation(notePath: string) {
  const { [notePath]: _drop, ...rest } = all();
  cache = rest;
  persist();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useConversation(notePath: string): Conversation {
  return useSyncExternalStore(subscribe, () => all()[notePath] ?? EMPTY(notePath));
}

/** Paths of chapters that have a conversation, newest first. */
export function useChattedNotes(): string[] {
  const snap = useSyncExternalStore(subscribe, all);
  return Object.values(snap)
    .filter((c) => c.turns.length)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((c) => c.notePath);
}

const empties = new Map<string, Conversation>();
const EMPTY = (p: string) => {
  if (!empties.has(p)) empties.set(p, { notePath: p, turns: [], updatedAt: 0 });
  return empties.get(p)!;
};

export const answerText = (t: AssistantTurn) =>
  t.parts.filter((p): p is Extract<Part, { kind: "text" }> => p.kind === "text").map((p) => p.text).join("");
