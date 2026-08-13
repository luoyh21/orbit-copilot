import { request } from "./transport";
import type { DailyNews, NewsEdition, ServiceSettings } from "./types";

const LAST_PREFIX = "orbit-copilot.news-notified.v1";

function isTauri(): boolean { return "__TAURI_INTERNALS__" in window; }

function localDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export async function configureAutostart(enabled: boolean): Promise<void> {
  if (!isTauri()) return;
  const { disable, enable, isEnabled } = await import("@tauri-apps/plugin-autostart");
  const current = await isEnabled();
  if (enabled && !current) await enable();
  if (!enabled && current) await disable();
}

async function fetchDaily(service: ServiceSettings, date: string, edition: NewsEdition): Promise<DailyNews> {
  const response = await request({
    url: `${service.apiUrl.replace(/\/+$/, "")}/daily?date=${date}&edition=${edition}`,
    method: "GET",
    headers: {},
    allowInvalidCerts: service.allowInvalidCerts,
    timeoutSeconds: 20,
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`新闻 API 返回 HTTP ${response.status}`);
  return response.body as DailyNews;
}

export async function sendNewsNotification(service: ServiceSettings, date: string, edition: NewsEdition, force = false): Promise<boolean> {
  if (!isTauri()) throw new Error("Windows 通知仅在桌面安装版中可用");
  const key = `${LAST_PREFIX}.${date}.${edition}`;
  if (!force && localStorage.getItem(key)) return false;
  const daily = await fetchDaily(service, date, edition);
  if (!daily.count && !force) return false;
  const notification = await import("@tauri-apps/plugin-notification");
  let granted = await notification.isPermissionGranted();
  if (!granted) granted = await notification.requestPermission() === "granted";
  if (!granted) throw new Error("Windows 通知权限未开启");
  const names = daily.items.slice(0, 2).map((item) => item.title).join("；");
  notification.sendNotification({
    title: `航天速递 · ${edition === "morning" ? "上午刊" : "下午刊"}`,
    body: daily.count ? `今日新增 ${daily.count} 条：${names}` : "通知测试成功；当前刊次暂未生成新闻。",
    autoCancel: true,
    extra: { kind: "space-news", date, edition },
  });
  if (!force) localStorage.setItem(key, String(Date.now()));
  return true;
}

export async function setupNewsNotificationScheduler(
  service: ServiceSettings | undefined,
  enabled: boolean,
  onOpenNews: (date: string, edition: NewsEdition) => void,
): Promise<() => void> {
  if (!isTauri() || !service) return () => {};
  const activeService = service;
  const notification = await import("@tauri-apps/plugin-notification");
  const actionListener = await notification.onAction((notice) => {
    const extra = notice.extra || {};
    if (extra.kind !== "space-news") return;
    const date = typeof extra.date === "string" ? extra.date : localDate();
    const edition: NewsEdition = extra.edition === "evening" ? "evening" : "morning";
    onOpenNews(date, edition);
    void import("@tauri-apps/api/core").then(({ invoke }) => invoke("show_main_window"));
  });

  async function check() {
    if (!enabled) return;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    let edition: NewsEdition | null = null;
    if (minutes >= 16 * 60 + 30) edition = "evening";
    else if (minutes >= 8 * 60 + 30) edition = "morning";
    if (!edition) return;
    await sendNewsNotification(activeService, localDate(), edition).catch(() => {});
  }

  void check();
  const timer = window.setInterval(() => void check(), 60_000);
  return () => {
    window.clearInterval(timer);
    actionListener.unregister();
  };
}
