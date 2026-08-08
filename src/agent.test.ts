import { describe, expect, it } from "vitest";
import { buildToolRequest, shouldRetryWithoutReasoning } from "./agent";
import { DEFAULT_SETTINGS } from "./presets";
import type { ApiTool } from "./types";

describe("LLM compatibility retry", () => {
  it("retries reasoning/tool compatibility errors", () => {
    expect(shouldRetryWithoutReasoning(400, { error: { message: "Function tools with reasoning_effort are not supported" } })).toBe(true);
  });

  it("does not retry unrelated model errors", () => {
    expect(shouldRetryWithoutReasoning(401, { error: { message: "unauthorized" } })).toBe(false);
    expect(shouldRetryWithoutReasoning(400, { error: { message: "model not found" } })).toBe(false);
  });
});

describe("OpenAPI request routing", () => {
  it("keeps POST query parameters out of the JSON body", () => {
    const tool: ApiTool = {
      id: "catalog-search", name: "catalog_search", title: "Catalog search", description: "search",
      serviceId: "debris", method: "POST", path: "/api/v1/catalog/search", enabled: true,
      queryParams: ["format"], hasRequestBody: true,
      inputSchema: { type: "object", properties: {} },
    };
    const request = buildToolRequest(tool, { format: "json", object_type: "PAYLOAD" }, DEFAULT_SETTINGS);
    expect(request.url).toContain("?format=json");
    expect(request.body).toEqual({ object_type: "PAYLOAD" });
  });

  it("does not invent an empty body for POST operations without requestBody", () => {
    const tool: ApiTool = {
      id: "preview", name: "preview", title: "Preview", description: "preview",
      serviceId: "starmad", method: "POST", path: "/api/processes/{process_id}/budget/preview", enabled: true,
      hasRequestBody: false,
      inputSchema: { type: "object", properties: { process_id: { type: "string" } }, required: ["process_id"] },
    };
    const request = buildToolRequest(tool, { process_id: "abc" }, DEFAULT_SETTINGS);
    expect(request.url).toMatch(/\/api\/processes\/abc\/budget\/preview$/);
    expect(request.body).toBeUndefined();
    expect(request.headers["Content-Type"]).toBeUndefined();
  });
});
