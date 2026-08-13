import type { ApiTool, AppSettings, ServiceSettings } from "./types";
import { isSensitiveApiTool } from "./openapi";

export interface PluginPack {
  id: ServiceSettings["id"];
  name: string;
  description: string;
  features: string[];
}

export const PLUGIN_PACKS: PluginPack[] = [
  {
    id: "debris",
    name: "空间碎片监测",
    description: "连接 debris 服务，提供轨道目标检索与发射安全分析。",
    features: ["区域碎片查询", "发射碰撞风险", "再入、TLE 与 RCS 查询"],
  },
  {
    id: "starmad",
    name: "STARMAD-COMET",
    description: "连接协同设计服务，提供工程计算与任务协作能力。",
    features: ["能力与设计任务", "计算插件与公式", "协同进程"],
  },
  {
    id: "news",
    name: "航天速递新闻",
    description: "直接读取每日航天新闻、图片、概要和全文，不依赖 GPT。",
    features: ["上午/下午刊", "近 31 天历史", "概要与全文 API"],
  },
];

export const DEFAULT_SYSTEM_PROMPT = `你是“轨道智枢”，服务于空间碎片监测与航天器协同设计。
回答必须基于工具返回的真实数据；需要监测数据、轨道参数、风险、公式或协同状态时优先调用工具。
不要虚构 NORAD 编号、碰撞概率、公式结果或服务状态。工具失败时说明失败位置和可执行的排查建议。
默认使用中文，先给结论，再给关键数据和必要的风险提示。高成本的发射风险仿真仅在用户明确要求时调用。`;

export const DEFAULT_SETTINGS: AppSettings = {
  llm: {
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "",
    model: "qwen3:8b",
    temperature: 0.2,
    maxSteps: 6,
  },
  services: [
    {
      id: "debris",
      name: "空间碎片监测",
      apiUrl: "http://111.200.37.148:8502",
      dashboardUrl: "http://111.200.37.148:8501/",
      authToken: "",
      allowInvalidCerts: false,
    },
    {
      id: "starmad",
      name: "STARMAD-COMET",
      apiUrl: "http://111.200.37.148:18502",
      dashboardUrl: "http://111.200.37.148:18501/comet/",
      authToken: "",
      allowInvalidCerts: false,
    },
    {
      id: "news",
      name: "航天速递新闻",
      apiUrl: "https://links.he-ting.com/news-api",
      dashboardUrl: "https://links.he-ting.com/news-api/",
      authToken: "",
      allowInvalidCerts: false,
    },
  ],
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  desktop: {
    autostart: false,
    newsNotifications: true,
  },
};

const object = (properties: ApiTool["inputSchema"]["properties"], required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
});

export const DEFAULT_TOOLS: ApiTool[] = [
  {
    id: "debris-region", name: "query_debris_in_region", title: "区域碎片查询", serviceId: "debris", method: "POST", path: "/api/v1/debris/region", enabled: true,
    description: "查询指定经纬度、半径、高度与时间窗内的空间碎片、载荷和火箭体。",
    inputSchema: object({ lat_deg: { type: "number", description: "中心纬度" }, lon_deg: { type: "number", description: "中心经度" }, radius_km: { type: "number", default: 500 }, alt_min_km: { type: "number", default: 0 }, alt_max_km: { type: "number", default: 2000 }, object_type: { type: "string", enum: ["ALL", "DEBRIS", "PAYLOAD", "ROCKET BODY"] }, hours: { type: "number", default: 6 }, limit: { type: "integer", default: 50 } }, ["lat_deg", "lon_deg"]),
  },
  {
    id: "debris-risk", name: "predict_launch_collision_risk", title: "发射碰撞风险", serviceId: "debris", method: "POST", path: "/api/v1/launch/risk", enabled: true, longRunning: true,
    description: "运行 6-DOF 发射轨迹、候选筛选与 Foster Pc 计算，返回分阶段碰撞风险。此工具计算成本较高。",
    inputSchema: object({ vehicle: { type: "string", enum: ["CZ-5B", "Falcon9", "Ariane6"] }, launch_lat_deg: { type: "number" }, launch_lon_deg: { type: "number" }, launch_az_deg: { type: "number" }, launch_utc: { type: "string", description: "ISO-8601 UTC" }, t_max_s: { type: "number", minimum: 600, maximum: 7200 }, include_demo_threats: { type: "boolean", default: false } }),
  },
  {
    id: "debris-reentry", name: "get_debris_reentry_forecast", title: "再入预报", serviceId: "debris", method: "POST", path: "/api/v1/debris/reentry", enabled: true,
    description: "查询未来时间窗内确认或疑似即将再入的空间目标。",
    inputSchema: object({ days_ahead: { type: "number", default: 30 }, alt_max_km: { type: "number", default: 300 }, object_type: { type: "string", enum: ["ALL", "DEBRIS", "PAYLOAD", "ROCKET BODY"] }, limit: { type: "integer", default: 50 } }),
  },
  {
    id: "debris-tle", name: "get_object_tle", title: "TLE 查询", serviceId: "debris", method: "GET", path: "/api/v1/tle/{norad_cat_id}", enabled: true,
    description: "按 NORAD 编号获取最新 TLE 与轨道参数。",
    inputSchema: object({ norad_cat_id: { type: "integer", description: "NORAD 目录编号" } }, ["norad_cat_id"]),
  },
  {
    id: "debris-rcs", name: "query_debris_by_rcs", title: "RCS 筛选", serviceId: "debris", method: "POST", path: "/api/v1/debris/rcs", enabled: true,
    description: "按雷达截面积等级、高度和目标类型筛选空间物体。",
    inputSchema: object({ rcs_sizes: { type: "array", items: { type: "string", enum: ["SMALL", "MEDIUM", "LARGE"] } }, alt_min_km: { type: "number" }, alt_max_km: { type: "number" }, object_type: { type: "string" }, limit: { type: "integer" } }),
  },
  {
    id: "starmad-health", name: "get_starmad_health", title: "协同服务状态", serviceId: "starmad", method: "GET", path: "/api/health/lite", enabled: true,
    description: "检查 STARMAD-COMET Hub 是否可用及当前活动进程数。", inputSchema: object({}),
  },
  {
    id: "starmad-capabilities", name: "list_starmad_capabilities", title: "能力清单", serviceId: "starmad", method: "GET", path: "/api/capabilities", enabled: true,
    description: "列出 STARMAD-COMET 当前暴露的全部 REST 能力。", inputSchema: object({}),
  },
  {
    id: "starmad-design-tasks", name: "get_design_tasks", title: "设计任务", serviceId: "starmad", method: "GET", path: "/api/design/tasks", enabled: true,
    description: "获取可用计算任务、公式分类和 Pull/Compute/Preview/Commit 工作流。", inputSchema: object({}),
  },
  {
    id: "starmad-plugins", name: "list_compute_plugins", title: "计算插件", serviceId: "starmad", method: "GET", path: "/api/plugins", enabled: true,
    description: "列出轨道、电源、推进、热控等计算插件及输入输出定义。", inputSchema: object({}),
  },
  {
    id: "starmad-formulas", name: "search_starmad_formulas", title: "公式检索", serviceId: "starmad", method: "GET", path: "/api/formulas", enabled: true,
    description: "按关键词、分类检索 STARMAD 公式与手册依据。",
    inputSchema: object({ query: { type: "string", description: "检索关键词" }, category: { type: "string" }, limit: { type: "integer", default: 20 }, fuzzy_threshold: { type: "number", default: 0.6 } }),
  },
  {
    id: "starmad-processes", name: "list_collaboration_processes", title: "协同进程", serviceId: "starmad", method: "GET", path: "/api/processes", enabled: true,
    description: "列出当前账号可访问的 STARMAD 协同进程，需要在设置中填写登录令牌。", inputSchema: object({}),
  },
  {
    id: "news-daily", name: "get_daily_space_news", title: "获取每日航天新闻", serviceId: "news", method: "GET", path: "/daily", enabled: true,
    description: "按日期和上午/下午刊获取航天新闻概要，每条含图片、概要、网页和原始网址；不调用 GPT。",
    queryParams: ["date", "edition"], inputSchema: object({ date: { type: "string", description: "YYYY-MM-DD，限近 31 天；默认今天" }, edition: { type: "string", enum: ["morning", "evening"], default: "morning" } }),
  },
  {
    id: "news-item", name: "get_space_news_full_text", title: "获取航天新闻全文", serviceId: "news", method: "GET", path: "/item/{item_id}", enabled: true,
    description: "按新闻 ID 获取中文全文、英文全文、概要、图片与原始网址；不调用 GPT。",
    queryParams: ["date", "edition"], inputSchema: object({ item_id: { type: "string", description: "新闻条目 ID" }, date: { type: "string", description: "可选 YYYY-MM-DD" }, edition: { type: "string", enum: ["morning", "evening"] } }, ["item_id"]),
  },
  {
    id: "news-dates", name: "list_space_news_dates", title: "可用新闻日期", serviceId: "news", method: "GET", path: "/dates", enabled: true,
    description: "列出近 31 天已有上午刊或下午刊的日期。", inputSchema: object({}),
  },
];

export function applyPluginSelection(
  tools: ApiTool[],
  selectedPluginIds: ServiceSettings["id"][],
): ApiTool[] {
  const selected = new Set(selectedPluginIds);
  return tools.filter((tool) => !isSensitiveApiTool(tool)).map((tool) => ({
    ...tool,
    enabled: selected.has(tool.serviceId),
  }));
}
