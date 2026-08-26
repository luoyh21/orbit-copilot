# 轨道智枢 · Orbit Copilot

面向空间碎片监测与航天器协同设计的离线优先 AI Copilot。用户只需在设置中填写任意 OpenAI-compatible 模型地址、模型名和 Key，即可让模型按需调用 `debris` 与 `starmad-comet` 已有 REST API。应用本身不依赖 OpenAI 公网；模型可以是 Ollama、vLLM、LM Studio 或局域网内的兼容服务。

## 当前能力

- 独立“航天新闻”工作空间无需 LLM：按日期聚合近 31 天上午刊/下午刊与 NASA TechPort 项目更新，可按来源筛选并查看摘要、标签和全文；断网时明确提示新闻不可用，恢复联网后自动重试。同时注册每日新闻、全文和可用日期 3 个 API 工具，供对话按需调用。
- Windows 通知区域托盘常驻，可在设置中选择开机自启和每天 08:30、16:30 新闻通知；点击通知直接回到当日对应刊次。关闭主窗口只隐藏到托盘，使用托盘“退出”才完全结束。
- 共享的 Web / Windows 对话界面，支持多条本地对话历史、多轮 Tool Calling，最多轮次可配置并有防循环保护；右侧工具栏可完全收起，注册表支持分页和独立滚动。
- 预置 `debris`：区域碎片、发射风险、再入预报、TLE、RCS 等工具；页面入口为 `http://111.200.37.148:8501/`，API 默认为 `http://111.200.37.148:8502`。
- 预置 `starmad-comet`：服务状态、能力、设计任务、计算插件、公式和协同进程；页面入口为 `http://111.200.37.148:18501/comet/`，API 默认为 `http://111.200.37.148:18502`。
- 从两套服务的 `/api/openapi.json` 动态发现扩展能力；当前文档共 95 个操作，其中注册、登录、注销、密码及管理员相关的 7 个敏感操作完全不注册，其余 88 个操作在对应插件启用时默认打开。
- OpenAPI 绑定支持 `$ref`、`anyOf` / `oneOf` / `allOf`、路径参数、查询参数、请求头和 JSON body；POST 的 query 参数不会被误放进 body，并会按方法与路径和内置工具去重。
- Windows 端通过 Rust `reqwest` 直接访问局域网，绕过浏览器 CORS；可针对单个服务接受自签名证书。
- 对要求显式关闭推理模式的 Chat Completions 模型，工具请求遇到对应兼容性错误时会自动以 `reasoning_effort: none` 重试。
- Windows API Key 与 Bearer Token 存入系统凭据管理器；普通设置和最多 50 条对话（每条最近 100 条消息）保存在本机。Web 版密钥只保存到当前标签页会话，不写入服务器日志或持久化存储。
- Windows 端首次启用 STARMAD 插件时会注册一个唯一的 `orbit-copilot-*` 专用账号；随机密码仅存入 Windows 凭据管理器，之后每次启动自动登录并刷新 24 小时会话 Token。Web 版不会自动创建账号。
- 首次完成插件选择和以后每次启动都会自动同步已选服务的 OpenAPI；用户保存有效的 LLM API 地址、模型名和 Key 后即可直接对话调用全部 88 个非敏感工具，无需手动点击“同步 OpenAPI”。
- 侧栏“碎片监测”和“协同设计”通过原生 opener 交给 Windows 默认浏览器打开，不再依赖 WebView 内部的新窗口行为。
- NSIS 当前用户安装器，无需管理员权限；同一应用 ID 的新版安装器可直接覆盖更新且保留设置和凭据。
- 单一 Windows 安装器内置插件中心；首次启动可勾选“空间碎片监测”和“STARMAD-COMET”，以后可从侧栏调整。同步当前两套 OpenAPI 后共有 88 个非敏感工具默认启用，7 个敏感工具不会出现在界面或发送给模型。

## 目录

```text
src/                 React UI、Agent 编排、OpenAPI 工具发现
src-tauri/           Tauri v2 / Rust 原生网络与系统凭据
gateway/             Web 静态站点与受控反向代理
scripts/             Windows 构建脚本
.github/workflows/   Windows NSIS 自动构建
Dockerfile           在线 Web 版镜像
docker-compose.yml   默认映射到宿主机 18600
```

## 本地 Web 开发

所有依赖和构建产物均在 `/mnt/data/orbit-copilot`，不会占用系统盘项目目录。

```bash
cd /mnt/data/orbit-copilot
npm install --cache /mnt/data/npm-cache
npm run build
python3 -m venv /mnt/data/orbit-copilot-venv
/mnt/data/orbit-copilot-venv/bin/pip install -r gateway/requirements.txt
/mnt/data/orbit-copilot-venv/bin/uvicorn gateway.app:app --host 0.0.0.0 --port 18700
```

打开 `http://服务器地址:18700/`。开发界面可用 `npm run dev`，同时让网关运行在 18700；Vite 会自动代理 `/bridge`。

## 在线部署

当前服务器已运行容器，并通过现有 STARMAD Nginx 网关公开为：

`http://111.200.37.148:18501/copilot/`

```bash
cd /mnt/data/orbit-copilot
docker-compose up -d --build
curl http://127.0.0.1:18600/healthz
```

默认只允许代理当前两套服务所在主机及本机，防止 Web 代理成为开放 SSRF 入口。若模型服务在其他主机，修改 `docker-compose.yml` 中 `COPILOT_ALLOWED_HOSTS`，用逗号追加其主机名或 IP，然后重建容器。生产环境应在 18600 前放置 HTTPS 反向代理和组织身份认证。

## 模型设置示例

| 服务 | API 地址 | 模型 | Key |
| --- | --- | --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` | `qwen3:8b` | 留空 |
| LM Studio | `http://127.0.0.1:1234/v1` | 已加载模型名 | 留空 |
| vLLM | `http://内网地址:8000/v1` | 服务端模型名 | 按服务配置 |
| OpenAI-compatible | `https://服务地址/v1` | 对应模型名 | 对应 Key |

模型需要支持 OpenAI Chat Completions 的 `tools` / `tool_calls` 字段。桌面端访问 `127.0.0.1` 指 Windows 用户自己的电脑；Web 端的 `127.0.0.1` 指部署网关的服务器。

## Windows 安装与更新

详见 [Windows 安装与更新](docs/Windows安装与更新.md)。Windows 10/11 用户只需要双击普通 `setup.exe`：首次运行完成安装，后续直接覆盖更新并保留配置与凭据。普通安装包内置当前 WebView2 离线运行时。

Windows 7 SP1 64 位必须下载名称带 `Win7-SP1-x64-portable.zip` 的绿色包，不能使用普通安装器，也不要再使用旧的 `Win7-SP1-x64-offline-setup.exe`。把 ZIP 完整解压到本机磁盘后直接运行 `Orbit-Copilot.exe`；包内固定携带 WebView2 109，不安装系统 WebView、不写系统目录、不要求管理员权限，目标内网机也不需要联网。详见 [Win7 绿色版](docs/Win7离线安装.md)。Win7 与 WebView2 109 均已停止安全更新，只能作为隔离内网的临时兼容方案。

从源码构建普通 Windows 10/11 安装器时执行 `scripts/build-windows.ps1`。Win7 绿色包使用 `scripts/build-win7-portable.ps1`，构建缓存和输出目录可明确放在容量充足的盘符。GitHub Actions 会分别完成普通安装器测试，以及绿色包的结构、PE 兼容版本、固定 WebView2 来源和实际启动测试。

## 安全边界

- “接受自签名证书”会降低 TLS 身份验证，只应对受控内网服务开启；生产环境优先将内部 CA 加入应用/系统信任链。
- 注册、登录、注销、密码和 `/api/admin` 下的接口在发现、迁移、存储和模型注册阶段均会被过滤。其余动态接口（包括写操作）按产品策略默认启用，因此后端仍应使用最小权限令牌，并对 Commit、删除等操作保留审计与权限控制。
- Web 网关不记录 Authorization 值，但上层反向代理也必须关闭请求头日志。
- 本项目不会读取或复制 `debris`、`starmad-comet` 的 `.env` 和已有密钥。
