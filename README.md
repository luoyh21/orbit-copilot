# 轨道智枢 · Orbit Copilot

面向空间碎片监测与航天器协同设计的离线优先 AI Copilot。用户只需在设置中填写任意 OpenAI-compatible 模型地址、模型名和 Key，即可让模型按需调用 `debris` 与 `starmad-comet` 已有 REST API。应用本身不依赖 OpenAI 公网；模型可以是 Ollama、vLLM、LM Studio 或局域网内的兼容服务。

## 当前能力

- 共享的 Web / Windows 对话界面，支持多轮 Tool Calling，最多轮次可配置并有防循环保护。
- 预置 `debris`：区域碎片、发射风险、再入预报、TLE、RCS 等工具；页面入口为 `http://111.200.37.148:8501/`，API 默认为 `http://111.200.37.148:8502`。
- 预置 `starmad-comet`：服务状态、能力、设计任务、计算插件、公式和协同进程；页面入口为 `http://111.200.37.148:18501/comet/`，API 默认为 `http://111.200.37.148:18502`。
- 从两套服务的 `/api/openapi.json` 动态发现全部扩展能力；当前文档可注册 95 个不重复操作。GET 与明确的查询、搜索、预测、预览类 POST 默认可用，PUT、PATCH、DELETE 及账号、提交、流程变更类 POST 默认关闭。
- OpenAPI 绑定支持 `$ref`、`anyOf` / `oneOf` / `allOf`、路径参数、查询参数、请求头和 JSON body；POST 的 query 参数不会被误放进 body，并会按方法与路径和内置工具去重。
- Windows 端通过 Rust `reqwest` 直接访问局域网，绕过浏览器 CORS；可针对单个服务接受自签名证书。
- 对要求显式关闭推理模式的 Chat Completions 模型，工具请求遇到对应兼容性错误时会自动以 `reasoning_effort: none` 重试。
- Windows API Key 与 Bearer Token 存入系统凭据管理器；普通设置和最近 100 条消息保存在本机。Web 版密钥只保存到当前标签页会话，不写入服务器日志或持久化存储。
- NSIS 当前用户安装器，无需管理员权限；同一应用 ID 的新版安装器可直接覆盖更新且保留设置和凭据。
- 单一 Windows 安装器内置插件中心；首次启动可勾选“空间碎片监测”和“STARMAD-COMET”，以后可从侧栏调整。同步当前两套 OpenAPI 后共有 59 个只读或安全查询工具默认启用，高风险接口仍可见但默认关闭。

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

详见 [Windows 安装与更新](docs/Windows安装与更新.md)。用户只需要双击发布包中的 `setup.exe`：首次运行完成安装，后续直接运行新版 `setup.exe` 即可覆盖更新并保留配置与凭据，不需要另外运行 PowerShell、Node.js、Rust 或其他辅助程序。

从源码构建时，执行 `scripts/build-windows.ps1`。脚本会构建 NSIS、安装并启动测试，安装器位于 `src-tauri/target/release/bundle/nsis/`；只构建不安装可追加 `-SkipInstallSmokeTest`。GitHub Actions 对每个 PR 和版本标签执行同一套 Windows 安装启动测试。

## 安全边界

- “接受自签名证书”会降低 TLS 身份验证，只应对受控内网服务开启；生产环境优先将内部 CA 加入应用/系统信任链。
- 动态导入的写操作默认禁用。启用 Commit、删除、密码重置等操作前，应同时在后端使用最小权限令牌并保留人工确认。
- Web 网关不记录 Authorization 值，但上层反向代理也必须关闭请求头日志。
- 本项目不会读取或复制 `debris`、`starmad-comet` 的 `.env` 和已有密钥。
