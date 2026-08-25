import { describe, expect, it } from "vitest";
import { parseTechPortDate, selectTechPortUpdates, techPortProjectToNewsItem } from "./techport-news";

describe("TechPort news adapter", () => {
  it("normalizes both TechPort date formats and rejects invalid dates", () => {
    expect(parseTechPortDate("2026-8-20")).toBe("2026-08-20");
    expect(parseTechPortDate("08/20/26")).toBe("2026-08-20");
    expect(parseTechPortDate("2026-02-30")).toBeNull();
  });

  it("selects only recent updates at or before the selected day", () => {
    const updates = [
      { projectId: 1, lastUpdated: "2026-8-20" },
      { projectId: 2, lastUpdated: "2026-8-25" },
      { projectId: 3, lastUpdated: "2026-8-26" },
      { projectId: 4, lastUpdated: "2026-8-01" },
    ];
    expect(selectTechPortUpdates(updates, "2026-08-25", 6, 14).map((item) => item.projectId)).toEqual([2, 1]);
  });

  it("maps project metadata to a regular news item", () => {
    const item = techPortProjectToNewsItem({
      projectId: 182255,
      title: "SuperHERO",
      status: "Active",
      lastUpdated: "08/20/26",
      description: "<p>High-angular-resolution &amp; hard-X-ray observatory.</p>",
      trlBegin: 5,
      trlEnd: 7,
      program: { acronym: "APRA" },
      leadOrganization: { acronym: "HQ" },
    });
    expect(item).toMatchObject({
      id: "techport-182255",
      kind: "techport",
      source: "NASA TechPort",
      published: "2026-08-20",
      summary: "High-angular-resolution & hard-X-ray observatory.",
      page_url: "https://techport.nasa.gov/projects/182255",
    });
    expect(item.tags).toEqual(["Active", "APRA", "HQ", "TRL 5→7"]);
  });
});
