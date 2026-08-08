import { DEFAULT_SETTINGS } from "./presets";
import { DISCOVERY_POLICY_VERSION, isSensitiveApiTool } from "./openapi";
import type { ApiTool, AppSettings, ChatMessage, ChatSession, ChatState, ServiceSettings } from "./types";

const SETTINGS_KEY = "orbit-copilot.settings.v1";
const CHAT_KEY = "orbit-copilot.chat.v1";
const CHATS_KEY = "orbit-copilot.chats.v2";
const TOOLS_KEY = "orbit-copilot.tools.v1";
const PLUGINS_KEY = "orbit-copilot.plugins.v1";
const PLUGIN_SETUP_KEY = "orbit-copilot.plugin-setup.v1";

export function loadSettings(): AppSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (!saved) return structuredClone(DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      llm: { ...DEFAULT_SETTINGS.llm, ...saved.llm },
      services: DEFAULT_SETTINGS.services.map((fallback) => ({
        ...fallback,
        ...(saved.services?.find((item: { id: string }) => item.id === fallback.id) || {}),
      })),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function isTauri(): boolean { return "__TAURI_INTERNALS__" in window; }

export async function hydrateSecrets(settings: AppSettings): Promise<AppSettings> {
  const next = structuredClone(settings);
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    next.llm.apiKey = await invoke<string>("load_secret", { key: "llm-api-key" }).catch(() => "");
    for (const service of next.services) {
      service.authToken = await invoke<string>("load_secret", { key: `${service.id}-auth-token` }).catch(() => "");
    }
  } else {
    next.llm.apiKey = sessionStorage.getItem("orbit-copilot.llm-key") || "";
    for (const service of next.services) service.authToken = sessionStorage.getItem(`orbit-copilot.${service.id}-token`) || "";
  }
  return next;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const publicSettings = structuredClone(settings);
  publicSettings.llm.apiKey = "";
  for (const service of publicSettings.services) service.authToken = "";
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(publicSettings));
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_secret", { key: "llm-api-key", value: settings.llm.apiKey });
    for (const service of settings.services) await invoke("save_secret", { key: `${service.id}-auth-token`, value: service.authToken });
  } else {
    sessionStorage.setItem("orbit-copilot.llm-key", settings.llm.apiKey);
    for (const service of settings.services) sessionStorage.setItem(`orbit-copilot.${service.id}-token`, service.authToken);
  }
}

export function createChatSession(messages: ChatMessage[] = []): ChatSession {
  const now = Date.now();
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim();
  return {
    id: crypto.randomUUID(),
    title: firstUserMessage ? firstUserMessage.slice(0, 24) : "新对话",
    messages: messages.slice(-100),
    createdAt: messages[0]?.createdAt || now,
    updatedAt: messages.at(-1)?.createdAt || now,
  };
}

export function loadChats(): ChatState {
  try {
    const saved = JSON.parse(localStorage.getItem(CHATS_KEY) || "null") as ChatState | null;
    if (saved && Array.isArray(saved.sessions) && saved.sessions.length) {
      const activeId = saved.sessions.some((session) => session.id === saved.activeId) ? saved.activeId : saved.sessions[0].id;
      return { sessions: saved.sessions, activeId };
    }
    const legacy = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]") as ChatMessage[];
    const session = createChatSession(Array.isArray(legacy) ? legacy : []);
    return { sessions: [session], activeId: session.id };
  } catch {
    const session = createChatSession();
    return { sessions: [session], activeId: session.id };
  }
}

export function saveChats(state: ChatState): void {
  const sessions = [...state.sessions]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 50)
    .map((session) => ({ ...session, messages: session.messages.slice(-100) }));
  const activeId = sessions.some((session) => session.id === state.activeId) ? state.activeId : sessions[0]?.id || "";
  localStorage.setItem(CHATS_KEY, JSON.stringify({ sessions, activeId }));
  localStorage.removeItem(CHAT_KEY);
}

export function loadTools(fallback: ApiTool[]): ApiTool[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TOOLS_KEY) || "null");
    const selected = new Set(loadInstalledPlugins());
    if (!Array.isArray(saved)) return fallback.filter((tool) => !isSensitiveApiTool(tool)).map((tool) => ({ ...tool, enabled: selected.has(tool.serviceId) }));
    const dynamic = saved
      .filter((tool: ApiTool) => tool.id?.startsWith("openapi-") && !isSensitiveApiTool(tool) && !fallback.some((item) => item.id === tool.id))
      .map((tool: ApiTool) => ({ ...tool, enabled: selected.has(tool.serviceId), discoveryPolicyVersion: DISCOVERY_POLICY_VERSION }));
    const builtIns = fallback.filter((tool) => !isSensitiveApiTool(tool)).map((tool) => ({ ...tool, enabled: selected.has(tool.serviceId) }));
    return [...builtIns, ...dynamic];
  } catch {
    const selected = new Set(loadInstalledPlugins());
    return fallback.filter((tool) => !isSensitiveApiTool(tool)).map((tool) => ({ ...tool, enabled: selected.has(tool.serviceId) }));
  }
}

export function saveTools(tools: ApiTool[]): void {
  localStorage.setItem(TOOLS_KEY, JSON.stringify(tools.filter((tool) => !isSensitiveApiTool(tool))));
}

export function hasConfiguredLlm(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    return isLlmConnectionComplete(saved);
  } catch {
    return false;
  }
}

export function isLlmConnectionComplete(settings: Partial<AppSettings> | null): boolean {
  return Boolean(settings?.llm?.baseUrl?.trim() && settings?.llm?.model?.trim());
}

export function hasCompletedPluginSetup(): boolean {
  return localStorage.getItem(PLUGIN_SETUP_KEY) === "complete";
}

export function loadInstalledPlugins(): ServiceSettings["id"][] {
  try {
    const saved = JSON.parse(localStorage.getItem(PLUGINS_KEY) || "null");
    return Array.isArray(saved) ? saved.filter((id) => id === "debris" || id === "starmad") : ["debris", "starmad"];
  } catch {
    return ["debris", "starmad"];
  }
}

export function saveInstalledPlugins(ids: ServiceSettings["id"][]): void {
  localStorage.setItem(PLUGINS_KEY, JSON.stringify(ids));
  localStorage.setItem(PLUGIN_SETUP_KEY, "complete");
}
