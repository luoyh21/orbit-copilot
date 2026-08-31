import type { NewsItem } from "./types";

export type OfflineNewsKind = "debris" | "spacenews" | "techport" | "news";

export interface OfflineNewsResponse {
  available: boolean;
  generatedAt: string;
  month: string;
  dateFrom: string;
  dateTo: string;
  items: NewsItem[];
}

const EMPTY: OfflineNewsResponse = {
  available: false,
  generatedAt: "",
  month: "",
  dateFrom: "",
  dateTo: "",
  items: [],
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadOfflineNews(date: string): Promise<OfflineNewsResponse> {
  if (!isTauri()) return EMPTY;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<OfflineNewsResponse>("offline_news", { date });
}

export function newsKind(item: NewsItem): OfflineNewsKind {
  if (item.kind === "debris" || item.kind === "techport" || item.kind === "spacenews" || item.kind === "news") {
    return item.kind;
  }
  return /spacenews/i.test(item.source || "") ? "spacenews" : "news";
}

export function mergeNewsItems(...groups: NewsItem[][]): NewsItem[] {
  const seen = new Set<string>();
  const merged: NewsItem[] = [];
  for (const item of groups.flat()) {
    const key = item.id || `${item.source}|${item.title}|${item.published}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ ...item, kind: newsKind(item) });
  }
  return merged.sort((left, right) => (right.published || "").localeCompare(left.published || ""));
}
