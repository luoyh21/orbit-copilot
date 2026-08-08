import type { NativeRequest, NativeResponse } from "./types";

function isTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function request(input: NativeRequest): Promise<NativeResponse> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NativeResponse>("native_request", { request: input });
  }
  const response = await fetch("/bridge/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => ({ detail: response.statusText }));
  if (!response.ok) throw new Error(payload.detail || `网关请求失败 (${response.status})`);
  return payload;
}

export async function testEndpoint(input: NativeRequest): Promise<number> {
  const started = performance.now();
  const response = await request(input);
  if (response.status < 200 || response.status >= 400) throw new Error(`HTTP ${response.status}`);
  return Math.round(performance.now() - started);
}
