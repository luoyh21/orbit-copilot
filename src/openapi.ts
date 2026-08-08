import { request } from "./transport";
import type { ApiTool, JsonSchema, ServiceSettings } from "./types";

type Operation = { operationId?: string; summary?: string; description?: string; parameters?: Array<Record<string, unknown>>; requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> } };
type OpenApi = { paths?: Record<string, Record<string, Operation>>; components?: { schemas?: Record<string, unknown> } };
const safeName = (value: string) => { const clean = value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 64); return /^[a-zA-Z_]/.test(clean) ? clean : `api_${clean}`; };

function resolveSchema(schema: Record<string, unknown> | undefined, document: OpenApi): Record<string, unknown> {
  if (!schema) return {};
  if (typeof schema.$ref === "string") return resolveSchema(document.components?.schemas?.[schema.$ref.split("/").at(-1) || ""] as Record<string, unknown> | undefined, document);
  const result: Record<string, unknown> = { ...schema };
  if (schema.properties && typeof schema.properties === "object") result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, resolveSchema(value as Record<string, unknown>, document)]));
  if (schema.items && typeof schema.items === "object") result.items = resolveSchema(schema.items as Record<string, unknown>, document);
  delete result.title;
  return result;
}

export async function discoverOpenApi(service: ServiceSettings): Promise<ApiTool[]> {
  const response = await request({ url: `${service.apiUrl.replace(/\/$/, "")}/api/openapi.json`, method: "GET", headers: service.authToken ? { Authorization: `Bearer ${service.authToken}` } : {}, allowInvalidCerts: service.allowInvalidCerts, timeoutSeconds: 30 });
  if (response.status !== 200) throw new Error(`OpenAPI HTTP ${response.status}`);
  const document = response.body as OpenApi;
  const tools: ApiTool[] = [];
  for (const [path, item] of Object.entries(document.paths || {})) for (const [method, operation] of Object.entries(item)) {
    const upper = method.toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) continue;
    const properties: Record<string, Record<string, unknown>> = {}; const required: string[] = [];
    for (const parameter of operation.parameters || []) { const name = String(parameter.name || "parameter"); properties[name] = resolveSchema(parameter.schema as Record<string, unknown>, document); if (parameter.description) properties[name].description = parameter.description; if (parameter.required) required.push(name); }
    const resolvedBody = resolveSchema(operation.requestBody?.content?.["application/json"]?.schema, document);
    if (resolvedBody.properties && typeof resolvedBody.properties === "object") Object.assign(properties, resolvedBody.properties);
    if (Array.isArray(resolvedBody.required)) required.push(...resolvedBody.required.map(String));
    const name = safeName(operation.operationId || `${method}_${path}`);
    tools.push({ id: `openapi-${service.id}-${name}`, name, title: operation.summary || name, description: operation.description || operation.summary || `${upper} ${path}`, serviceId: service.id, method: upper as ApiTool["method"], path, inputSchema: { type: "object", properties, required: [...new Set(required)] } as JsonSchema, enabled: false });
  }
  return tools;
}
