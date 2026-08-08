import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./presets";
import { isLlmConnectionComplete, loadChats, loadTools, saveChats } from "./storage";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
});

describe("LLM onboarding readiness", () => {
  it("requires both an API address and model name", () => {
    expect(isLlmConnectionComplete(null)).toBe(false);
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, baseUrl: "" } })).toBe(false);
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, model: "" } })).toBe(false);
  });

  it("allows keyless local OpenAI-compatible services", () => {
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, apiKey: "" } })).toBe(true);
  });

  it("migrates the legacy single chat into multi-chat history", () => {
    localStorage.setItem("orbit-copilot.chat.v1", JSON.stringify([
      { id: "m1", role: "user", content: "查询空间碎片", createdAt: 100 },
    ]));
    const state = loadChats();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0].title).toBe("查询空间碎片");
    saveChats(state);
    expect(localStorage.getItem("orbit-copilot.chat.v1")).toBeNull();
    expect(localStorage.getItem("orbit-copilot.chats.v2")).toContain("查询空间碎片");
  });

  it("removes sensitive saved tools and enables every remaining installed-plugin tool", () => {
    localStorage.setItem("orbit-copilot.plugins.v1", JSON.stringify(["debris", "starmad"]));
    localStorage.setItem("orbit-copilot.tools.v1", JSON.stringify([
      { id: "openapi-starmad-login", serviceId: "starmad", path: "/api/auth/login", enabled: true },
      { id: "openapi-starmad-projects", serviceId: "starmad", path: "/api/projects", enabled: false },
    ]));
    const tools = loadTools([]);
    expect(tools.map((tool) => tool.path)).toEqual(["/api/projects"]);
    expect(tools[0]).toMatchObject({ enabled: true, discoveryPolicyVersion: 2 });
  });
});
