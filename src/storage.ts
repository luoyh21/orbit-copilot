import { DEFAULT_SETTINGS } from "./presets";
import type { ApiTool, AppSettings, ChatMessage, ServiceSettings } from "./types";

const SETTINGS_KEY = "orbit-copilot.settings.v1";
const CHAT_KEY = "orbit-copilot.chat.v1";
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

export function loadChat(): ChatMessage[] {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) || "[]"); } catch { return []; }
}

export function saveChat(messages: ChatMessage[]): void {
  localStorage.setItem(CHAT_KEY, JSON.stringify(messages.slice(-100)));
}

export function clearChat(): void { localStorage.removeItem(CHAT_KEY); }

export function loadTools(fallback: ApiTool[]): ApiTool[] {
  try {
    const saved = JSON.parse(localStorage.getItem(TOOLS_KEY) || "null");
    if (!Array.isArray(saved)) return fallback;
    const savedById = new Map(saved.map((tool: ApiTool) => [tool.id, tool]));
    const builtIns = fallback.map((tool) => ({ ...tool, enabled: savedById.get(tool.id)?.enabled ?? tool.enabled }));
    return [...builtIns, ...saved.filter((tool: ApiTool) => tool.id?.startsWith("openapi-") && !fallback.some((item) => item.id === tool.id))];
  } catch { return fallback; }
}

export function saveTools(tools: ApiTool[]): void {
  localStorage.setItem(TOOLS_KEY, JSON.stringify(tools));
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
