# Windows 安装与更新

## 构建环境

使用 Windows 10/11 x64，安装 Node.js 24 LTS、Rust stable 和 Microsoft C++ Build Tools（Desktop development with C++）。WebView2 在 Windows 11 已内置；Windows 10 缺失时由用户安装 Microsoft Evergreen Runtime。

在项目目录执行：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

脚本会校验版本号、安装锁定依赖、运行 Web 构建与测试，生成 NSIS 安装器，并完成静默安装与启动冒烟测试。只构建、不安装时追加 `-SkipInstallSmokeTest`。安装器位于：

```text
src-tauri\target\release\bundle\nsis\轨道智枢 Orbit Copilot_0.3.1_x64-setup.exe
```

若 Windows 安全策略会短暂锁定源码目录中新生成的 Rust 辅助程序，可将 Cargo 构建产物放到本机应用数据目录；构建脚本会自动从该目录查找安装器：

```powershell
$env:CARGO_TARGET_DIR = Join-Path $env:LOCALAPPDATA "orbit-copilot-build\target"
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-windows.ps1
```

## 首次安装

安装和更新都只需要运行发布包中的 `setup.exe`，无需另外运行 PowerShell 或其他程序：

1. 双击 `setup.exe`；首次运行完成安装，安装过旧版本时直接覆盖更新。
2. 安装范围为当前用户，默认进入 `%LOCALAPPDATA%`，无需管理员权限。
3. 首次启动进入“设置”，填写模型地址、模型名和 Key；再检查两套业务服务连接。
4. 如使用自签名 HTTPS，只对确定可信的服务开启“接受自签名证书”。

首次启动会打开插件中心。勾选需要的内置插件后点击“完成安装”；未勾选的插件不会向模型注册对应工具。之后可随时从左侧“插件中心”重新选择，不需要重复运行安装器。点击服务卡片中的“同步 OpenAPI”即可更新全部接口；只读与明确的查询/预览操作默认启用，写入、删除、账号和 Commit 等高风险操作默认关闭。

模型 Key 与业务 Bearer Token 存储在 Windows Credential Manager，服务名为 `com.starmad.orbitcopilot`；应用普通设置与聊天记录存储在当前用户应用数据中。

## 覆盖更新

1. 将 `package.json` 与 `src-tauri/tauri.conf.json` 的版本同时提升。
2. 构建并完成冒烟测试后分发新版 `setup.exe`。
3. 用户直接运行新版安装器。固定应用标识 `com.starmad.orbitcopilot` 会识别旧版本并覆盖程序文件。
4. 用户态配置和 Windows Credential Manager 不在安装目录内，因此升级后保留。
5. 启动新版，检查版本、模型连接、两个服务健康和一条只读工具调用。

回退同样运行旧版安装器即可。涉及设置格式升级时，应先增加兼容迁移再发布，不应依赖回退恢复数据。

## 自动构建流程

仓库内 `.github/workflows/windows-installer.yml` 支持 PR、手动触发和 `v*` 标签触发。它在 `windows-latest` 上完成依赖安装、前端校验、NSIS 构建、静默安装和真实应用启动，再上传安装器 artifact。正式分发前建议增加组织代码签名证书；当前未签名安装器可能触发 SmartScreen 提示。

## 发布验收清单

- 新安装、覆盖安装、卸载各执行一次。
- 覆盖安装后模型地址、API Key、业务 Token、工具开关和聊天记录符合预期。
- 无公网时，Windows 客户端可调用本机或局域网 OpenAI-compatible 模型。
- 8501/18501 页面入口可打开，8502/18502 API 健康检查成功。
- 自签名证书开关仅对明确配置的单个服务生效。
- 动态发现的所有写操作保持默认关闭。
