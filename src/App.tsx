import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity, Bot, Boxes, Check, ChevronLeft, ChevronRight, CircleAlert, Database, ExternalLink, Gauge,
  KeyRound, LoaderCircle, Menu, MessageSquarePlus, Orbit, PanelRightClose, PanelRightOpen,
  RadioTower, RefreshCw, Rocket, Send, Settings, ShieldCheck, Sparkles, Trash2, Wrench, X,
} from "lucide-react";
import { runAgent } from "./agent";
import { discoverOpenApi, mergeDiscoveredTools } from "./openapi";
import { applyPluginSelection, DEFAULT_TOOLS, PLUGIN_PACKS } from "./presets";
import { ensureManagedStarmadSession } from "./starmad-auth";
import { createChatSession, hasCompletedPluginSetup, hasConfiguredLlm, hydrateSecrets, loadChats, loadInstalledPlugins, loadSettings, loadTools, saveChats, saveInstalledPlugins, saveSettings, saveTools } from "./storage";
import { testEndpoint } from "./transport";
import type { ApiTool, AppSettings, ChatMessage, ServiceSettings, ToolRun } from "./types";

const starterPrompts = [
  { icon: RadioTower, title: "文昌附近碎片", text: "查询文昌发射场 500 公里范围、未来 6 小时的空间目标。" },
  { icon: Rocket, title: "发射风险评估", text: "评估 CZ-5B 从文昌发射的碰撞风险，使用真实目标，不注入演示威胁。" },
  { icon: Orbit, title: "获取轨道根数", text: "查询 NORAD 25544 的最新 TLE，并概括关键轨道参数。" },
  { icon: Database, title: "设计计算能力", text: "STARMAD 当前有哪些计算插件？按专业方向整理。" },
];
const TOOLS_PER_PAGE = 12;

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
  const [chatState, setChatState] = useState(() => loadChats());
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [llmSetupNeeded, setLlmSetupNeeded] = useState(() => !hasConfiguredLlm());
  const [settingsOpen, setSettingsOpen] = useState(() => hasCompletedPluginSetup() && !hasConfiguredLlm());
  const [settingsError, setSettingsError] = useState("");
  const [toolsOpen, setToolsOpen] = useState(true);
  const [toolPage, setToolPage] = useState(0);
  const [mobileNav, setMobileNav] = useState(false);
  const [tools, setTools] = useState<ApiTool[]>(() => loadTools(DEFAULT_TOOLS));
  const [pluginSetupOpen, setPluginSetupOpen] = useState(() => !hasCompletedPluginSetup());
  const [pluginCommitting, setPluginCommitting] = useState(false);
  const [selectedPlugins, setSelectedPlugins] = useState<ServiceSettings["id"][]>(() => loadInstalledPlugins());
  const [activeRuns, setActiveRuns] = useState<ToolRun[]>([]);
  const [status, setStatus] = useState<Record<string, { state: "idle" | "testing" | "ok" | "error"; latency?: number }>>({});
  const chatAreaRef = useRef<HTMLElement>(null);
  const starmadAuthStarted = useRef(false);
  const activeChat = chatState.sessions.find((session) => session.id === chatState.activeId) || chatState.sessions[0];
  const messages = activeChat?.messages || [];
  const activeChatId = activeChat?.id || "";
  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const toolPageCount = Math.max(1, Math.ceil(tools.length / TOOLS_PER_PAGE));
  const visibleTools = tools.slice(toolPage * TOOLS_PER_PAGE, (toolPage + 1) * TOOLS_PER_PAGE);

  useEffect(() => { saveChats(chatState); }, [chatState]);
  useEffect(() => { saveTools(tools); }, [tools]);
  useEffect(() => { setToolPage((page) => Math.min(page, toolPageCount - 1)); }, [toolPageCount]);
  useEffect(() => {
    if (starmadAuthStarted.current) return;
    starmadAuthStarted.current = true;
    hydrateSecrets(settings).then(async (value) => {
      let next = value;
      if (hasCompletedPluginSetup() && loadInstalledPlugins().includes("starmad")) {
        const service = value.services.find((item) => item.id === "starmad");
        if (service) {
          const started = performance.now();
          setStatus((old) => ({ ...old, starmad: { state: "testing" } }));
          try {
            const session = await ensureManagedStarmadSession(service);
            next = { ...value, services: value.services.map((item) => item.id === "starmad" ? session.service : item) };
            setStatus((old) => ({ ...old, starmad: { state: "ok", latency: Math.round(performance.now() - started) } }));
          } catch {
            setStatus((old) => ({ ...old, starmad: { state: "error" } }));
          }
        }
      }
      setSettings(next);
      setDraft(structuredClone(next));
      if (hasCompletedPluginSetup()) await syncInstalledOpenApis(next, loadInstalledPlugins());
    });
  }, []);
  useEffect(() => {
    const area = chatAreaRef.current;
    if (area) area.scrollTo({ top: area.scrollHeight, behavior: "smooth" });
  }, [messages, activeRuns]);

  const serviceMap = useMemo(() => Object.fromEntries(settings.services.map((item) => [item.id, item])), [settings.services]);

  function updateChatMessages(chatId: string, update: ChatMessage[] | ((current: ChatMessage[]) => ChatMessage[])) {
    setChatState((old) => ({
      ...old,
      sessions: old.sessions.map((session) => {
        if (session.id !== chatId) return session;
        const nextMessages = typeof update === "function" ? update(session.messages) : update;
        const firstUserMessage = nextMessages.find((message) => message.role === "user")?.content.trim();
        return {
          ...session,
          title: session.title === "新对话" && firstUserMessage ? firstUserMessage.slice(0, 24) : session.title,
          messages: nextMessages,
          updatedAt: Date.now(),
        };
      }),
    }));
  }

  async function submit(text = input) {
    const value = text.trim();
    if (!value || busy) return;
    const chatId = activeChatId;
    const user: ChatMessage = { id: uid(), role: "user", content: value, createdAt: Date.now() };
    const next = [...messages, user];
    updateChatMessages(chatId, next); setInput(""); setBusy(true); setActiveRuns([]);
    try {
      const result = await runAgent(next, settings, tools, setActiveRuns);
      updateChatMessages(chatId, (current) => [...current, { id: uid(), role: "assistant", content: result.content, toolRuns: result.toolRuns, createdAt: Date.now() }]);
    } catch (error) {
      updateChatMessages(chatId, (current) => [...current, { id: uid(), role: "assistant", content: error instanceof Error ? error.message : String(error), error: true, createdAt: Date.now() }]);
    } finally { setBusy(false); setActiveRuns([]); }
  }

  function newChat() {
    if (busy) return;
    const session = createChatSession();
    setChatState((old) => ({ sessions: [session, ...old.sessions], activeId: session.id }));
    setInput(""); setActiveRuns([]); setMobileNav(false);
  }

  function switchChat(id: string) {
    if (busy || id === activeChatId) return;
    setChatState((old) => ({ ...old, activeId: id }));
    setInput(""); setActiveRuns([]); setMobileNav(false);
  }

  function deleteChat(id: string) {
    if (busy) return;
    setChatState((old) => {
      const remaining = old.sessions.filter((session) => session.id !== id);
      if (!remaining.length) {
        const session = createChatSession();
        return { sessions: [session], activeId: session.id };
      }
      return { sessions: remaining, activeId: old.activeId === id ? remaining[0].id : old.activeId };
    });
  }

  function openSettings() { setDraft(structuredClone(settings)); setSettingsError(""); setSettingsOpen(true); }

  function openPluginSetup() {
    setSelectedPlugins(loadInstalledPlugins());
    setPluginSetupOpen(true);
  }

  function togglePlugin(id: ServiceSettings["id"]) {
    setSelectedPlugins((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id]);
  }

  async function openDashboard(url: string | undefined) {
    if (!url) return;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("unsupported protocol");
      if ("__TAURI_INTERNALS__" in window) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(parsed.toString());
      } else {
        window.open(parsed.toString(), "_blank", "noopener,noreferrer");
      }
    } catch {
      window.alert("无法打开页面入口，请在设置中检查页面地址。");
    }
  }

  async function syncInstalledOpenApis(currentSettings: AppSettings, pluginIds: ServiceSettings["id"][]) {
    const selected = new Set(pluginIds);
    const services = currentSettings.services.filter((service) => selected.has(service.id));
    setStatus((old) => Object.fromEntries(Object.entries(old).concat(services.map((service) => [`${service.id}-sync`, { state: "testing" as const }]))));
    const results = await Promise.all(services.map(async (service) => {
      try {
        return { service, discovered: await discoverOpenApi(service) };
      } catch {
        return { service, discovered: null };
      }
    }));
    setTools((old) => {
      const merged = results.reduce((current, result) => result.discovered ? mergeDiscoveredTools(current, result.discovered, result.service.id) : current, old);
      return applyPluginSelection(merged, pluginIds);
    });
    setStatus((old) => {
      const next = { ...old };
      for (const result of results) next[`${result.service.id}-sync`] = result.discovered ? { state: "ok", latency: result.discovered.length } : { state: "error" };
      return next;
    });
  }

  async function commitPluginSetup() {
    if (pluginCommitting) return;
    setPluginCommitting(true);
    setTools((old) => applyPluginSelection(old, selectedPlugins));
    saveInstalledPlugins(selectedPlugins);
    let nextSettings = settings;
    if (selectedPlugins.includes("starmad")) {
      const service = settings.services.find((item) => item.id === "starmad");
      if (service) {
        const started = performance.now();
        setStatus((old) => ({ ...old, starmad: { state: "testing" } }));
        try {
          const session = await ensureManagedStarmadSession(service);
          const next = { ...settings, services: settings.services.map((item) => item.id === "starmad" ? session.service : item) };
          nextSettings = next;
          setSettings(next);
          setDraft(structuredClone(next));
          setStatus((old) => ({ ...old, starmad: { state: "ok", latency: Math.round(performance.now() - started) } }));
        } catch {
          setStatus((old) => ({ ...old, starmad: { state: "error" } }));
        }
      }
    }
    await syncInstalledOpenApis(nextSettings, selectedPlugins);
    setPluginCommitting(false);
    setPluginSetupOpen(false);
    if (llmSetupNeeded) setSettingsOpen(true);
  }

  async function commitSettings() {
    if (!draft.llm.baseUrl.trim() || !draft.llm.model.trim()) {
      setSettingsError("请填写 LLM API 地址和模型名称后再保存。");
      return;
    }
    try {
      const url = new URL(draft.llm.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
    } catch {
      setSettingsError("LLM API 地址格式无效，请填写完整的 http:// 或 https:// 地址。");
      return;
    }
    await saveSettings(draft);
    setSettings(structuredClone(draft));
    setLlmSetupNeeded(false);
    setSettingsError("");
    setSettingsOpen(false);
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
      setTools((old) => applyPluginSelection(mergeDiscoveredTools(old, discovered, service.id), loadInstalledPlugins()));
      setStatus((old) => ({ ...old, [key]: { state: "ok", latency: discovered.length } }));
    } catch { setStatus((old) => ({ ...old, [key]: { state: "error" } })); }
  }

  function servicePatch(id: string, patch: Partial<ServiceSettings>) {
    setDraft((old) => ({ ...old, services: old.services.map((item) => item.id === id ? { ...item, ...patch } : item) }));
  }

  return <div className={`app-shell ${toolsOpen ? "" : "tools-collapsed"}`}>
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Orbit size={22} /></span><div><strong>轨道智枢</strong><small>ORBIT COPILOT</small></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="关闭菜单"><X /></button></div>
      <button className="new-chat" onClick={newChat} disabled={busy}><MessageSquarePlus size={17} /> 新建对话</button>
      <div className="sidebar-label">工作空间</div>
      <nav className="nav-list">
        <button className="active"><Sparkles size={17} /> 智能对话 <span className="live-dot" /></button>
        <button onClick={() => void openDashboard(serviceMap.debris?.dashboardUrl)}><Gauge size={17} /> 碎片监测 <ExternalLink size={13} /></button>
        <button onClick={() => void openDashboard(serviceMap.starmad?.dashboardUrl)}><Database size={17} /> 协同设计 <ExternalLink size={13} /></button>
      </nav>
      <div className="sidebar-label">对话历史</div>
      <div className="history-list">{[...chatState.sessions].sort((a, b) => b.updatedAt - a.updatedAt).map((session) => <div className={`history-item ${session.id === activeChatId ? "active" : ""}`} key={session.id}>
        <button className="history-select" onClick={() => switchChat(session.id)} disabled={busy}><span>{session.title}</span><small>{session.messages.length ? `${session.messages.length} 条消息` : "尚未开始"}</small></button>
        <button className="history-delete" onClick={() => deleteChat(session.id)} disabled={busy} aria-label={`删除对话 ${session.title}`}><Trash2 size={13} /></button>
      </div>)}</div>
      <div className="sidebar-spacer" />
      <div className="privacy-note"><ShieldCheck size={16} /><div><strong>本地优先</strong><small>配置与对话仅保存在本机</small></div></div>
      <button className="settings-link" onClick={openPluginSetup}><Boxes size={17} /> 插件中心 <span className="plugin-count">{selectedPlugins.length}</span><ChevronRight size={15} /></button>
      <button className="settings-link" onClick={openSettings}><Settings size={17} /> 设置 <ChevronRight size={15} /></button>
    </aside>

    <main className="workspace">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="打开菜单"><Menu /></button>
        <div><span className="eyebrow">MISSION CONSOLE</span><h1>智能任务台</h1></div>
        <div className="top-actions"><span className="connection-pill"><span /> 本地模式</span><button onClick={() => setToolsOpen(!toolsOpen)} aria-label="切换工具面板">{toolsOpen ? <PanelRightClose /> : <PanelRightOpen />}</button><button onClick={openSettings} aria-label="设置"><Settings /></button></div>
      </header>

      <section className="chat-area" ref={chatAreaRef}>
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
          <div />
        </div>}
      </section>

      <footer className="composer-wrap"><div className="composer"><textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); } }} placeholder="询问监测数据、发射风险或协同设计…" rows={1} disabled={busy} /><button onClick={() => submit()} disabled={!input.trim() || busy} aria-label="发送">{busy ? <LoaderCircle className="spin" /> : <Send />}</button></div><div className="composer-foot"><span><Wrench size={13} /> {enabledCount} 个工具已启用</span><span>Enter 发送 · Shift Enter 换行</span></div></footer>
    </main>

    {toolsOpen && <aside className="context-panel"><div className="panel-head"><div><span className="eyebrow">CONNECTED SYSTEMS</span><h3>能力与连接</h3></div><button onClick={() => setToolsOpen(false)} aria-label="收起右侧工具栏"><PanelRightClose /></button></div>
      <div className="service-stack">{settings.services.map((service) => { const info = status[service.id] || { state: "idle" as const }; const sync = status[`${service.id}-sync`] || { state: "idle" as const }; return <div className="service-card" key={service.id}><div className="service-title"><span className={`service-icon ${service.id}`}><Activity /></span><div><strong>{service.name}</strong><small>{service.id === "debris" ? "8502 REST API" : "18502 REST API"}</small></div><span className={`status-dot ${info.state}`} /></div><div className="service-url">{service.apiUrl.replace(/^https?:\/\//, "")}</div><div className="service-actions"><button onClick={() => testService(service)} disabled={info.state === "testing"}>{info.state === "ok" && <Check size={14} />}{statusLabel(info.state, info.latency)}</button><button onClick={() => syncOpenApi(service)} disabled={sync.state === "testing"}><RefreshCw className={sync.state === "testing" ? "spin" : ""} size={13} />{sync.state === "ok" ? `发现 ${sync.latency} 项` : sync.state === "error" ? "同步失败" : "同步 OpenAPI"}</button></div></div>; })}</div>
      <div className="tool-heading"><span>工具注册表</span><em>{enabledCount}/{tools.length}</em></div>
      <div className="tool-list">{visibleTools.map((tool) => <label key={tool.id}><span><strong>{tool.title}</strong><small>{tool.method} · {tool.serviceId === "debris" ? "碎片监测" : "协同设计"}</small></span><input type="checkbox" checked={tool.enabled} onChange={() => setTools((old) => old.map((item) => item.id === tool.id ? { ...item, enabled: !item.enabled } : item))} /><i /></label>)}</div>
      <div className="tool-pagination"><button onClick={() => setToolPage((page) => Math.max(0, page - 1))} disabled={toolPage === 0} aria-label="上一页"><ChevronLeft /></button><span>第 {toolPage + 1} / {toolPageCount} 页</span><button onClick={() => setToolPage((page) => Math.min(toolPageCount - 1, page + 1))} disabled={toolPage >= toolPageCount - 1} aria-label="下一页"><ChevronRight /></button></div>
    </aside>}

    {pluginSetupOpen && <div className="modal-backdrop"><section className="settings-modal plugin-modal" role="dialog" aria-modal="true" aria-label="插件中心"><header><div><span className="eyebrow">OPTIONAL PLUGINS</span><h2>{hasCompletedPluginSetup() ? "插件中心" : "选择要启用的插件"}</h2><p>插件已随安装器离线内置；勾选后启用对应连接与安全工具。</p></div>{hasCompletedPluginSetup() && <button onClick={() => setPluginSetupOpen(false)} aria-label="关闭插件中心"><X /></button>}</header>
      <div className="plugin-content"><div className="plugin-summary"><Boxes size={20} /><div><strong>Orbit Copilot 基础程序</strong><span>必装 · 对话、模型连接、本机凭据保护</span></div><Check size={18} /></div><div className="plugin-grid">{PLUGIN_PACKS.map((plugin) => { const checked = selectedPlugins.includes(plugin.id); const toolCount = DEFAULT_TOOLS.filter((tool) => tool.serviceId === plugin.id).length; return <label className={`plugin-card ${checked ? "selected" : ""}`} key={plugin.id}><input type="checkbox" checked={checked} onChange={() => togglePlugin(plugin.id)} /><span className="plugin-check">{checked && <Check size={14} />}</span><span className={`service-icon ${plugin.id}`}><Activity /></span><strong>{plugin.name}</strong><small>{plugin.description}</small><ul>{plugin.features.map((feature) => <li key={feature}>{feature}</li>)}</ul><em>{toolCount} 个内置工具 · 可继续同步 OpenAPI</em></label>; })}</div><p className="plugin-safety"><ShieldCheck size={15} /> 注册、登录、注销、密码和管理员接口不会注册；其余接口在插件启用时默认打开。</p></div>
      <footer><span>{pluginCommitting ? "正在注册账号并同步全部接口…" : selectedPlugins.length ? `已选择 ${selectedPlugins.length} 个插件` : "仅安装基础程序"}</span>{hasCompletedPluginSetup() && <button className="secondary" onClick={() => setPluginSetupOpen(false)} disabled={pluginCommitting}>取消</button>}<button className="primary" onClick={commitPluginSetup} disabled={pluginCommitting}>{pluginCommitting ? "正在配置…" : hasCompletedPluginSetup() ? "应用选择" : "完成安装"}</button></footer>
    </section></div>}

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !llmSetupNeeded) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置"><header><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>{llmSetupNeeded ? "连接你的 LLM API" : "连接设置"}</h2><p>{llmSetupNeeded ? "完成模型连接后即可开始对话和调用工具。" : "地址与密钥由当前设备使用，不写入业务服务数据库。"}</p></div>{!llmSetupNeeded && <button onClick={() => setSettingsOpen(false)}><X /></button>}</header>
      <div className="settings-content">{llmSetupNeeded && <div className="llm-guide"><Sparkles size={20} /><div><strong>开始前需要完成模型配置</strong><ol><li>填写 OpenAI-compatible API 地址</li><li>填写该服务实际加载的模型名称</li><li>云端服务填写 API Key；本地 Ollama / LM Studio 可留空</li></ol></div></div>}<section><h3><KeyRound size={17} /> 模型服务</h3><div className="form-grid"><label className="wide">API 地址<input autoFocus={llmSetupNeeded} value={draft.llm.baseUrl} onChange={(e) => { setSettingsError(""); setDraft({ ...draft, llm: { ...draft.llm, baseUrl: e.target.value } }); }} placeholder="http://127.0.0.1:11434/v1" /></label><label>模型名称<input value={draft.llm.model} onChange={(e) => { setSettingsError(""); setDraft({ ...draft, llm: { ...draft.llm, model: e.target.value } }); }} /></label><label>API Key<input type="password" value={draft.llm.apiKey} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, apiKey: e.target.value } })} placeholder="本地模型可留空" /></label><label>温度 <span>{draft.llm.temperature}</span><input type="range" min="0" max="1" step="0.1" value={draft.llm.temperature} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, temperature: Number(e.target.value) } })} /></label><label>最大工具轮次<input type="number" min="1" max="12" value={draft.llm.maxSteps} onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, maxSteps: Number(e.target.value) } })} /></label></div>{settingsError && <p className="settings-error"><CircleAlert size={14} /> {settingsError}</p>}</section>
        {draft.services.map((service) => <section key={service.id}><h3>{service.id === "debris" ? <RadioTower size={17} /> : <Database size={17} />} {service.name}</h3><div className="form-grid"><label className="wide">API 地址<input value={service.apiUrl} onChange={(e) => servicePatch(service.id, { apiUrl: e.target.value })} /></label><label className="wide">页面入口<input value={service.dashboardUrl} onChange={(e) => servicePatch(service.id, { dashboardUrl: e.target.value })} /></label><label className="wide">Bearer Token（如需要）<input type="password" value={service.authToken} onChange={(e) => servicePatch(service.id, { authToken: e.target.value })} placeholder={service.id === "starmad" ? "登录后获得的令牌" : "通常留空"} /></label><label className="check-label"><input type="checkbox" checked={service.allowInvalidCerts} onChange={(e) => servicePatch(service.id, { allowInvalidCerts: e.target.checked })} /> 接受自签名证书（仅桌面端）</label></div></section>)}
        <section><h3><Bot size={17} /> 助手规则</h3><label className="wide"><textarea rows={6} value={draft.systemPrompt} onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })} /></label></section>
      </div><footer><span><CircleAlert size={14} /> Web 版需由服务器允许目标主机；Windows 版可直接访问内网。</span>{!llmSetupNeeded && <button className="secondary" onClick={() => setSettingsOpen(false)}>取消</button>}<button className="primary" onClick={commitSettings}>{llmSetupNeeded ? "保存并开始使用" : "保存设置"}</button></footer>
    </section></div>}
  </div>;
}

function ToolRuns({ runs }: { runs: ToolRun[] }) {
  return <div className="tool-runs">{runs.map((run) => <div key={run.id} className={`tool-run ${run.state}`}><span>{run.state === "running" ? <LoaderCircle className="spin" /> : run.state === "success" ? <Check /> : <CircleAlert />}</span><div><strong>{run.title}</strong><small>{run.state === "running" ? "正在调用…" : run.state === "success" ? `已完成 · ${run.durationMs} ms` : "调用失败"}</small></div></div>)}</div>;
}
