#!/bin/bash
set -e
# usage: build/assemble-mac.sh x.y.z arm64|x64   (on a Mac; needs build/dl/electron-mac-<arch>.zip and build/runtime-mac from an npm install on a Mac)
# Makes build/out-mac/小天 Bot.app and build/out-mac/XiaotianBot-<ver>-mac-<arch>.dmg. Same client and 小天 layer as Windows.
# The renaming follows what @electron/packager does for a Mac app.
VER=${1:?version}; ARCH=${2:?arch}
cd "$(dirname "$0")"; ROOT=$PWD/..
NAME='小天 Bot'; ID=com.lenovo.tianxi.concept
OUT=$PWD/out-mac; APP="$OUT/$NAME.app"; RES="$APP/Contents/Resources"; PL="$APP/Contents/Info.plist"
rm -rf "$OUT" && mkdir -p "$OUT"
ditto -x -k dl/electron-mac-$ARCH.zip "$OUT"
mv "$OUT/Electron.app" "$APP"
# plutil -replace sets a key and adds it when it is missing
P() { plutil -replace "$2" -string "$3" "$1"; }

# Electron counts itself as packaged only when its executable is not called Electron (app.isPackaged), and finds its
# helpers as Frameworks/"<CFBundleName> Helper….app" (electron_main_delegate_mac.mm): rename both after the app.
# The executable keeps an ASCII name; what people see is CFBundleName / CFBundleDisplayName.
EXE=XiaotianBot
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$EXE"
P "$PL" CFBundleExecutable "$EXE"
P "$PL" CFBundleName "$NAME"
P "$PL" CFBundleDisplayName "$NAME"
P "$PL" CFBundleIdentifier "$ID"
helper() {   # <dir> <old base name> <new base name> <bundle id>
  local h="$1/$2.app"; [ -d "$h" ] || return 0
  mv "$h/Contents/MacOS/$2" "$h/Contents/MacOS/$3"
  P "$h/Contents/Info.plist" CFBundleExecutable "$3"
  P "$h/Contents/Info.plist" CFBundleName "$3"
  P "$h/Contents/Info.plist" CFBundleDisplayName "$3"
  P "$h/Contents/Info.plist" CFBundleIdentifier "$4"
  P "$h/Contents/Info.plist" CFBundleShortVersionString "$VER"
  P "$h/Contents/Info.plist" CFBundleVersion "$VER"
  mv "$h" "$1/$3.app"
}
F="$APP/Contents/Frameworks"
helper "$F" 'Electron Helper' "$NAME Helper" "$ID.helper"
helper "$F" 'Electron Helper (Renderer)' "$NAME Helper (Renderer)" "$ID.helper"
helper "$F" 'Electron Helper (GPU)' "$NAME Helper (GPU)" "$ID.helper"
helper "$F" 'Electron Helper (Plugin)' "$NAME Helper (Plugin)" "$ID.helper"
helper "$F" 'Electron Helper EH' "$NAME Helper EH" "$ID.helper.EH"
helper "$F" 'Electron Helper NP' "$NAME Helper NP" "$ID.helper.NP"
helper "$APP/Contents/Library/LoginItems" 'Electron Login Helper' "$NAME Login Helper" "$ID.loginhelper"
ls "$F"
if ls "$F" | grep -q '^Electron Helper'; then echo 'a helper was not renamed'; exit 1; fi

# the app itself: Electron's sample app goes, 小天's client goes in, the runtime beside it
rm -f "$RES/default_app.asar"
plutil -remove ElectronAsarIntegrity "$PL" 2>/dev/null || true   # no asar: nothing to check
mkdir -p "$RES/app" "$RES/runtime"
cp $ROOT/desktop/{main.js,shell.js,updater.js,freegate.js,phone.js,room.js,look.js,update.json,preload.js,loading.html,package.json,icon.png,icon.ico} "$RES/app/"
node -e "const f=require('path').resolve(process.argv[1]),p=require(f);p.version='$VER';require('fs').writeFileSync(f,JSON.stringify(p,null,2))" "$RES/app/package.json"
cp -R runtime-mac/node_modules "$RES/runtime/node_modules"
cp runtime-mac/package.json "$RES/runtime/"
rm -rf "$RES/runtime/node_modules/dsh-tianxi" && cp -R $ROOT/tianxi "$RES/runtime/node_modules/dsh-tianxi"
# slim, as on Windows
R="$RES/runtime/node_modules"
OTHER=$([ "$ARCH" = arm64 ] && echo x64 || echo arm64)
rm -rf "$R/@deepseek-ai/libreoffice-kit-wasm" "$R"/node-pty/prebuilds/win32-* "$R"/node-pty/prebuilds/linux-* "$R"/node-pty/prebuilds/darwin-$OTHER
find "$R" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.tsbuildinfo' \) -type f -delete
# keep only Chinese and English UI strings
find "$RES" -maxdepth 1 -name '*.lproj' ! -name 'zh_CN.lproj' ! -name 'en.lproj' -exec rm -rf {} +
mkdir -p "$RES/zh_CN.lproj"

# version, icon, and the reasons macOS shows when 小天 first asks for the microphone or a folder
cp icon.icns "$RES/electron.icns"
P "$PL" CFBundleShortVersionString "$VER"
P "$PL" CFBundleVersion "$VER"
P "$PL" CFBundleDevelopmentRegion zh_CN
P "$PL" LSApplicationCategoryType public.app-category.productivity
P "$PL" NSHumanReadableCopyright 'Lenovo 交互创新'
P "$PL" NSMicrophoneUsageDescription '小天用麦克风听你说话（语音输入和语音通话）。'
P "$PL" NSDesktopFolderUsageDescription '小天留意桌面上的新文件，整理进每日简报，也按你的吩咐整理文件。'
P "$PL" NSDownloadsFolderUsageDescription '小天留意下载文件夹里的新文件，整理进每日简报，也按你的吩咐整理文件。'
P "$PL" NSDocumentsFolderUsageDescription '小天按你的吩咐读写文稿里的文件。'
plutil -lint "$PL"
plutil -p "$PL" | grep -E 'CFBundle(Name|DisplayName|Executable|Identifier|ShortVersionString)|Usage|AsarIntegrity' || true

# No Apple developer certificate: sign ad hoc, which Apple-silicon Macs need to run the app and its native modules at all.
# Loose native modules in the runtime first, then the whole bundle.
find "$R" -type f \( -name '*.node' -o -name '*.dylib' -o -perm -u+x \) ! -name '*.js' ! -name '*.sh' ! -name '*.json' -print0 |
  while IFS= read -r -d '' f; do if file -b "$f" | grep -q Mach-O; then codesign --force --sign - "$f"; fi; done
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo signed
echo assembled; du -sm "$APP"

# the disk image: drag 小天 Bot into Applications. Built in steps (empty image → copy in → detach → compress) because on
# build machines a one-step "hdiutil create -srcfolder" often ends in "Resource busy" while the system scans the new files.
DMG="$OUT/XiaotianBot-$VER-mac-$ARCH.dmg"; RW="$OUT/rw.dmg"; MNT=/tmp/xt-dmg-build
MB=$(( $(du -sm "$APP" | cut -f1) + 300 ))
calm() { sudo -n pkill -9 XProtect 2>/dev/null || true; sync; sleep 2; }
rm -f "$RW" "$DMG"
hdiutil create -size ${MB}m -fs HFS+ -volname "$NAME" -type UDIF -layout SPUD "$RW"
hdiutil attach "$RW" -nobrowse -noverify -noautoopen -mountpoint "$MNT"
ditto "$APP" "$MNT/$NAME.app"; ln -s /Applications "$MNT/应用程序"
calm
for i in 1 2 3 4 5 6 7 8 9 10; do
  hdiutil detach "$MNT" && break
  echo "detach busy, retry $i"; sleep $((i * 3)); calm
  [ $i = 10 ] && hdiutil detach -force "$MNT"
done
for i in 1 2 3 4 5; do
  hdiutil convert "$RW" -format ULMO -o "$DMG" && break
  [ $i = 5 ] && exit 1; echo "convert failed, retry $i"; rm -f "$DMG"; sleep $((i * 10)); calm
done
rm -f "$RW"
hdiutil verify "$DMG"
ls -la "$OUT"
