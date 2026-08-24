Unicode true
RequestExecutionLevel admin
ShowInstDetails show

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef BUNDLE_DIR
  !error "BUNDLE_DIR is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif

Name "Orbit Copilot ${APP_VERSION} - Windows 7 Offline"
OutFile "${OUTPUT_FILE}"
InstallDir "$TEMP"
BrandingText "Orbit Copilot Win7 SP1 x64 offline installer"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "Orbit Copilot Windows 7 Offline Installer"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}.0"
VIAddVersionKey "FileDescription" "Orbit Copilot with WebView2 109 for Windows 7 SP1 x64"
VIAddVersionKey "CompanyName" "STARMAD"
VIAddVersionKey "LegalCopyright" "Copyright STARMAD"

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ${IfNot} ${AtLeastWin7}
    MessageBox MB_ICONSTOP "Windows 7 SP1 x64 is required."
    Abort
  ${EndIf}
  ${If} ${AtLeastWin8}
    MessageBox MB_ICONSTOP "This legacy installer is only for Windows 7. Use the normal Orbit Copilot installer on Windows 10/11."
    Abort
  ${EndIf}
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "64-bit Windows 7 is required."
    Abort
  ${EndIf}

  SetOutPath "$PLUGINSDIR"
  File "${BUNDLE_DIR}\*"
  DetailPrint "Verifying prerequisites and installing WebView2 109..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\install-win7-offline.ps1"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "Installation did not complete. Review the details above. If Windows updates were installed, restart Windows and run this installer again."
    SetErrorLevel $0
    Abort
  ${EndIf}
SectionEnd
