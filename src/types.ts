export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxSteps: number;
}

export interface ServiceSettings {
  id: "debris" | "starmad" | "news";
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
  desktop: {
    autostart: boolean;
    newsNotifications: boolean;
  };
}

export type NewsEdition = "morning" | "evening";

export interface NewsItem {
  id: string;
  kind: string;
  title: string;
  summary: string;
  image: string;
  source: string;
  published: string;
  tags: string[];
  page_url: string;
  original_url: string;
}

export interface DailyNews {
  ok: boolean;
  date: string;
  edition: NewsEdition;
  title: string;
  generated_at: string;
  count: number;
  items: NewsItem[];
  editions: Record<NewsEdition, { available: boolean; count: number; generated_at: string }>;
  web_url: string;
  qr_url: string;
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
  exports?: SpreadsheetExport[];
  error?: boolean;
}

export type SpreadsheetCellType = "text" | "number" | "boolean" | "date";

export interface SpreadsheetColumn {
  key: string;
  label: string;
  type?: SpreadsheetCellType;
}

export interface SpreadsheetExport {
  id: string;
  filename: string;
  title: string;
  columns: SpreadsheetColumn[];
  rows: Array<Record<string, string | number | boolean | null>>;
  generatedAt: number;
}

export interface SpreadsheetSaveResult {
  saved: boolean;
  path?: string;
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
