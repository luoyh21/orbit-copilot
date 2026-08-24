# Windows 安装与更新

## 构建环境

使用 Windows 10/11 x64，安装 Node.js 24 LTS、Rust stable、NSIS 3 和 Microsoft C++ Build Tools（Desktop development with C++）。WebView2 在 Windows 11 已内置；普通安装器同时内嵌当前离线运行时。

在项目目录执行：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

脚本会校验版本号、安装锁定依赖、运行 Web 构建与测试，生成 NSIS 安装器，并完成静默安装与启动冒烟测试。只构建、不安装时追加 `-SkipInstallSmokeTest`。安装器位于：

```text
src-tauri\target\release\bundle\nsis\轨道智枢 Orbit Copilot_0.4.2_x64-setup.exe
```

安装后可在“设置 → Windows 集成”中启用开机自启和航天新闻通知。程序关闭按钮默认隐藏到通知区域；需要彻底退出时，请右键托盘图标并选择“退出”。

若 Windows 安全策略会短暂锁定源码目录中新生成的 Rust 辅助程序，可将 Cargo 构建产物放到本机应用数据目录；构建脚本会自动从该目录查找安装器：

```powershell
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "orbit-copilot-build\target"
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

## 首次安装

安装和更新都只需要运行发布包中的 `setup.exe`，无需另外运行 PowerShell、Node.js、Rust、Visual C++ Build Tools 或其他程序。安装包内置 WebView2 离线安装程序，可用于未安装 WebView2 Runtime 的全新 Windows 10/11：

1. 双击 `setup.exe`；首次运行完成安装，安装过旧版本时直接覆盖更新。
2. 安装范围为当前用户，默认进入 `%LOCALAPPDATA%`，无需管理员权限。
3. 首次启动进入“设置”，填写模型地址、模型名和 Key；再检查两套业务服务连接。
4. 如使用自签名 HTTPS，只对确定可信的服务开启“接受自签名证书”。

首次启动会打开插件中心。勾选需要的内置插件后点击“完成安装”；程序会自动配置 STARMAD 专用账号并同步已选服务的全部 OpenAPI，完成后自动显示 LLM 设置。填写有效的 OpenAI-compatible API 地址、模型名称和 Key（本地无鉴权模型可不填 Key）并保存，即可直接对话调用全部已选功能，不需要再点击“同步 OpenAPI”。未勾选的插件不会向模型注册对应工具；以后每次启动也会自动刷新接口定义。注册、登录、注销、密码和管理员接口完全不注册，其余接口在对应插件启用时默认打开。

左侧“新建对话”可保留并新开多条本地对话历史，可随时切换或删除。右侧工具栏可通过顶栏或面板标题处的按钮收起；工具注册表每页显示 12 项，可用底部按钮翻页，聊天区、历史列表与工具列表均有独立滚动条。

模型 Key 与业务 Bearer Token 存储在 Windows Credential Manager，服务名为 `com.starmad.orbitcopilot`；应用普通设置与聊天记录存储在当前用户应用数据中。

启用 STARMAD 插件后，Windows 客户端会在首次运行时注册一个独立的 `orbit-copilot-*` 服务账号。随机密码只保存在 Windows Credential Manager；后续启动自动登录并刷新 Token，不会重复注册账号。Web 版不会执行自动注册。

## Windows 7 SP1 x64 独立离线包

Win7 不能安装普通包内的最新版 WebView2。发布页会额外生成一个单文件：

```text
Orbit-Copilot-0.4.2-Win7-SP1-x64-offline-setup.exe
```

它内含微软官方 KB4490628 服务堆栈更新、KB4474419 SHA-2 更新、WebView2 Runtime `109.0.1518.140 x64` 和不再下载 WebView2 的应用安装器。右键选择“以管理员身份运行”；如果刚补装 Windows 更新，按提示重启后再次运行同一 EXE。完整说明见 [Win7 离线安装](Win7离线安装.md)。

从源码复现该包：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-win7-offline.ps1
```

构建脚本只从 Microsoft Update Catalog 官方地址下载三个依赖，并逐一核对仓库中固定的 SHA-256；最终同时生成独立 EXE、SHA-256 文件和便于排障的 ZIP。目标机安装过程完全离线。

## 覆盖更新

1. 将 `package.json` 与 `src-tauri/tauri.conf.json` 的版本同时提升。
2. 构建并完成冒烟测试后分发新版 `setup.exe`。
3. 用户直接运行新版安装器。固定应用标识 `com.starmad.orbitcopilot` 会识别旧版本并覆盖程序文件。
4. 用户态配置和 Windows Credential Manager 不在安装目录内，因此升级后保留。
5. 启动新版，检查版本、模型连接、两个服务健康和一条只读工具调用。

回退同样运行旧版安装器即可。涉及设置格式升级时，应先增加兼容迁移再发布，不应依赖回退恢复数据。

## 8501 与 8502 的内网访问

- `8501` 是碎片监测网页入口。
- `8502` 是 FastAPI 接口端口；访问根路径会以 HTTP 307 跳转到 `/docs`，接口定义位于 `/api/openapi.json`。
- 当前服务器监听 `0.0.0.0:8502`，服务器所在网段的地址为 `172.20.0.51`。同一内网或已配置路由的终端，应在应用设置中把 debris API 改为 `http://172.20.0.51:8502`，浏览器文档地址为 `http://172.20.0.51:8502/docs`。
- `http://111.200.37.148:8502` 是公网映射地址。外部网络可访问、同一内网却打不开时，通常是网关未启用 NAT Loopback（回流）或内网策略禁止访问公网映射端口；这种情况应使用内网地址，而不是修改 API 服务。
- 不存在 `/health`、`/healthz` 或 `/api/health` 路由，它们返回 404 不代表服务宕机。连通性检查应请求 `/api/openapi.json`。

Win7 默认没有 curl，可直接用浏览器打开 `/docs`，或在命令提示符执行：

```bat
powershell -NoProfile -Command "$u='http://172.20.0.51:8502/api/openapi.json'; $r=(New-Object Net.WebClient).DownloadString($u); Write-Host $r.Substring(0,[Math]::Min(120,$r.Length))"
```

如果终端不在 `172.20.0.0/24`，网络管理员还需要为其 VLAN 配置到该网段的路由，并放行目标 TCP 8501、8502；不能仅靠修改应用解决三层网络不通。

## 自动构建流程

仓库内 `.github/workflows/windows-installer.yml` 支持 PR、手动触发和 `v*` 标签触发。它在 `windows-latest` 上完成依赖安装、前端校验、NSIS 构建、静默安装和真实应用启动，再上传安装器 artifact。正式分发前建议增加组织代码签名证书；当前未签名安装器可能触发 SmartScreen 提示。

## 发布验收清单

- 新安装、覆盖安装、卸载各执行一次。
- 覆盖安装后模型地址、API Key、业务 Token、工具开关和聊天记录符合预期。
- 无公网时，Windows 客户端可调用本机或局域网 OpenAI-compatible 模型。
- 8501/18501 页面入口可打开，8502/18502 API 健康检查成功。
- 点击“碎片监测”和“协同设计”会由 Windows 默认浏览器打开对应页面。
- 清空用户态配置模拟首次运行：完成插件选择后自动出现 88/88 个工具，再填写 LLM 设置并完成一次真实工具对话。
- 在未安装 WebView2 Runtime 的 Windows 沙箱或虚拟机中运行 setup，确认内置离线运行时可完成安装并启动。
- 自签名证书开关仅对明确配置的单个服务生效。
- 敏感接口不出现在工具注册表；其余接口在已选插件内默认打开，分页、开关和滚动均正常。
