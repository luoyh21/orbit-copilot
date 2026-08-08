import { describe, expect, it } from "vitest";
import { applyPluginSelection, DEFAULT_SETTINGS, DEFAULT_TOOLS, PLUGIN_PACKS } from "./presets";

describe("default integration registry", () => {
  it("keeps tool names unique and model-safe", () => {
    const names = DEFAULT_TOOLS.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((name) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(name))).toBe(true);
  });

  it("preconfigures UI and API ports separately", () => {
    const debris = DEFAULT_SETTINGS.services.find((service) => service.id === "debris")!;
    const starmad = DEFAULT_SETTINGS.services.find((service) => service.id === "starmad")!;
    expect(debris.dashboardUrl).toContain(":8501");
    expect(debris.apiUrl).toContain(":8502");
    expect(starmad.dashboardUrl).toContain(":18501");
    expect(starmad.apiUrl).toContain(":18502");
  });

  it("does not enable destructive API methods by default", () => {
    expect(DEFAULT_TOOLS.filter((tool) => tool.enabled && ["PUT", "PATCH", "DELETE"].includes(tool.method))).toEqual([]);
  });

  it("keeps plugin definitions aligned with services", () => {
    expect(PLUGIN_PACKS.map((plugin) => plugin.id).sort()).toEqual(DEFAULT_SETTINGS.services.map((service) => service.id).sort());
    expect(PLUGIN_PACKS.every((plugin) => DEFAULT_TOOLS.some((tool) => tool.serviceId === plugin.id))).toBe(true);
  });

  it("enables built-ins without enabling discovered write tools", () => {
    const discovered = { ...DEFAULT_TOOLS[0], id: "openapi-debris-delete", method: "DELETE" as const, enabled: false };
    const selected = applyPluginSelection([...DEFAULT_TOOLS, discovered], ["debris"]);
    expect(selected.filter((tool) => tool.serviceId === "debris" && !tool.id.startsWith("openapi-")).every((tool) => tool.enabled)).toBe(true);
    expect(selected.find((tool) => tool.id === discovered.id)?.enabled).toBe(false);
    expect(selected.filter((tool) => tool.serviceId === "starmad").every((tool) => !tool.enabled)).toBe(true);
  });
});
