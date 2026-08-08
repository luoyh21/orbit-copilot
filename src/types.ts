export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxSteps: number;
}

export interface ServiceSettings {
  id: "debris" | "starmad";
  name: string;
  apiUrl: string;
  dashboardUrl: string;
  authToken: string;
  allowInvalidCerts: boolean;
}

export interface AppSettings {
  llm: LlmSettings;
  services: ServiceSettings[];
  systemPrompt: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
}

export interface ApiTool {
  id: string;
  name: string;
  title: string;
  description: string;
  serviceId: ServiceSettings["id"];
  method: HttpMethod;
  path: string;
  inputSchema: JsonSchema;
  enabled: boolean;
  longRunning?: boolean;
  queryParams?: string[];
  headerParams?: string[];
  hasRequestBody?: boolean;
  bodyParam?: string;
  discoveryPolicyVersion?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  toolRuns?: ToolRun[];
  error?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface ChatState {
  sessions: ChatSession[];
  activeId: string;
}

export interface ToolRun {
  id: string;
  name: string;
  title: string;
  state: "running" | "success" | "error";
  durationMs?: number;
  preview?: string;
}

export interface NativeRequest {
  url: string;
  method: HttpMethod;
  headers: Record<string, string>;
  body?: unknown;
  allowInvalidCerts?: boolean;
  timeoutSeconds?: number;
}

export interface NativeResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}
