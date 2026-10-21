; Windows installer for 小天 Bot. Build on Linux with: makensis -DSRC=<assembled TianxiAI folder> -DVER=x.y.z -DOUT=<setup.exe> build/installer.nsi
; Installs for the current user only (no admin prompt) into %LOCALAPPDATA%\Programs\XiaotianBot.
; User data stays in %APPDATA%\TianxiAI-Concept and survives uninstall and reinstall.
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user

!include "MUI2.nsh"

Name "小天 Bot"
Caption "小天 Bot ${VER} 安装"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\XiaotianBot"
InstallDirRegKey HKCU "Software\XiaotianBot" "InstallDir"
BrandingText "Lenovo 交互创新"

VIProductVersion "${VER}.0"
VIAddVersionKey /LANG=2052 "ProductName" "小天 Bot"
VIAddVersionKey /LANG=2052 "FileDescription" "小天 Bot 安装程序"
VIAddVersionKey /LANG=2052 "CompanyName" "Lenovo 交互创新"
VIAddVersionKey /LANG=2052 "FileVersion" "${VER}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VER}"
VIAddVersionKey /LANG=2052 "LegalCopyright" ""

!define MUI_ICON "${SRC}\resources\app\icon.ico"
!define MUI_UNICON "${SRC}\resources\app\icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\TianxiAI.exe"
!define MUI_FINISHPAGE_RUN_TEXT "现在打开小天 Bot"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\XiaotianBot"

Section "小天 Bot"
  ; a running 小天 (this or an older portable copy) holds files open and the single-instance lock
  nsExec::Exec 'taskkill /F /T /IM TianxiAI.exe'
  Sleep 800
  SetOutPath "$INSTDIR"
  ; the previous version's runtime goes, so no stale files are mixed in
  RMDir /r "$INSTDIR\resources"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\卸载小天 Bot.exe"

  CreateShortcut "$DESKTOP\小天 Bot.lnk" "$INSTDIR\TianxiAI.exe" "" "$INSTDIR\resources\app\icon.ico" 0
  CreateShortcut "$SMPROGRAMS\小天 Bot.lnk" "$INSTDIR\TianxiAI.exe" "" "$INSTDIR\resources\app\icon.ico" 0
  ; shortcuts of the old name, from the portable zip
  Delete "$DESKTOP\天禧AI 概念版.lnk"
  Delete "$SMPROGRAMS\天禧AI 概念版.lnk"

  WriteRegStr HKCU "Software\XiaotianBot" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "小天 Bot"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VER}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "Lenovo 交互创新"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\resources\app\icon.ico"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\卸载小天 Bot.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /T /IM TianxiAI.exe'
  Sleep 800
  Delete "$DESKTOP\小天 Bot.lnk"
  Delete "$SMPROGRAMS\小天 Bot.lnk"
  ; start at login, if it was turned on
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "小天 Bot"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "tianxi-concept"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.lenovo.tianxi.concept"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\XiaotianBot"
SectionEnd
