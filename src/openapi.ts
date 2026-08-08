import { request } from "./transport";
import type { ApiTool, JsonSchema, ServiceSettings } from "./types";

type Schema = Record<string, unknown>;
type Reference = { $ref: string };
type Parameter = { name?: string; in?: string; required?: boolean; description?: string; schema?: Schema } | Reference;
type RequestBody = { required?: boolean; content?: Record<string, { schema?: Schema }> } | Reference;
type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Parameter[];
  requestBody?: RequestBody;
};
type PathItem = Record<string, Operation | Parameter[] | undefined> & { parameters?: Parameter[] };
type OpenApi = {
  paths?: Record<string, PathItem>;
  components?: { schemas?: Record<string, Schema>; parameters?: Record<string, Parameter>; requestBodies?: Record<string, RequestBody> };
};

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const HIGH_COST = /(risk|simulate|compute|matlab|rollup|provision)/i;
const SENSITIVE_API_PATHS = [
  /^\/api\/admin(?:\/|$)/i,
  /^\/api\/auth\/(?!me(?:\/|$))/i,
  /(?:^|\/)(?:change-password|reset-password)(?:\/|$)/i,
];
export const DISCOVERY_POLICY_VERSION = 2;

const safeName = (value: string) => {
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 64);
  return /^[a-zA-Z_]/.test(clean) ? clean : `api_${clean}`;
};

function resolvePointer(reference: string, document: OpenApi): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference.slice(2).split("/").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object") return undefined;
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    return (value as Record<string, unknown>)[key];
  }, document);
}

function resolveObject<T>(value: T | Reference | undefined, document: OpenApi): T | undefined {
  if (!value) return undefined;
  if ("$ref" in (value as object)) return resolvePointer((value as Reference).$ref, document) as T | undefined;
  return value as T;
}

function mergeAllOf(parts: Schema[]): Schema {
  const merged: Schema = { type: "object", properties: {} };
  const required = new Set<string>();
  for (const part of parts) {
    Object.assign(merged, part);
    if (part.properties && typeof part.properties === "object") {
      merged.properties = { ...(merged.properties as Schema), ...(part.properties as Schema) };
    }
    if (Array.isArray(part.required)) part.required.forEach((name) => required.add(String(name)));
  }
  if (required.size) merged.required = [...required];
  return merged;
}

function resolveSchema(schema: Schema | undefined, document: OpenApi, seen = new Set<string>()): Schema {
  if (!schema) return {};
  if (typeof schema.$ref === "string") {
    if (seen.has(schema.$ref)) return {};
    const nextSeen = new Set(seen).add(schema.$ref);
    return resolveSchema(resolvePointer(schema.$ref, document) as Schema | undefined, document, nextSeen);
  }

  const result: Schema = { ...schema };
  for (const combinator of ["allOf", "oneOf", "anyOf"] as const) {
    if (!Array.isArray(schema[combinator])) continue;
    const parts = (schema[combinator] as Schema[]).map((part) => resolveSchema(part, document, seen));
    delete result[combinator];
    if (combinator === "allOf") Object.assign(result, mergeAllOf(parts));
    else {
      const withoutNull = parts.filter((part) => part.type !== "null");
      if (withoutNull.length === 1) Object.assign(result, withoutNull[0]);
      else result[combinator] = parts;
    }
  }
  if (schema.properties && typeof schema.properties === "object") {
    result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, resolveSchema(value as Schema, document, seen)]));
  }
  if (schema.items && typeof schema.items === "object") result.items = resolveSchema(schema.items as Schema, document, seen);
  delete result.title;
  delete result.$defs;
  return result;
}

export function isSensitiveApiTool(tool: Pick<ApiTool, "path">): boolean {
  const path = tool.path.split("?")[0].replace(/\/+$/, "") || "/";
  return SENSITIVE_API_PATHS.some((pattern) => pattern.test(path));
}

function operationKey(tool: Pick<ApiTool, "serviceId" | "method" | "path">): string {
  return `${tool.serviceId}:${tool.method}:${tool.path}`;
}

export function mergeDiscoveredTools(current: ApiTool[], discovered: ApiTool[], serviceId: ServiceSettings["id"]): ApiTool[] {
  const prefix = `openapi-${serviceId}-`;
  const base = current.filter((tool) => !tool.id.startsWith(prefix) && !isSensitiveApiTool(tool));
  const discoveredByOperation = new Map(discovered.map((tool) => [operationKey(tool), tool]));
  const represented = new Set<string>();
  const updatedBase = base.map((tool) => {
    if (tool.serviceId !== serviceId) return tool;
    const found = discoveredByOperation.get(operationKey(tool));
    if (!found) return tool;
    represented.add(operationKey(tool));
    return {
      ...tool,
      inputSchema: found.inputSchema,
      queryParams: found.queryParams,
      headerParams: found.headerParams,
      hasRequestBody: found.hasRequestBody,
      bodyParam: found.bodyParam,
      longRunning: tool.longRunning ?? found.longRunning,
    };
  });
  const additions = discovered.filter((tool) => !isSensitiveApiTool(tool) && !represented.has(operationKey(tool)));
  return [...updatedBase, ...additions];
}

export async function discoverOpenApi(service: ServiceSettings): Promise<ApiTool[]> {
  const baseUrl = service.apiUrl.replace(/\/$/, "");
  const candidates = [`${baseUrl}/api/openapi.json`, `${baseUrl}/openapi.json`];
  let document: OpenApi | undefined;
  let lastStatus = 0;
  for (const url of candidates) {
    const response = await request({ url, method: "GET", headers: service.authToken ? { Authorization: `Bearer ${service.authToken}` } : {}, allowInvalidCerts: service.allowInvalidCerts, timeoutSeconds: 30 });
    lastStatus = response.status;
    if (response.status === 200) { document = response.body as OpenApi; break; }
  }
  if (!document) throw new Error(`OpenAPI HTTP ${lastStatus}`);

  const tools: ApiTool[] = [];
  for (const [path, item] of Object.entries(document.paths || {})) {
    for (const [method, rawOperation] of Object.entries(item)) {
      const upper = method.toUpperCase();
      if (!HTTP_METHODS.has(upper) || !rawOperation || Array.isArray(rawOperation)) continue;
      const operation = rawOperation as Operation;
      if (isSensitiveApiTool({ path })) continue;
      const properties: Record<string, Schema> = {};
      const required = new Set<string>();
      const queryParams: string[] = [];
      const headerParams: string[] = [];
      const parameters = [...(item.parameters || []), ...(operation.parameters || [])];
      for (const rawParameter of parameters) {
        const parameter = resolveObject<Exclude<Parameter, Reference>>(rawParameter, document);
        if (!parameter) continue;
        const name = String(parameter.name || "parameter");
        properties[name] = resolveSchema(parameter.schema, document);
        if (parameter.description) properties[name].description = parameter.description;
        if (parameter.required) required.add(name);
        if (parameter.in === "query") queryParams.push(name);
        if (parameter.in === "header" && name.toLowerCase() !== "authorization") headerParams.push(name);
      }

      const requestBody = resolveObject<Exclude<RequestBody, Reference>>(operation.requestBody, document);
      const media = requestBody?.content?.["application/json"] || Object.values(requestBody?.content || {})[0];
      const resolvedBody = resolveSchema(media?.schema, document);
      let bodyParam: string | undefined;
      if (resolvedBody.properties && typeof resolvedBody.properties === "object") {
        Object.assign(properties, resolvedBody.properties);
        if (Array.isArray(resolvedBody.required)) resolvedBody.required.forEach((name) => required.add(String(name)));
      } else if (media?.schema) {
        bodyParam = "body";
        properties.body = resolvedBody;
        if (requestBody?.required) required.add(bodyParam);
      }

      const name = safeName(operation.operationId || `${method}_${path}`);
      const description = operation.description || operation.summary || `${upper} ${path}`;
      tools.push({
        id: `openapi-${service.id}-${name}`,
        name,
        title: operation.summary || name,
        description: `${description}（${upper} ${path}）`,
        serviceId: service.id,
        method: upper as ApiTool["method"],
        path,
        inputSchema: { type: "object", properties, required: [...required] } as JsonSchema,
        enabled: true,
        longRunning: HIGH_COST.test(`${operation.operationId || ""} ${operation.summary || ""} ${path}`),
        queryParams: [...new Set(queryParams)],
        headerParams: [...new Set(headerParams)],
        hasRequestBody: Boolean(media?.schema),
        bodyParam,
        discoveryPolicyVersion: DISCOVERY_POLICY_VERSION,
      });
    }
  }
  return tools;
}
