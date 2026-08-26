# Windows 7 SP1 x64 绿色版（内网免安装）

从 `v0.4.4` 起，Windows 7 只交付名称带 `Win7-SP1-x64-portable.zip` 的绿色包。旧的 `Win7-SP1-x64-offline-setup.exe` 会先向临时目录解压并安装系统级 WebView2，在受控内网终端上可能遇到“对路径的访问被拒绝”，已经停用，请勿继续导入或重试。

## 使用方法

1. 确认系统为 Windows 7 SP1 64 位，并已安装下文列出的三个微软系统更新。
2. 校验发布页 `.zip.sha256` 中的 SHA-256，确认复制过程没有损坏文件。
3. 把 ZIP **完整解压**到本机 NTFS 磁盘，例如 `D:\Orbit-Copilot`。不要在压缩包预览窗口内直接运行，也不要放在 `\\服务器\共享目录` 等网络路径中。
4. 双击 `Orbit-Copilot.exe`，或双击便于排错的 `START-ORBIT-COPILOT.cmd`。
5. 首次进入设置页，填写内网模型和业务 API 地址。目标机全程不需要访问互联网。

绿色包不执行安装程序、不请求管理员权限、不安装 Windows 更新、不写 `Program Files` 或 Windows 系统目录，也不注册系统级 WebView2。包内的 `WebView2Runtime` 是真正的 Fixed Version Runtime `109.0.1518.78 x64`，Orbit Copilot 只从该相邻目录加载它。

## Win7 系统前置更新

WebView2 109 不能在完全未更新的 Win7 SP1 上运行。目标机需要先由管理员离线安装以下微软签名更新；这些是操作系统组件，不会由 Orbit Copilot 静默安装：

| 顺序 | 更新 | 文件名 | SHA-256 |
| --- | --- | --- | --- |
| 1 | 服务堆栈 | `Windows6.1-KB4490628-x64.msu` | `8075f6d889bcb27be6f52ed47081675e5bb8a5390f2f5bfe4ec27a2bb70cbf5e` |
| 2 | SHA-2 签名支持 v3 | `Windows6.1-KB4474419-v3-x64.msu` | `99312df792b376f02e25607d2eb3355725c47d124d8da253193195515fe90213` |
| 3 | Win7 图形平台 | `Windows6.1-KB2670838-x64.msu` | `9fe71e7dcd2280ce323880b075ade6e56c49b68fc702a9b4c0a635f0f1fb9db8` |

依次安装，每一步完成后重启，再运行 `TEST-WIN7-PORTABLE.cmd`。自检会明确列出缺少的 KB，不会尝试提权或修改系统。已通过 Windows Update 保持到 2019 年后的 Win7 通常已经具备前两项，但仍应以自检结果为准。三个文件应在联网电脑上从 Microsoft Update Catalog/微软下载中心取得并校验哈希；不要使用来历不明的“集成补丁包”。

## 自检与问题定位

双击 `TEST-WIN7-PORTABLE.cmd` 可检查：

- 主程序是 AMD64，并将 PE 最低系统/子系统版本限定在 Windows 7 范围；
- 主程序不导入仅 Windows 8+ 提供的 WinRT 激活接口或 `EventSetInformation`，也不依赖动态 VC/UCRT；
- 固定 WebView2 109 文件齐全，版本为 `109.0.1518.78`；
- 包内没有 `setup.exe`、MSI、MSU 或 WebView 安装器；
- 程序窗口能够启动，且浏览器进程确实来自包内 `WebView2Runtime`。

测试完成后会在当前目录生成 `TEST-REPORT.txt`。失败时把这个文件发给维护人员即可，不需要反复搬运整包。

本项目已经在无网络设备的标准 Windows 7 Enterprise SP1 x64 虚拟机中完成实机级兼容性验收；完整镜像哈希、补丁哈希、独立 Loader 探针返回值、整包测试输出和曾发现的假阳性修正记录见 [Win7 虚拟机验收报告](Win7虚拟机验收报告.md)。

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

脚本会核对三处应用版本号，校验 Fixed Version Runtime CAB 的固定 SHA-256 `7622281cf83de1a35e3a471f432f7a897d65f0a7d3975df08512b7b253dd45c7`，并验证解出核心文件的 Microsoft Authenticode 签名；该退休版本的原始微软 CDN 已下线，因此脚本从固定的只读归档下载并以哈希和微软签名双重校验。随后使用 `nightly-2026-08-25` 的 `x86_64-win7-windows-msvc` 目标和静态 Visual C++ 运行库编译。Win7 目标使用 Win7 原生桌面通知实现，不链接 Windows 8 才提供的 WinRT 通知接口；静态 WebView2 Loader 的可选 ETW Provider Traits 通过本地成功空实现跳过，因此主程序也不会导入 Win7 缺少的 `EventSetInformation`。最后运行结构、PE、导入表和启动自检，并生成 ZIP、SHA-256 与文本测试报告。可用 `-RuntimeArchivePath` 指向已经下载且哈希一致的 CAB，避免重复下载；旧参数名 `-RuntimeInstallerPath` 仍作为兼容别名保留。

## 安全边界

微软已停止 Win7 及其 WebView2 109 的安全更新。该绿色版只适用于隔离且受控的内网，不应用于浏览公网或不可信内容；迁移到仍受支持的 Windows 版本仍是正式整改目标。
