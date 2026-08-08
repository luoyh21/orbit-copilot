import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity, Bot, Check, ChevronRight, CircleAlert, Database, ExternalLink, Gauge,
  KeyRound, LoaderCircle, Menu, MessageSquarePlus, Orbit, PanelRightClose, PanelRightOpen,
  RadioTower, RefreshCw, Rocket, Send, Settings, ShieldCheck, Sparkles, Wrench, X,
} from "lucide-react";
import { runAgent } from "./agent";
import { discoverOpenApi } from "./openapi";
import { DEFAULT_TOOLS } from "./presets";
import { clearChat, hydrateSecrets, loadChat, loadSettings, loadTools, saveChat, saveSettings, saveTools } from "./storage";
import { testEndpoint } from "./transport";
import type { ApiTool, AppSettings, ChatMessage, ServiceSettings, ToolRun } from "./types";

const starterPrompts = [
  { icon: RadioTower, title: "文昌附近碎片", text: "查询文昌发射场 500 公里范围、未来 6 小时的空间目标。" },
  { icon: Rocket, title: "发射风险评估", text: "评估 CZ-5B 从文昌发射的碰撞风险，使用真实目标，不注入演示威胁。" },
  { icon: Orbit, title: "获取轨道根数", text: "查询 NORAD 25544 的最新 TLE，并概括关键轨道参数。" },
  { icon: Database, title: "设计计算能力", text: "STARMAD 当前有哪些计算插件？按专业方向整理。" },
];

function uid() { return crypto.randomUUID(); }

function statusLabel(state: "idle" | "testing" | "ok" | "error", latency?: number) {
  if (state === "testing") return "检测中";
  if (state === "ok") return `${latency} ms`;
  if (state === "error") return "不可用";
  return "未检测";
}

export default function App() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [draft, setDraft] = useState<AppSettings>(() => loadSettings());
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadChat());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [tools, setTools] = useState<ApiTool[]>(() => loadTools(DEFAULT_TOOLS));
  const [activeRuns, setActiveRuns] = useState<ToolRun[]>([]);
  const [status, setStatus] = useState<Record<string, { state: "idle" | "testing" | "ok" | "error"; latency?: number }>>({});
  const bottomRef = useRef<HTMLDivElement>(null);
  const enabledCount = tools.filter((tool) => tool.enabled).length;

  useEffect(() => saveChat(messages), [messages]);
  useEffect(() => saveTools(tools), [tools]);
  useEffect(() => { hydrateSecrets(settings).then((value) => { setSettings(value); setDraft(structuredClone(value)); }); }, []);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages, activeRuns]);

  const serviceMap = useMemo(() => Object.fromEntries(settings.services.map((item) => [item.id, item])), [settings.services]);

  async function submit(text = input) {
    const value = text.trim();
    if (!value || busy) return;
    const user: ChatMessage = { id: uid(), role: "user", content: value, createdAt: Date.now() };
    const next = [...messages, user];
    setMessages(next); setInput(""); setBusy(true); setActiveRuns([]);
    try {
      const result = await runAgent(next, settings, tools, setActiveRuns);
      setMessages((current) => [...current, { id: uid(), role: "assistant", content: result.content, toolRuns: result.toolRuns, createdAt: Date.now() }]);
    } catch (error) {
      setMessages((current) => [...current, { id: uid(), role: "assistant", content: error instanceof Error ? error.message : String(error), error: true, createdAt: Date.now() }]);
    } finally { setBusy(false); setActiveRuns([]); }
  }

  function newChat() {
    clearChat(); setMessages([]); setActiveRuns([]); setMobileNav(false);
  }

  function openSettings() { setDraft(structuredClone(settings)); setSettingsOpen(true); }

  async function commitSettings() {
    await saveSettings(draft); setSettings(structuredClone(draft)); setSettingsOpen(false);
  }

  async function testService(service: ServiceSettings) {
    setStatus((old) => ({ ...old, [service.id]: { state: "testing" } }));
    const path = service.id === "debris" ? "/api/openapi.json" : "/api/health/lite";
    try {
      const latency = await testEndpoint({ url: `${service.apiUrl.replace(/\/$/, "")}${path}`, method: "GET", headers: service.authToken ? { Authorization: `Bearer ${service.authToken}` } : {}, allowInvalidCerts: service.allowInvalidCerts, timeoutSeconds: 10 });
      setStatus((old) => ({ ...old, [service.id]: { state: "ok", latency } }));
    } catch { setStatus((old) => ({ ...old, [service.id]: { state: "error" } })); }
  }

  async function syncOpenApi(service: ServiceSettings) {
    const key = `${service.id}-sync`;
    setStatus((old) => ({ ...old, [key]: { state: "testing" } }));
    try {
      const discovered = await discoverOpenApi(service);
      setTools((old) => [...old.filter((item) => !item.id.startsWith(`openapi-${service.id}-`)), ...discovered]);
      setStatus((old) => ({ ...old, [key]: { state: "ok", latency: discovered.length } }));
    } catch { setStatus((old) => ({ ...old, [key]: { state: "error" } })); }
  }

  function servicePatch(id: string, patch: Partial<ServiceSettings>) {
    setDraft((old) => ({ ...old, services: old.services.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Orbit size={22} /></span><div><strong>轨道智枢</strong><small>ORBIT COPILOT</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭菜单"><X /></button></div>
      <button className="new-chat" onClick={newChat}><MessageSquarePlus size={17} /> 新建任务 <span>Ctrl K</span></button>
      <div className="sidebar-label">工作空间</div>
      <nav className="nav-list">
        <button className="active"><Sparkles size={17} /> 智能对话 <span className="live-dot" /></button>
        <a href={serviceMap.debris?.dashboardUrl} target="_blank" rel="noreferrer"><Gauge size={17} /> 碎片监测 <ExternalLink size={13} /></a>
        <a href={serviceMap.starmad?.dashboardUrl} target="_blank" rel="noreferrer"><Database size={17} /> 协同设计 <ExternalLink size={13} /></a>
      </nav>
      <div className="sidebar-label">最近</div>
      <div className="history-item"><span>当前对话</span><small>{messages.length ? `${messages.length} 条消息` : "尚未开始"}</small></div>
      <div className="sidebar-spacer" />
      <div className="privacy-note"><ShieldCheck size={16} /><div><strong>本地优先</strong><small>配置与对话仅保存在本机</small></div></div>
      <button className="settings-link" onClick={openSettings}><Settings size={17} /> 设置 <ChevronRight size={15} /></button>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Menu /></button>
        <div><span className="eyebrow">MISSION CONSOLE</span><h1>智能任务台</h1></div>
        <div className="top-actions"><span className="connection-pill"><span /> 本地模式</span><button onClick={() => setToolsOpen(!toolsOpen)} aria-label="切换工具面板">{toolsOpen ? <PanelRightClose /> : <PanelRightOpen />}</button><button onClick={openSettings} aria-label="设置"><Settings /></button></div>
      </header>

      <section className="chat-area">
        {!messages.length ? <div className="welcome">
          <div className="orb"><div className="orb-core"><Bot size={34} /></div><i /><i /></div>
          <span className="welcome-kicker">OFFLINE-FIRST AI OPERATIONS</span>
          <h2>今天要分析什么任务？</h2>
          <p>连接空间碎片监测与 STARMAD-COMET，让模型基于真实接口数据回答、计算和协作。</p>
          <div className="prompt-grid">{starterPrompts.map(({ icon: Icon, title, text }) => <button key={title} onClick={() => submit(text)}><Icon size={19} /><strong>{title}</strong><span>{text}</span><ChevronRight size={15} /></button>)}</div>
        </div> : <div className="message-list">
          {messages.map((message) => <article key={message.id} className={`message ${message.role} ${message.error ? "message-error" : ""}`}>
            <div className="avatar">{message.role === "assistant" ? <Bot size={18} /> : "你"}</div>
            <div className="message-body"><div className="message-meta">{message.role === "assistant" ? "轨道智枢" : "你"}<time>{new Date(message.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
              {message.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <p>{message.content}</p>}
              {!!message.toolRuns?.length && <ToolRuns runs={message.toolRuns} />}
            </div>
          </article>)}
          {busy && <article className="message assistant"><div className="avatar"><Bot size={18} /></div><div className="message-body"><div className="message-meta">轨道智枢 <span className="thinking">正在编排任务</span></div>{activeRuns.length ? <ToolRuns runs={activeRuns} /> : <div className="typing"><i /><i /><i /></div>}</div></article>}
          <div ref={bottomRef} />
        </div>}
      </section>

      <footer className="composer-wrap"><div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="询问监测数据、发射风险或协同设计…" rows={1} disabled={busy} /><button onClick={() => submit()} disabled={!input.trim() || busy} aria-label="发送">{busy ? <LoaderCircle className="spin" /> : <Send />}</button></div><div className="composer-foot"><span><Wrench size={13} /> {enabledCount} 个工具已启用</span><span>Enter 发送 · Shift Enter 换行</span></div></footer>
    </main>

    {toolsOpen && <aside className="context-panel"><div className="panel-head"><div><span className="eyebrow">CONNECTED SYSTEMS</span><h3>能力与连接</h3></div><button onClick={() => setToolsOpen(false)}><X /></button></div>
      <div className="service-stack">{settings.services.map((service) => { const info = status[service.id] || { state: "idle" as const }; const sync = status[`${service.id}-sync`] || { state: "idle" as const }; return <div className="service-card" key={service.id}><div className="service-title"><span className={`service-icon ${service.id}`}><Activity /></span><div><strong>{service.name}</strong><small>{service.id === "debris" ? "8502 REST API" : "18502 REST API"}</small></div><span className={`status-dot ${info.state}`} /></div><div className="service-url">{service.apiUrl.replace(/^https?:\/\//, "")}</div><div className="service-actions"><button onClick={() => testService(service)} disabled={info.state === "testing"}>{info.state === "ok" && <Check size={14} />}{statusLabel(info.state, info.latency)}</button><button onClick={() => syncOpenApi(service)} disabled={sync.state === "testing"}><RefreshCw className={sync.state === "testing" ? "spin" : ""} size={13} />{sync.state === "ok" ? `发现 ${sync.latency} 项` : sync.state === "error" ? "同步失败" : "同步 OpenAPI"}</button></div></div>; })}</div>
      <div className="tool-heading"><span>工具注册表</span><em>{enabledCount}/{tools.length}</em></div>
      <div className="tool-list">{tools.map((tool) => <label key={tool.id}><span><strong>{tool.title}</strong><small>{tool.serviceId === "debris" ? "碎片监测" : "协同设计"}</small></span><input type="checkbox" checked={tool.enabled} onChange={() => setTools((old) => old.map((item) => item.id === tool.id ? { ...item, enabled: !item.enabled } : item))} /><i /></label>)}</div>
    </aside>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置"><header><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>连接设置</h2><p>地址与密钥由当前设备使用，不写入业务服务数据库。</p></div><button onClick={() => setSettingsOpen(false)}><X /></button></header>
      <div className="settings-content"><section><h3><KeyRound size={17} /> 模型服务</h3><div className="form-grid"><label className="wide">API 地址<input value={draft.llm.baseUrl} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, baseUrl: e.target.value } })} placeholder="http://127.0.0.1:11434/v1" /></label><label>模型名称<input value={draft.llm.model} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, model: e.target.value } })} /></label><label>API Key<input type="password" value={draft.llm.apiKey} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, apiKey: e.target.value } })} placeholder="本地模型可留空" /></label><label>温度 <span>{draft.llm.temperature}</span><input type="range" min="0" max="1" step="0.1" value={draft.llm.temperature} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, temperature: Number(e.target.value) } })} /></label><label>最大工具轮次<input type="number" min="1" max="12" value={draft.llm.maxSteps} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, maxSteps: Number(e.target.value) } })} /></label></div></section>
        {draft.services.map((service) => <section key={service.id}><h3>{service.id === "debris" ? <RadioTower size={17} /> : <Database size={17} />} {service.name}</h3><div className="form-grid"><label className="wide">API 地址<input value={service.apiUrl} onChange={(e) => servicePatch(service.id, { apiUrl: e.target.value })} /></label><label className="wide">页面入口<input value={service.dashboardUrl} onChange={(e) => servicePatch(service.id, { dashboardUrl: e.target.value })} /></label><label className="wide">Bearer Token（如需要）<input type="password" value={service.authToken} onChange={(e) => servicePatch(service.id, { authToken: e.target.value })} placeholder={service.id === "starmad" ? "登录后获得的令牌" : "通常留空"} /></label><label className="check-label"><input type="checkbox" checked={service.allowInvalidCerts} onChange={(e) => servicePatch(service.id, { allowInvalidCerts: e.target.checked })} /> 接受自签名证书（仅桌面端）</label></div></section>)}
        <section><h3><Bot size={17} /> 助手规则</h3><label className="wide"><textarea rows={6} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} /></label></section>
      </div><footer><span><CircleAlert size={14} /> Web 版需由服务器允许目标主机；Windows 版可直接访问内网。</span><button className="secondary" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary" onClick={commitSettings}>保存设置</button></footer>
    </section></div>}
  </div>;
}

function ToolRuns({ runs }: { runs: ToolRun[] }) {
  return <div className="tool-runs">{runs.map((run) => <div key={run.id} className={`tool-run ${run.state}`}><span>{run.state === "running" ? <LoaderCircle className="spin" /> : run.state === "success" ? <Check /> : <CircleAlert />}</span><div><strong>{run.title}</strong><small>{run.state === "running" ? "正在调用…" : run.state === "success" ? `已完成 · ${run.durationMs} ms` : "调用失败"}</small></div></div>)}</div>;
}
