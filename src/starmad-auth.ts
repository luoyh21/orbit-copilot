import { request } from "./transport";
import type { ServiceSettings } from "./types";

const USERNAME_KEY = "orbit-copilot.starmad-managed-username.v1";
const PASSWORD_KEY = "starmad-managed-password";
const TOKEN_KEY = "starmad-auth-token";

interface LoginResponse {
  token?: string;
  user?: { username?: string };
}

export interface ManagedStarmadSession {
  service: ServiceSettings;
  username: string;
  registered: boolean;
}

export function createManagedCredentials(): { username: string; password: string } {
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return {
    username: `orbit-copilot-${suffix}`,
    password: `Oc1-${crypto.randomUUID()}-${crypto.randomUUID()}`,
  };
}

async function login(service: ServiceSettings, username: string, password: string): Promise<string> {
  const response = await request({
    url: `${service.apiUrl.replace(/\/$/, "")}/api/auth/login`,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: { username, password },
    allowInvalidCerts: service.allowInvalidCerts,
    timeoutSeconds: 30,
  });
  if (response.status !== 200) throw new Error(`STARMAD 登录 HTTP ${response.status}`);
  const payload = response.body as LoginResponse;
  if (!payload.token) throw new Error("STARMAD 登录响应中没有 token");
  return payload.token;
}

async function register(service: ServiceSettings, username: string, password: string): Promise<void> {
  const response = await request({
    url: `${service.apiUrl.replace(/\/$/, "")}/api/auth/register`,
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: { username, password },
    allowInvalidCerts: service.allowInvalidCerts,
    timeoutSeconds: 30,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`STARMAD 注册 HTTP ${response.status}: ${JSON.stringify(response.body).slice(0, 200)}`);
}

export async function ensureManagedStarmadSession(service: ServiceSettings): Promise<ManagedStarmadSession> {
  if (!("__TAURI_INTERNALS__" in window)) return { service, username: "", registered: false };
  const { invoke } = await import("@tauri-apps/api/core");
  let username = localStorage.getItem(USERNAME_KEY) || "";
  let password = await invoke<string>("load_secret", { key: PASSWORD_KEY }).catch(() => "");
  let registered = false;

  if (!username || !password) {
    const credentials = createManagedCredentials();
    username = credentials.username;
    password = credentials.password;
    await register(service, username, password);
    registered = true;
  }

  const token = await login(service, username, password);
  await invoke("save_secret", { key: PASSWORD_KEY, value: password });
  await invoke("save_secret", { key: TOKEN_KEY, value: token });
  localStorage.setItem(USERNAME_KEY, username);
  return { service: { ...service, authToken: token }, username, registered };
}
