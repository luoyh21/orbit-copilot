import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, ImageOff, LoaderCircle, Newspaper, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { request } from "./transport";
import type { DailyNews, NewsEdition, ServiceSettings } from "./types";

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
  const [daily, setDaily] = useState<DailyNews | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!target) return;
    if (target.date >= minimum && target.date <= today) setDate(target.date);
    setEdition(target.edition);
  }, [target, minimum, today]);

  useEffect(() => {
    if (!service) return;
    let active = true;
    setLoading(true);
    setError("");
    loadDaily(service, date, edition).then((payload) => {
      if (active) setDaily(payload);
    }).catch((reason) => {
      if (active) {
        setDaily(null);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service, date, edition, reload]);

  function move(offset: number) {
    const next = shiftDate(date, offset);
    if (next >= minimum && next <= today) setDate(next);
  }

  return <section className="news-workspace" aria-label="航天新闻">
    <div className="news-toolbar">
      <div><span className="eyebrow">SPACE NEWS DAILY</span><h2><Newspaper /> 航天速递</h2><p>图片、概要和全文直接来自每日新闻服务，不经过 GPT。</p></div>
      <div className="news-date-controls"><button onClick={() => move(-1)} disabled={date <= minimum} aria-label="前一天"><ChevronLeft /></button><label><CalendarDays /><input type="date" min={minimum} max={today} value={date} onChange={(event) => setDate(event.target.value)} /></label><button onClick={() => move(1)} disabled={date >= today} aria-label="后一天"><ChevronRight /></button><button onClick={() => setReload((value) => value + 1)} aria-label="刷新"><RefreshCw className={loading ? "spin" : ""} /></button></div>
    </div>
    <div className="edition-tabs" role="tablist">
      {(["morning", "evening"] as NewsEdition[]).map((name) => <button key={name} role="tab" aria-selected={edition === name} className={edition === name ? "active" : ""} onClick={() => setEdition(name)}><strong>{name === "morning" ? "上午刊" : "下午刊"}</strong><span>{daily?.editions?.[name]?.available ? `${daily.editions[name].count} 条` : "暂无"}</span></button>)}
      {daily?.web_url && <button className="daily-web-link" onClick={() => onOpenUrl(daily.web_url)}>打开当日网页 <ExternalLink /></button>}
    </div>
    <div className="news-scroll">
      {loading && <div className="news-state"><LoaderCircle className="spin" /><strong>正在获取当日新闻</strong></div>}
      {!loading && error && <div className="news-state error"><ImageOff /><strong>新闻加载失败</strong><span>{error}</span><button onClick={() => setReload((value) => value + 1)}>重新加载</button></div>}
      {!loading && !error && daily && !daily.items.length && <div className="news-state"><Newspaper /><strong>该时段暂无新闻</strong><span>可以切换上午刊/下午刊，或选择此前 30 天的日期。</span></div>}
      {!loading && !error && daily && daily.items.length > 0 && <div className="news-grid">{daily.items.map((item) => <article className="news-card" key={item.id}>
        <div className="news-cover">{item.image ? <img src={item.image} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; event.currentTarget.nextElementSibling?.removeAttribute("hidden"); }} /> : null}<span hidden={Boolean(item.image)}><ImageOff /></span></div>
        <div className="news-card-body"><div className="news-meta"><span>{item.source}</span><time>{item.published || date}</time></div><h3>{item.title}</h3><p>{item.summary || "该条目暂无概要，可打开全文查看。"}</p>{item.tags?.length > 0 && <div className="news-tags">{item.tags.slice(0, 4).map((tag) => <span key={tag}>#{tag}</span>)}</div>}<div className="news-links"><button onClick={() => onOpenUrl(item.page_url)}>阅读全文 <ExternalLink /></button>{item.original_url && <button onClick={() => onOpenUrl(item.original_url)}>原始网址 <ExternalLink /></button>}</div></div>
      </article>)}</div>}
      {!loading && daily?.qr_url && <footer className="news-qr"><img src={daily.qr_url} alt="航天速递二维码" /><div><strong>关注航天速递</strong><span>扫码在微信中查看每日更新</span></div></footer>}
    </div>
  </section>;
}
