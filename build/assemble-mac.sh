#!/bin/bash
set -e
# usage: build/assemble-mac.sh x.y.z arm64|x64   (on a Mac; needs build/dl/electron-mac-<arch>.zip and build/runtime-mac from an npm install on a Mac)
# Makes build/out-mac/小天 Bot.app and build/out-mac/XiaotianBot-<ver>-mac-<arch>.dmg. Same client and 小天 layer as Windows.
VER=${1:?version}; ARCH=${2:?arch}
cd "$(dirname "$0")"; ROOT=$PWD/..
OUT=$PWD/out-mac; APP="$OUT/小天 Bot.app"; RES="$APP/Contents/Resources"; PL="$APP/Contents/Info.plist"
rm -rf "$OUT" && mkdir -p "$OUT"
ditto -x -k dl/electron-mac-$ARCH.zip "$OUT"
mv "$OUT/Electron.app" "$APP"
# Electron counts itself as packaged only when its executable is not called Electron, and looks for
# "<executable> Helper*.app" next to it: rename both (ASCII names; the name people see is CFBundleDisplayName).
EXE=XiaotianBot; B=/usr/libexec/PlistBuddy
mv "$APP/Contents/MacOS/Electron" "$APP/Contents/MacOS/$EXE"
plutil -replace CFBundleExecutable -string "$EXE" "$PL"
for h in "$APP/Contents/Frameworks/Electron Helper"*.app; do
  n=$(basename "$h" .app); m="$EXE${n#Electron}"
  mv "$h/Contents/MacOS/$n" "$h/Contents/MacOS/$m"
  for k in CFBundleExecutable CFBundleName CFBundleDisplayName; do plutil -replace $k -string "$m" "$h/Contents/Info.plist"; done
  mv "$h" "$APP/Contents/Frameworks/$m.app"
done
ls "$APP/Contents/Frameworks"
rm -f "$RES/default_app.asar"
mkdir -p "$RES/app" "$RES/runtime"
cp $ROOT/desktop/{main.js,shell.js,updater.js,freegate.js,update.json,preload.js,loading.html,package.json,icon.png,icon.ico} "$RES/app/"
node -e "const f=require('path').resolve(process.argv[1]),p=require(f);p.version='$VER';require('fs').writeFileSync(f,JSON.stringify(p,null,2))" "$RES/app/package.json"
cp -R runtime-mac/node_modules "$RES/runtime/node_modules"
cp runtime-mac/package.json "$RES/runtime/"
rm -rf "$RES/runtime/node_modules/dsh-tianxi" && cp -R $ROOT/tianxi "$RES/runtime/node_modules/dsh-tianxi"
# slim, as on Windows
R="$RES/runtime/node_modules"
rm -rf "$R/@deepseek-ai/libreoffice-kit-wasm" "$R"/node-pty/prebuilds/win32-* "$R"/node-pty/prebuilds/linux-*
find "$R" \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.tsbuildinfo' \) -type f -delete
# keep only Chinese and English UI strings
find "$RES" -maxdepth 1 -name '*.lproj' ! -name 'zh_CN.lproj' ! -name 'en.lproj' -exec rm -rf {} +
mkdir -p "$RES/zh_CN.lproj"
# the app's name, id, version and icon
cp icon.icns "$RES/electron.icns"
$B -c "Set :CFBundleName 小天 Bot" "$PL"
$B -c "Set :CFBundleDisplayName 小天 Bot" "$PL" 2>/dev/null || $B -c "Add :CFBundleDisplayName string 小天 Bot" "$PL"
$B -c "Set :CFBundleIdentifier com.lenovo.tianxi.concept" "$PL"
$B -c "Set :CFBundleShortVersionString $VER" "$PL"
$B -c "Set :CFBundleVersion $VER" "$PL"
$B -c "Add :CFBundleDevelopmentRegion string zh_CN" "$PL" 2>/dev/null || $B -c "Set :CFBundleDevelopmentRegion zh_CN" "$PL"
$B -c "Add :LSApplicationCategoryType string public.app-category.productivity" "$PL" 2>/dev/null || true
# voice input and voice calls ask for the microphone
$B -c "Add :NSMicrophoneUsageDescription string 小天用麦克风听你说话（语音输入和语音通话）。" "$PL" 2>/dev/null || $B -c "Set :NSMicrophoneUsageDescription 小天用麦克风听你说话（语音输入和语音通话）。" "$PL"
# No Apple developer certificate: sign ad hoc, which Apple-silicon Macs need to run the app and its native modules at all.
find "$R" \( -name '*.node' -o -name '*.dylib' \) -type f -exec codesign --force --sign - {} \; 2>/dev/null
find "$R" -type f -perm -u+x ! -name '*.js' ! -name '*.sh' -exec sh -c 'file -b "$1" | grep -q Mach-O && codesign --force --sign - "$1"' _ {} \; 2>/dev/null || true
codesign --force --deep --sign - "$APP"
codesign --verify --deep "$APP" && echo signed
echo assembled; du -sm "$APP"
# the disk image: drag 小天 Bot into Applications
STAGE="$OUT/dmg"; mkdir -p "$STAGE"; cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/应用程序"
hdiutil create -volname "小天 Bot" -srcfolder "$STAGE" -ov -format UDZO "$OUT/XiaotianBot-$VER-mac-$ARCH.dmg"
rm -rf "$STAGE"
ls -la "$OUT"
