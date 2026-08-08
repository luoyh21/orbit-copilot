import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiTool, ServiceSettings } from "./types";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("./transport", () => ({ request: requestMock }));

import { discoverOpenApi, mergeDiscoveredTools } from "./openapi";

const service: ServiceSettings = {
  id: "debris", name: "debris", apiUrl: "http://example.test", dashboardUrl: "", authToken: "", allowInvalidCerts: false,
};

beforeEach(() => requestMock.mockReset());

describe("OpenAPI discovery", () => {
  it("resolves refs, nullable schemas, query parameters and safe defaults", async () => {
    requestMock.mockResolvedValue({ status: 200, headers: {}, body: {
      paths: {
        "/search": { post: {
          operationId: "search_catalog", summary: "Search catalog",
          parameters: [{ name: "format", in: "query", schema: { anyOf: [{ type: "string" }, { type: "null" }] } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Search" } } } },
        } },
        "/items/{id}": { delete: { operationId: "delete_item", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] } },
      },
      components: { schemas: { Search: { type: "object", required: ["query"], properties: { query: { type: "string" } } } } },
    } });
    const tools = await discoverOpenApi(service);
    const search = tools.find((tool) => tool.name === "search_catalog")!;
    expect(search.enabled).toBe(true);
    expect(search.queryParams).toEqual(["format"]);
    expect(search.inputSchema.required).toContain("query");
    expect(search.inputSchema.properties.format).toMatchObject({ type: "string" });
    expect(tools.find((tool) => tool.method === "DELETE")?.enabled).toBe(false);
  });

  it("merges canonical schemas into built-ins and avoids duplicate endpoints", () => {
    const builtIn: ApiTool = { id: "built-in", name: "query", title: "Query", description: "Query", serviceId: "debris", method: "POST", path: "/search", enabled: true, inputSchema: { type: "object", properties: {} } };
    const discovered: ApiTool = { ...builtIn, id: "openapi-debris-search", name: "search_catalog", queryParams: ["format"], discoveryPolicyVersion: 1 };
    const merged = mergeDiscoveredTools([builtIn], [discovered], "debris");
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("built-in");
    expect(merged[0].queryParams).toEqual(["format"]);
  });
});
