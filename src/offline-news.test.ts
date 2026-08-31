import { describe, expect, it } from "vitest";
import { mergeNewsItems, newsKind } from "./offline-news";
import type { NewsItem } from "./types";

function item(id: string, kind: string, source: string, published = "2026-08-31 08:00"): NewsItem {
  return { id, kind, source, published, title: id, summary: "", image: "", tags: [], page_url: "", original_url: "" };
}

describe("offline news", () => {
  it("separates SpaceNews from the general news feed", () => {
    expect(newsKind(item("a", "intl", "SpaceNews"))).toBe("spacenews");
    expect(newsKind(item("b", "intl", "NASA"))).toBe("news");
  });

  it("prefers the first copy while de-duplicating and sorting", () => {
    const live = item("same", "intl", "SpaceNews", "2026-08-31 09:00");
    const offline = { ...live, title: "offline copy" };
    const older = item("older", "debris", "CelesTrak", "2026-08-01 04:13");
    const result = mergeNewsItems([live], [offline, older]);
    expect(result.map((value) => value.id)).toEqual(["same", "older"]);
    expect(result[0].title).toBe("same");
    expect(result[0].kind).toBe("spacenews");
  });
});
