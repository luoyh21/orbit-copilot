Unicode true
Name "Orbit Copilot 本月离线数据更新"

!ifndef APP_EXE
  !error "APP_EXE is required"
!endif
!ifndef NEWS_JSON
  !error "NEWS_JSON is required"
!endif
!ifndef NEWS_SHA256
  !error "NEWS_SHA256 is required"
!endif
!ifndef OUTPUT_EXE
  !error "OUTPUT_EXE is required"
!endif

OutFile "${OUTPUT_EXE}"
Icon "${PROJECT_DIR}/src-tauri/icons/icon.ico"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
CRCCheck force
SetCompressor /SOLID lzma
SetCompressorDictSize 32
XPStyle on
WindowIcon off
ManifestDPIAware true
ManifestSupportedOS all

VIProductVersion "0.4.6.0"
VIAddVersionKey /LANG=2052 "ProductName" "Orbit Copilot"
VIAddVersionKey /LANG=2052 "ProductVersion" "0.4.6"
VIAddVersionKey /LANG=2052 "FileDescription" "Orbit Copilot 2026年8月离线数据更新"
VIAddVersionKey /LANG=2052 "FileVersion" "0.4.6"
VIAddVersionKey /LANG=2052 "LegalCopyright" "Orbit Copilot contributors"

!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

Var CacheDir
Var DataDir

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "此更新仅支持 Windows 7 SP1 64 位系统。"
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_ICONSTOP|MB_OK "此更新需要 Windows 7 SP1 64 位系统。"
    Abort
  ${EndIf}
FunctionEnd

Section
  SetShellVarContext current
  StrCpy $CacheDir "$LOCALAPPDATA\OrbitCopilot\single-exe\0.4.5"
  StrCpy $DataDir "$LOCALAPPDATA\OrbitCopilot\offline-news"

  IfFileExists "$CacheDir\Orbit-Copilot.exe" 0 main_not_prepared
  IfFileExists "$CacheDir\WebView2Runtime\msedgewebview2.exe" 0 main_not_prepared

  ; The cached executable cannot be replaced while the application is open.
  ; This only stops Orbit Copilot itself and does not touch WebView2 or user data.
  nsExec::ExecToStack 'taskkill /F /IM Orbit-Copilot.exe'
  Pop $0
  Pop $1
  Sleep 800

  Delete "$CacheDir\Orbit-Copilot.previous.exe"
  ClearErrors
  Rename "$CacheDir\Orbit-Copilot.exe" "$CacheDir\Orbit-Copilot.previous.exe"
  IfErrors update_failed

  SetOutPath "$CacheDir"
  SetOverwrite on
  ClearErrors
  File "/oname=Orbit-Copilot.exe" "${APP_EXE}"
  IfErrors rollback

  CreateDirectory "$DataDir"
  SetOutPath "$DataDir"
  ClearErrors
  File "/oname=current.json" "${NEWS_JSON}"
  File "/oname=current.json.sha256" "${NEWS_SHA256}"
  IfErrors rollback

  FileOpen $0 "$DataDir\.ready" w
  FileWrite $0 "Orbit Copilot offline news 2026-08"
  FileClose $0

  MessageBox MB_ICONINFORMATION|MB_OK "更新完成：已写入 2026 年 8 月新增碎片、SpaceNews、NASA TechPort 和综合新闻。现有主程序文件及 WebView2 均未改动。"
  SetOutPath "$CacheDir"
  Exec '"$CacheDir\Orbit-Copilot.exe"'
  Quit

rollback:
  Delete "$CacheDir\Orbit-Copilot.exe"
  Rename "$CacheDir\Orbit-Copilot.previous.exe" "$CacheDir\Orbit-Copilot.exe"
update_failed:
  MessageBox MB_ICONSTOP|MB_OK "更新失败，已保留或恢复原缓存组件。请关闭轨道智枢后重试。"
  SetErrorLevel 1
  Quit

main_not_prepared:
  MessageBox MB_ICONSTOP|MB_OK "尚未找到 v0.4.5 的本地运行组件。请先双击现有 Orbit-Copilot-0.4.5-Win7-SP1-x64.exe 完成首次启动，再运行本更新。"
  SetErrorLevel 2
SectionEnd
