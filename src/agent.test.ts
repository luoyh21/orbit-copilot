import { describe, expect, it } from "vitest";
import { buildToolRequest, compactToolResultForModel, createSpreadsheetExport, shouldRetryWithoutReasoning } from "./agent";
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

describe("spreadsheet export preparation", () => {
  it("uses complete rows from a successful API tool result", () => {
    const sources = new Map<string, unknown>([["catalog_search", {
      count: 2,
      results: [
        { NORAD: 1, 名称: "卫星 A", "平均高度(km)": 620.5 },
        { NORAD: 2, 名称: "卫星 B", "平均高度(km)": 799.8 },
      ],
    }]]);
    const output = createSpreadsheetExport({
      filename: "600-800km SSO 卫星列表.xlsx",
      title: "600–800 km 太阳同步轨道卫星",
      source_tool_name: "catalog_search",
      data_path: "results",
    }, sources);
    expect(output.rows).toHaveLength(2);
    expect(output.columns.map((column) => column.key)).toEqual(["NORAD", "名称", "平均高度(km)"]);
    expect(output.filename).toBe("600-800km SSO 卫星列表.xlsx");
  });

  it("rejects a missing source instead of inventing spreadsheet rows", () => {
    expect(() => createSpreadsheetExport({
      filename: "missing.xlsx", title: "missing", source_tool_name: "not_called",
    }, new Map())).toThrow("找不到已成功调用的来源工具");
  });

  it("keeps the API field order when the model redundantly lists every column", () => {
    const output = createSpreadsheetExport({
      filename: "ordered.xlsx", title: "ordered", source_tool_name: "query", data_path: "results",
      columns: [
        { key: "名称", label: "名称" },
        { key: "NORAD", label: "NORAD" },
      ],
    }, new Map([["query", { results: [{ 名称: "A", NORAD: 1 }] }]]));
    expect(output.columns.map((column) => column.key)).toEqual(["NORAD", "名称"]);
  });

  it("accepts a model path that includes the tool-response data envelope", () => {
    const output = createSpreadsheetExport({
      filename: "envelope.xlsx", title: "envelope", source_tool_name: "query", data_path: "data.results",
    }, new Map([["query", { results: [{ NORAD: 25544, 名称: "ISS" }] }]]));
    expect(output.rows).toEqual([{ NORAD: 25544, 名称: "ISS" }]);
  });

  it("shows the model a bounded preview while retaining an exportable result shape", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ id: index, description: "x".repeat(100) }));
    const compact = compactToolResultForModel({ count: 100, results: rows }, 1_000) as Record<string, unknown>;
    expect(compact._orbit_copilot_truncated).toBe(true);
    expect(compact._orbit_copilot_total_rows).toBe(100);
    expect(compact.results).toHaveLength(20);
  });
});
