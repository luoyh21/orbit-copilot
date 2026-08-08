import { request } from "./transport";
import type { ApiTool, AppSettings, ChatMessage, NativeRequest, ToolRun } from "./types";

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

async function llm(messages: AgentMessage[], settings: AppSettings, tools: ApiTool[]) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (settings.llm.apiKey) headers.Authorization = `Bearer ${settings.llm.apiKey}`;
  const requestBody = { model: settings.llm.model, messages, tools: tools.map(toolDefinition), tool_choice: "auto", temperature: settings.llm.temperature };
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
): Promise<{ content: string; toolRuns: ToolRun[] }> {
  const enabled = tools.filter((tool) => tool.enabled);
  const messages: AgentMessage[] = [
    { role: "system", content: settings.systemPrompt },
    ...history.slice(-20).map((item) => ({ role: item.role, content: item.content } as AgentMessage)),
  ];
  const runs: ToolRun[] = [];

  for (let step = 0; step < settings.llm.maxSteps; step += 1) {
    const answer = await llm(messages, settings, enabled);
    messages.push(answer);
    if (!answer.tool_calls?.length) return { content: answer.content || "模型没有返回文本。", toolRuns: runs };

    for (const call of answer.tool_calls) {
      const tool = enabled.find((item) => item.name === call.function.name);
      const run: ToolRun = { id: call.id, name: call.function.name, title: tool?.title || call.function.name, state: "running" };
      runs.push(run); onTools([...runs]);
      const started = performance.now();
      let content: string;
      try {
        if (!tool) throw new Error("模型请求了未注册工具");
        const args = JSON.parse(call.function.arguments || "{}");
        const response = await request(buildToolRequest(tool, args, settings));
        content = JSON.stringify({ status: response.status, data: response.body });
        if (response.status < 200 || response.status >= 300) throw new Error(content);
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
