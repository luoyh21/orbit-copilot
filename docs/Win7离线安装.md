# Windows 7 SP1 x64 内网离线安装

本包只用于无法升级的 Windows 7 SP1 64 位内网终端。Windows 10/11 应使用普通 `setup.exe`，以获得持续更新的 WebView2 安全补丁。

## 安装

1. 优先复制发布页中名称带 `Win7-SP1-x64-offline-setup.exe` 的单文件安装包；ZIP 是给维护人员排障和审计用的。
2. 确认系统为 Windows 7 SP1 64 位。
3. 右键独立安装包，选择“以管理员身份运行”。
4. 安装器先补齐 KB4490628 与 KB4474419，再安装微软 WebView2 Runtime 109，随后安装并启动 Orbit Copilot。
5. 若提示需要重启，重启 Windows 后再次运行同一 EXE。

使用排障 ZIP 时必须全部解压，然后双击 `install-win7-offline.cmd`，不要单独运行内部的应用 `setup.exe`。

目标机全程不需要访问互联网。WebView2 文件来自 Microsoft Update Catalog，版本固定为 Win7 最终兼容版 `109.0.1518.140 x64`。

## 故障检查

- `Windows 7 Service Pack 1 is required`：先离线安装 Win7 SP1。
- `SHA-256 mismatch`：文件损坏或不完整，重新复制并解压完整 ZIP。
- `WebView2 Runtime 109 was not detected`：重启后重试；仍失败时，把命令窗口完整错误文字发给维护人员。
- 安装后无法连接业务接口：检查内网防火墙以及应用设置中的 API 地址，这与 WebView2 安装无关。

## 安全与支持边界

微软已于 2023 年停止对 Win7 上 WebView2 的更新，109 是最后兼容版本；Win7 本身也已结束支持。该遗留包只能用于隔离且受控的内网，并存在无法修补的浏览器内核安全风险。不要用它打开公网或不可信内容，迁移到 Windows 10/11 应作为正式整改目标。
