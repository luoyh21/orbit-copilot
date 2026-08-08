import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiTool, ServiceSettings } from "./types";

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock("./transport", () => ({ request: requestMock }));

import { discoverOpenApi, isSensitiveApiTool, mergeDiscoveredTools } from "./openapi";

const service: ServiceSettings = {
  id: "debris", name: "debris", apiUrl: "http://example.test", dashboardUrl: "", authToken: "", allowInvalidCerts: false,
};

beforeEach(() => requestMock.mockReset());

describe("OpenAPI discovery", () => {
  it("resolves schemas, enables allowed operations and omits sensitive endpoints", async () => {
    requestMock.mockResolvedValue({ status: 200, headers: {}, body: {
      paths: {
        "/search": { post: {
          operationId: "search_catalog", summary: "Search catalog",
          parameters: [{ name: "format", in: "query", schema: { anyOf: [{ type: "string" }, { type: "null" }] } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Search" } } } },
        } },
        "/items/{id}": { delete: { operationId: "delete_item", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] } },
        "/api/admin/users/{id}/reset-password": { post: { operationId: "reset_password" } },
        "/api/auth/change-password": { post: { operationId: "change_password" } },
      },
      components: { schemas: { Search: { type: "object", required: ["query"], properties: { query: { type: "string" } } } } },
    } });
    const tools = await discoverOpenApi(service);
    const search = tools.find((tool) => tool.name === "search_catalog")!;
    expect(search.enabled).toBe(true);
    expect(search.queryParams).toEqual(["format"]);
    expect(search.inputSchema.required).toContain("query");
    expect(search.inputSchema.properties.format).toMatchObject({ type: "string" });
    expect(tools.find((tool) => tool.method === "DELETE")?.enabled).toBe(true);
    expect(tools.some((tool) => tool.path.includes("password"))).toBe(false);
    expect(tools).toHaveLength(2);
  });

  it("classifies account and administrator routes as sensitive", () => {
    expect(isSensitiveApiTool({ path: "/api/admin/users" })).toBe(true);
    expect(isSensitiveApiTool({ path: "/api/auth/login" })).toBe(true);
    expect(isSensitiveApiTool({ path: "/api/auth/me" })).toBe(false);
    expect(isSensitiveApiTool({ path: "/api/projects/1" })).toBe(false);
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
