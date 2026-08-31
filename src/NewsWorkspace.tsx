import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, ExternalLink, ImageOff, LoaderCircle, Newspaper, RefreshCw, Satellite, WifiOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadOfflineNews, mergeNewsItems, newsKind, type OfflineNewsKind, type OfflineNewsResponse } from "./offline-news";
import { loadTechPortNews } from "./techport-news";
import { request } from "./transport";
import type { DailyNews, NewsEdition, NewsItem, ServiceSettings } from "./types";

type NewsSource = "all" | OfflineNewsKind;

function localDate(offsetDays = 0): string {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + offsetDays);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(value: string, offset: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function loadDaily(service: ServiceSettings, date: string, edition: NewsEdition): Promise<DailyNews> {
  const base = service.apiUrl.replace(/\/+$/, "");
  const response = await request({
    url: `${base}/daily?date=${encodeURIComponent(date)}&edition=${edition}`,
    method: "GET",
    headers: {},
    allowInvalidCerts: service.allowInvalidCerts,
    timeoutSeconds: 20,
  });
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.body === "object" && response.body && "detail" in response.body ? String((response.body as { detail: unknown }).detail) : "请求失败";
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return response.body as DailyNews;
}

export function NewsWorkspace({ service, onOpenUrl, target }: { service?: ServiceSettings; onOpenUrl: (url: string) => void; target?: { date: string; edition: NewsEdition; nonce: number } }) {
  const today = useMemo(() => localDate(), []);
  const minimum = useMemo(() => localDate(-30), []);
  const [date, setDate] = useState(today);
  const [edition, setEdition] = useState<NewsEdition>(() => new Date().getHours() < 16 ? "morning" : "evening");
  const [source, setSource] = useState<NewsSource>("all");
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [daily, setDaily] = useState<DailyNews | null>(null);
  const [techPortItems, setTechPortItems] = useState<NewsItem[]>([]);
  const [offlineData, setOfflineData] = useState<OfflineNewsResponse | null>(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [techPortLoading, setTechPortLoading] = useState(false);
  const [dailyError, setDailyError] = useState("");
  const [techPortError, setTechPortError] = useState("");
  const [offlineError, setOfflineError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const handleOffline = () => setOnline(false);
    const handleOnline = () => {
      setOnline(true);
      setReload((value) => value + 1);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    if (target.date >= minimum && target.date <= today) setDate(target.date);
    setEdition(target.edition);
  }, [target, minimum, today]);

  useEffect(() => {
    let active = true;
    setOfflineError("");
    loadOfflineNews(date).then((payload) => {
      if (active) setOfflineData(payload);
    }).catch((reason) => {
      if (active) setOfflineError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, [date, reload]);

  useEffect(() => {
    if (!online) return;
    if (!service) {
      setDaily(null);
      setDailyError("尚未配置每日新闻服务");
      return;
    }
    let active = true;
    setDailyLoading(true);
    setDailyError("");
    setDaily(null);
    loadDaily(service, date, edition).then((payload) => {
      if (active) setDaily(payload);
    }).catch((reason) => {
      if (active) setDailyError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setDailyLoading(false); });
    return () => { active = false; };
  }, [service, date, edition, reload, online]);

  useEffect(() => {
    if (!online) return;
    let active = true;
    setTechPortLoading(true);
    setTechPortError("");
    setTechPortItems([]);
    loadTechPortNews(date).then((items) => {
      if (active) setTechPortItems(items);
    }).catch((reason) => {
      if (active) setTechPortError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (active) setTechPortLoading(false); });
    return () => { active = false; };
  }, [date, reload, online]);

  function move(offset: number) {
    const next = shiftDate(date, offset);
    if (next >= minimum && next <= today) setDate(next);
  }

  const dailyItems = (daily?.items || []).map((item) => ({ ...item, kind: newsKind(item) }));
  const liveTechPortItems = techPortItems.map((item) => ({ ...item, kind: "techport" }));
  const allItems = mergeNewsItems(dailyItems, liveTechPortItems, offlineData?.items || []);
  const visibleItems = source === "all" ? allItems : allItems.filter((item) => newsKind(item) === source);
  const loading = online && (dailyLoading || techPortLoading);
  const hasErrors = Boolean(dailyError || techPortError);
  const sourceFilters: Array<{ id: NewsSource; label: string; count: number }> = [
    { id: "all", label: "全部", count: allItems.length },
    { id: "debris", label: "新增碎片", count: allItems.filter((item) => newsKind(item) === "debris").length },
    { id: "spacenews", label: "SpaceNews", count: allItems.filter((item) => newsKind(item) === "spacenews").length },
    { id: "techport", label: "NASA TechPort", count: allItems.filter((item) => newsKind(item) === "techport").length },
    { id: "news", label: "新闻", count: allItems.filter((item) => newsKind(item) === "news").length },
  ];

  return <section className="news-workspace" aria-label="航天新闻">
    <div className="news-toolbar">
      <div><span className="eyebrow">SPACE NEWS &amp; TECHNOLOGY</span><h2><Newspaper /> 航天新闻</h2><p>聚合本月新增碎片、SpaceNews、NASA TechPort 与综合新闻；支持更新包离线查看。</p></div>
      <div className="news-date-controls"><button onClick={() => move(-1)} disabled={date <= minimum} aria-label="前一天"><ChevronLeft /></button><label><CalendarDays /><input type="date" min={minimum} max={today} value={date} onChange={(event) => setDate(event.target.value)} /></label><button onClick={() => move(1)} disabled={date >= today} aria-label="后一天"><ChevronRight /></button><button onClick={() => setReload((value) => value + 1)} aria-label="刷新"><RefreshCw className={loading ? "spin" : ""} /></button></div>
    </div>
    <div className="edition-tabs" role="tablist">
      {(["morning", "evening"] as NewsEdition[]).map((name) => <button key={name} role="tab" aria-selected={edition === name} className={edition === name ? "active" : ""} onClick={() => setEdition(name)}><strong>{name === "morning" ? "上午刊" : "下午刊"}</strong><span>{daily?.editions?.[name]?.available ? `${daily.editions[name].count} 条` : "暂无"}</span></button>)}
      <div className="news-source-filters" aria-label="新闻来源">
        {sourceFilters.map((item) => <button key={item.id} className={source === item.id ? "active" : ""} onClick={() => setSource(item.id)}>{item.label}<span>{item.count}</span></button>)}
      </div>
      {daily?.web_url && <button className="daily-web-link" onClick={() => onOpenUrl(daily.web_url)}>当日网页 <ExternalLink /></button>}
    </div>
    <div className="news-scroll">
      {!online && allItems.length > 0 && <div className="news-warning offline-snapshot"><WifiOff /><span>当前设备已断网，无法获取更新包生成后的新闻；正在显示 {offlineData?.dateFrom} 至 {offlineData?.dateTo} 的本地数据。</span></div>}
      {!online && allItems.length === 0 && <div className="news-state offline"><WifiOff /><strong>当前设备已断网</strong><span>{offlineError ? `本地更新数据校验失败：${offlineError}` : "未找到可用的本月新闻更新数据，请先运行独立更新 EXE。"}</span></div>}
      {online && loading && allItems.length === 0 && <div className="news-state"><LoaderCircle className="spin" /><strong>正在聚合航天新闻</strong><span>正在同步四类本月数据</span></div>}
      {online && !loading && hasErrors && allItems.length === 0 && <div className="news-state error"><WifiOff /><strong>新闻网络不可用</strong><span>{[dailyError, techPortError, offlineError].filter(Boolean).join("；")}</span><button onClick={() => setReload((value) => value + 1)}>重新加载</button></div>}
      {online && allItems.length > 0 && hasErrors && <div className="news-warning"><AlertTriangle /><span>部分在线来源暂时不可用，已用更新包数据补充：{[dailyError, techPortError].filter(Boolean).join("；")}</span></div>}
      {online && allItems.length > 0 && loading && <div className="news-syncing"><LoaderCircle className="spin" /> 正在同步其他来源…</div>}
      {!loading && allItems.length === 0 && (online || offlineData?.available) && <div className="news-state"><Newspaper /><strong>所选日期暂无更新</strong><span>可切换到本月其他日期查看离线更新数据。</span></div>}
      {allItems.length > 0 && visibleItems.length === 0 && <div className="news-state"><Satellite /><strong>该来源当日暂无更新</strong><span>请切换“全部”或其他新闻来源。</span></div>}
      {visibleItems.length > 0 && <div className="news-grid">{visibleItems.map((item) => <article className={`news-card ${item.kind}`} key={item.id}>
        <div className="news-cover">{item.image && online ? <img src={item.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} /> : null}<span hidden={Boolean(item.image && online)}>{item.kind === "techport" ? <Satellite /> : <ImageOff />}</span></div>
        <div className="news-card-body"><div className="news-meta"><span>{item.source}</span><time>{item.published || date}</time></div><h3>{item.title}</h3><p>{item.summary || "该条目暂无概要。"}</p>{item.tags?.length > 0 && <div className="news-tags">{item.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>}<div className="news-links">{item.page_url && <button disabled={!online} onClick={() => onOpenUrl(item.page_url)}>{online ? "阅读全文" : "联网查看全文"} <ExternalLink /></button>}{item.original_url && <button disabled={!online} onClick={() => onOpenUrl(item.original_url)}>原始网址 <ExternalLink /></button>}</div></div>
      </article>)}</div>}
      {online && source !== "techport" && daily?.qr_url && <footer className="news-qr"><img src={daily.qr_url} alt="航天速递二维码" /><div><strong>关注航天速递</strong><span>扫码在微信中查看每日更新</span></div></footer>}
    </div>
  </section>;
}
