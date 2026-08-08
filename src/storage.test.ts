import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./presets";
import { isLlmConnectionComplete } from "./storage";

describe("LLM onboarding readiness", () => {
  it("requires both an API address and model name", () => {
    expect(isLlmConnectionComplete(null)).toBe(false);
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, baseUrl: "" } })).toBe(false);
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, model: "" } })).toBe(false);
  });

  it("allows keyless local OpenAI-compatible services", () => {
    expect(isLlmConnectionComplete({ llm: { ...DEFAULT_SETTINGS.llm, apiKey: "" } })).toBe(true);
  });
});
