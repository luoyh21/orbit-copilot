import { request } from "./transport";
import type { ApiTool, AppSettings, ChatMessage, NativeRequest, SpreadsheetColumn, SpreadsheetExport, ToolRun } from "./types";

interface AgentMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_call_id?: string; tool_calls?: ToolCall[] }
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }

export function shouldRetryWithoutReasoning(status: number, body: unknown): boolean {
  if (status !== 400) return false;
  const message = JSON.stringify(body).toLowerCase();
  return message.includes("reasoning_effort") && message.includes("tool");
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function chatUrl(base: string): string {
  const clean = base.replace(/\/+$/, "");
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function toolDefinition(tool: ApiTool) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } };
}

export function buildToolRequest(tool: ApiTool, args: Record<string, unknown>, settings: AppSettings): NativeRequest {
  const service = settings.services.find((item) => item.id === tool.serviceId);
  if (!service) throw new Error(`未配置服务: ${tool.serviceId}`);
  let path = tool.path;
  const remaining = { ...args };
  path = path.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    if (remaining[key] === undefined) throw new Error(`缺少路径参数: ${key}`);
    const value = encodeURIComponent(String(remaining[key]));
    delete remaining[key];
    return value;
  });
  const headers: Record<string, string> = { Accept: "application/json" };
  if (service.authToken) headers.Authorization = `Bearer ${service.authToken}`;
  for (const key of tool.headerParams || []) {
    const value = remaining[key];
    if (value !== undefined && value !== null && value !== "") headers[key] = String(value);
    delete remaining[key];
  }

  let url = joinUrl(service.apiUrl, path);
  const queryKeys = tool.method === "GET" ? Object.keys(remaining) : (tool.queryParams || []);
  if (queryKeys.length) {
    const query = new URLSearchParams();
    queryKeys.forEach((key) => {
      const value = remaining[key];
      if (value !== undefined && value !== null && value !== "") query.set(key, Array.isArray(value) ? value.join(",") : String(value));
      delete remaining[key];
    });
    const encoded = query.toString();
    if (encoded) url += `?${encoded}`;
  }
  const includeBody = tool.method !== "GET" && tool.hasRequestBody !== false;
  if (includeBody) headers["Content-Type"] = "application/json";
  const body = tool.bodyParam ? remaining[tool.bodyParam] : remaining;
  return { url, method: tool.method, headers, body: includeBody ? body : undefined, allowInvalidCerts: service.allowInvalidCerts, timeoutSeconds: tool.longRunning ? 180 : 30 };
}

const EXPORT_TOOL_NAME = "export_xlsx";
const exportToolDefinition = {
  type: "function",
  function: {
    name: EXPORT_TOOL_NAME,
    description: "把已经通过接口查询到的真实结果整理为可下载的 Excel .xlsx 工作簿。优先用 source_tool_name 引用本轮已成功调用的工具，禁止捏造行数据。",
    parameters: {
      type: "object",
      properties: {
        filename: { type: "string", description: "建议的 .xlsx 文件名" },
        title: { type: "string", description: "工作簿标题" },
        source_tool_name: { type: "string", description: "本轮提供表格数据的已成功工具名称" },
        data_path: { type: "string", description: "结果中数组的点分路径，例如 results；若结果本身是数组则留空" },
        columns: {
          type: "array",
          description: "可选的列定义；省略时按结果对象的键自动生成",
          items: {
            type: "object",
            properties: {
              key: { type: "string" },
              label: { type: "string" },
              type: { type: "string", enum: ["text", "number", "boolean", "date"] },
            },
            required: ["key", "label"],
          },
        },
        rows: {
          type: "array",
          description: "仅在没有可引用的接口结果时使用的结构化行数据",
          items: { type: "object", additionalProperties: true },
        },
      },
      required: ["filename", "title"],
    },
  },
};

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  return JSON.stringify(value);
}

function valueAtPath(value: unknown, path?: string): unknown {
  if (!path?.trim()) return value;
  return path.split(".").filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function resolveExportRows(source: unknown, requestedPath: string): unknown {
  const direct = valueAtPath(source, requestedPath);
  if (Array.isArray(direct)) return direct;
  const withoutEnvelope = requestedPath.replace(/^(data|body)\./, "");
  const unwrapped = valueAtPath(source, withoutEnvelope);
  if (Array.isArray(unwrapped)) return unwrapped;
  if (source && typeof source === "object") {
    const record = source as Record<string, unknown>;
    for (const key of ["results", "rows", "items", "data"]) {
      if (Array.isArray(record[key])) return record[key];
      if (record[key] && typeof record[key] === "object") {
        const nested = record[key] as Record<string, unknown>;
        for (const nestedKey of ["results", "rows", "items", "data"]) {
          if (Array.isArray(nested[nestedKey])) return nested[nestedKey];
        }
      }
    }
  }
  return direct;
}

function safeFilename(value: unknown): string {
  const clean = String(value || "查询结果")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 120) || "查询结果";
  return clean.toLowerCase().endsWith(".xlsx") ? clean : `${clean}.xlsx`;
}

function inferColumns(rows: Array<Record<string, unknown>>): SpreadsheetColumn[] {
  const preferredOrder = [
    "NORAD", "国际编号(COSPAR)", "名称", "国家/地区", "运营方", "用途", "对象类型",
    "平均高度(km)", "近地点高度(km)", "远地点高度(km)", "倾角(°)", "偏心率",
    "轨道周期(min)", "太阳同步(SSO)", "升交点进动(°/day)", "该高度SSO理论倾角(°)",
    "质量(kg)", "质量来源", "形状", "平均截面积(m²)", "等效尺寸(m)", "RCS尺寸等级",
    "可控(推定)", "在UCS运营库", "DISCOS仍活跃", "发射日期", "GP历元",
  ];
  const keys: string[] = [];
  const seen = new Set<string>();
  rows.slice(0, 100).forEach((row) => Object.keys(row).forEach((key) => {
    if (!seen.has(key)) { seen.add(key); keys.push(key); }
  }));
  keys.sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left);
    const rightIndex = preferredOrder.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  return keys.slice(0, 50).map((key) => {
    const sample = rows.find((row) => row[key] !== null && row[key] !== undefined)?.[key];
    const type = typeof sample === "number" ? "number" : typeof sample === "boolean" ? "boolean" : "text";
    return { key, label: key, type };
  });
}

export function compactToolResultForModel(value: unknown, maxCharacters = 40_000): unknown {
  if (JSON.stringify(value).length <= maxCharacters) return value;
  if (Array.isArray(value)) {
    return {
      _orbit_copilot_truncated: true,
      total_rows: value.length,
      note: "对话中仅展示前 20 行；export_xlsx 仍可通过 source_tool_name 导出内存中的完整结果。",
      preview: value.slice(0, 20),
    };
  }
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const arrayEntry = Object.entries(source).find(([, item]) => Array.isArray(item) && item.length > 20);
    if (arrayEntry) {
      const [key, rows] = arrayEntry as [string, unknown[]];
      return {
        ...source,
        [key]: rows.slice(0, 20),
        _orbit_copilot_truncated: true,
        _orbit_copilot_total_rows: rows.length,
        _orbit_copilot_note: `字段 ${key} 在对话中仅展示前 20 行；export_xlsx 仍会读取完整结果。`,
      };
    }
  }
  const serialized = JSON.stringify(value);
  return { _orbit_copilot_truncated: true, preview: serialized.slice(0, maxCharacters), total_characters: serialized.length };
}

export function createSpreadsheetExport(
  rawArgs: Record<string, unknown>,
  sourceResults: Map<string, unknown>,
): SpreadsheetExport {
  const sourceName = typeof rawArgs.source_tool_name === "string" ? rawArgs.source_tool_name : "";
  const source = sourceName ? sourceResults.get(sourceName) : undefined;
  if (sourceName && source === undefined) throw new Error(`找不到已成功调用的来源工具: ${sourceName}`);
  const candidate = sourceName ? resolveExportRows(source, String(rawArgs.data_path || "results")) : rawArgs.rows;
  if (!Array.isArray(candidate)) throw new Error("导出数据不是数组；请检查 source_tool_name 与 data_path");
  if (!candidate.length) throw new Error("查询结果为空，没有可导出的行");
  if (candidate.length > 10_000) throw new Error("单次最多导出 10,000 行，请缩小查询范围");
  const objectRows: Array<Record<string, unknown>> = candidate.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return { value: row as unknown };
    return row as Record<string, unknown>;
  });
  const requestedColumns = Array.isArray(rawArgs.columns) ? rawArgs.columns : [];
  const columns: SpreadsheetColumn[] = requestedColumns
    .filter((column): column is Record<string, unknown> => !!column && typeof column === "object" && !Array.isArray(column))
    .map((column) => ({
      key: String(column.key || ""),
      label: String(column.label || column.key || ""),
      type: ["text", "number", "boolean", "date"].includes(String(column.type)) ? column.type as SpreadsheetColumn["type"] : undefined,
    }))
    .filter((column) => column.key && column.label)
    .slice(0, 50);
  const inferredColumns = inferColumns(objectRows);
  const finalColumns = sourceName && columns.length >= inferredColumns.length
    ? inferredColumns
    : columns.length ? columns : inferredColumns;
  if (!finalColumns.length) throw new Error("没有可导出的列");
  return {
    id: crypto.randomUUID(),
    filename: safeFilename(rawArgs.filename),
    title: String(rawArgs.title || "查询结果").trim().slice(0, 200) || "查询结果",
    columns: finalColumns,
    rows: objectRows.map((row) => Object.fromEntries(finalColumns.map((column) => [column.key, normalizeCell(row[column.key])]))),
    generatedAt: Date.now(),
  };
}

async function llm(messages: AgentMessage[], settings: AppSettings, tools: ApiTool[]) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.llm.apiKey) headers.Authorization = `Bearer ${settings.llm.apiKey}`;
  const requestBody = { model: settings.llm.model, messages, tools: [...tools.map(toolDefinition), exportToolDefinition], tool_choice: "auto", temperature: settings.llm.temperature };
  let response = await request({
    url: chatUrl(settings.llm.baseUrl), method: "POST", headers, timeoutSeconds: 180,
    body: requestBody,
  });
  if (shouldRetryWithoutReasoning(response.status, response.body)) {
    response = await request({
      url: chatUrl(settings.llm.baseUrl), method: "POST", headers, timeoutSeconds: 180,
      body: { ...requestBody, reasoning_effort: "none" },
    });
  }
  if (response.status < 200 || response.status >= 300) throw new Error(`模型接口 HTTP ${response.status}: ${JSON.stringify(response.body).slice(0, 500)}`);
  const responseBody = response.body as { choices?: Array<{ message?: AgentMessage }> };
  const message = responseBody.choices?.[0]?.message;
  if (!message) throw new Error("模型返回中没有 choices[0].message");
  return message;
}

export async function runAgent(
  history: ChatMessage[], settings: AppSettings, tools: ApiTool[],
  onTools: (runs: ToolRun[]) => void,
): Promise<{ content: string; toolRuns: ToolRun[]; exports: SpreadsheetExport[] }> {
  const enabled = tools.filter((tool) => tool.enabled);
  const messages: AgentMessage[] = [
    { role: "system", content: `${settings.systemPrompt}\n\n目录检索中，用户说“卫星”时默认指对象类型 PAYLOAD，除非用户明确要求包含碎片、火箭体或全部空间目标。\n当用户要求导出、Excel 或 xlsx 时：先调用业务查询工具取得真实数据，再调用 export_xlsx。export_xlsx 应通过 source_tool_name 引用刚才成功的业务工具，并用 data_path 指向结果数组（常见为 results）；除非数据来自用户明确提供的内容，否则不要手写或猜测 rows。较大的接口结果在对话上下文中可能只展示前 20 行，但 export_xlsx 仍会读取该次调用在内存中的完整结果。` },
    ...history.slice(-20).map((item) => ({ role: item.role, content: item.content } as AgentMessage)),
  ];
  const runs: ToolRun[] = [];
  const exports: SpreadsheetExport[] = [];
  const sourceResults = new Map<string, unknown>();

  for (let step = 0; step < settings.llm.maxSteps; step += 1) {
    const answer = await llm(messages, settings, enabled);
    messages.push(answer);
    if (!answer.tool_calls?.length) return { content: answer.content || "模型没有返回文本。", toolRuns: runs, exports };

    for (const call of answer.tool_calls) {
      const tool = enabled.find((item) => item.name === call.function.name);
      const isExport = call.function.name === EXPORT_TOOL_NAME;
      const run: ToolRun = { id: call.id, name: call.function.name, title: isExport ? "生成 Excel 表格" : tool?.title || call.function.name, state: "running" };
      runs.push(run); onTools([...runs]);
      const started = performance.now();
      let content: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        if (isExport) {
          const spreadsheet = createSpreadsheetExport(args, sourceResults);
          exports.push(spreadsheet);
          content = JSON.stringify({ status: "ready", export_id: spreadsheet.id, filename: spreadsheet.filename, rows: spreadsheet.rows.length, columns: spreadsheet.columns.length });
        } else {
          if (!tool) throw new Error("模型请求了未注册工具");
          const response = await request(buildToolRequest(tool, args, settings));
          content = JSON.stringify({ status: response.status, data: compactToolResultForModel(response.body) });
          if (response.status < 200 || response.status >= 300) throw new Error(content);
          sourceResults.set(tool.name, response.body);
        }
        run.state = "success";
        run.preview = content.slice(0, 180);
      } catch (error) {
        content = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
        run.state = "error"; run.preview = content.slice(0, 180);
      }
      run.durationMs = Math.round(performance.now() - started); onTools([...runs]);
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }
  throw new Error(`工具调用超过 ${settings.llm.maxSteps} 轮，已停止以避免循环。`);
}
