# Windows 7 SP1 x64 绿色版（内网免安装）

从 `v0.4.4` 起，Windows 7 只交付名称带 `Win7-SP1-x64-portable.zip` 的绿色包。旧的 `Win7-SP1-x64-offline-setup.exe` 会先向临时目录解压并安装系统级 WebView2，在受控内网终端上可能遇到“对路径的访问被拒绝”，已经停用，请勿继续导入或重试。

## 使用方法

1. 确认系统为 Windows 7 SP1 64 位。
2. 校验发布页 `.zip.sha256` 中的 SHA-256，确认复制过程没有损坏文件。
3. 把 ZIP **完整解压**到本机 NTFS 磁盘，例如 `D:\Orbit-Copilot`。不要在压缩包预览窗口内直接运行，也不要放在 `\\服务器\共享目录` 等网络路径中。
4. 双击 `Orbit-Copilot.exe`，或双击便于排错的 `START-ORBIT-COPILOT.cmd`。
5. 首次进入设置页，填写内网模型和业务 API 地址。目标机全程不需要访问互联网。

绿色包不执行安装程序、不请求管理员权限、不安装 Windows 更新、不写 `Program Files` 或 Windows 系统目录，也不注册系统级 WebView2。包内的 `WebView2Runtime` 是固定版本 `109.0.1518.140 x64`，Orbit Copilot 只从该相邻目录加载它。

## 自检与问题定位

双击 `TEST-WIN7-PORTABLE.cmd` 可检查：

- 主程序是 AMD64，并将 PE 最低系统/子系统版本限定在 Windows 7 范围；
- 主程序不导入仅 Windows 8+ 提供的 WinRT 激活接口，也不依赖动态 VC/UCRT；
- 固定 WebView2 109 文件齐全；
- 包内没有 `setup.exe`、MSI、MSU 或 WebView 安装器；
- 程序窗口能够启动，且浏览器进程确实来自包内 `WebView2Runtime`。

测试完成后会在当前目录生成 `TEST-REPORT.txt`。失败时把这个文件发给维护人员即可，不需要反复搬运整包。

- 提示 `WebView2Runtime is incomplete`：ZIP 没有完整解压，或复制时遗漏了目录，重新校验 SHA-256 并完整解压。
- 从共享目录启动失败：复制到本机磁盘再运行；微软固定版 WebView2 不支持从网络/UNC 路径运行。
- 应用启动但业务接口不可用：这属于内网路由或防火墙问题，与 WebView2 无关。优先使用服务器内网地址并检查 TCP 8501/8502/18501/18502。

## 更新与删除

更新时关闭程序，把新 ZIP 解压到一个新目录并直接运行；确认无误后再删除旧程序目录。应用设置、聊天记录和凭据不放在绿色包目录中，而是继续保存在当前 Windows 用户的应用数据目录和 Windows Credential Manager，因此覆盖程序目录不会清除配置。

删除程序只需退出托盘中的 Orbit Copilot 后删除解压目录。若还需要清除用户设置和凭据，应由管理员按组织的数据清理策略处理。

## 从源码复现

构建机使用 Windows 10/11 x64、Node.js 24 LTS、7-Zip、Microsoft C++ Build Tools 和 rustup。把输出放到容量充足的盘符：

```powershell
PowerShell -ExecutionPolicy Bypass -File .\scripts\build-win7-portable.ps1 `
  -OutputDirectory "D:\orbit-build\win7-portable"
```

脚本会核对三处应用版本号，校验微软 WebView2 109 离线文件的固定 SHA-256，从中提取固定运行时，并使用 `nightly-2026-08-25` 的 `x86_64-win7-windows-msvc` 目标和静态 Visual C++ 运行库编译。Win7 目标使用 Win7 原生桌面通知实现，不链接 Windows 8 才提供的 WinRT 通知接口。随后运行结构/PE/导入表/启动自检，最后生成 ZIP、SHA-256 和文本测试报告。可用 `-RuntimeInstallerPath` 指向已经下载且哈希一致的微软离线文件，避免重复下载。

## 安全边界

微软已停止 Win7 及其 WebView2 109 的安全更新。该绿色版只适用于隔离且受控的内网，不应用于浏览公网或不可信内容；迁移到仍受支持的 Windows 版本仍是正式整改目标。
