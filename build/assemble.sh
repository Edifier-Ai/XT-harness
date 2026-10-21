#!/bin/bash
set -e
# usage: build/assemble.sh x.y.z  (needs build/dl/electron.zip and build/runtime from a win32 npm install)
VER=${1:?version}
cd "$(dirname "$0")"; ROOT=$PWD/..
OUT=$PWD/out/TianxiAI
rm -rf out && mkdir -p $OUT
if command -v unzip >/dev/null; then unzip -q dl/electron.zip -d $OUT; else 7z x -y -o"$OUT" dl/electron.zip >/dev/null; fi
mv $OUT/electron.exe $OUT/TianxiAI.exe
rm -f $OUT/resources/default_app.asar $OUT/LICENSES.chromium.html
mkdir -p $OUT/resources/app $OUT/resources/runtime
cp $ROOT/desktop/{main.js,shell.js,updater.js,freegate.js,update.json,preload.js,loading.html,package.json,icon.png,icon.ico} $OUT/resources/app/
# the shipped version, so a fresh install does not download itself again
node -e "const f=require('path').resolve('out/TianxiAI/resources/app/package.json'),p=require(f);p.version='$VER';require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
cp -r runtime/node_modules $OUT/resources/runtime/node_modules
cp runtime/package.json $OUT/resources/runtime/
rm -rf $OUT/resources/runtime/node_modules/dsh-tianxi && cp -r $ROOT/tianxi $OUT/resources/runtime/node_modules/dsh-tianxi
# slim: not used by 小天 (document preview wasm, type defs, source maps, other platforms, other UI languages)
R=$OUT/resources/runtime/node_modules
rm -rf $R/@deepseek-ai/libreoffice-kit-wasm $R/node-pty/prebuilds/darwin-* $R/node-pty/prebuilds/linux-* $R/node-pty/prebuilds/win32-arm64
find $R \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.tsbuildinfo' \) -type f -delete
find $OUT/locales -type f ! -name 'zh-CN.pak' ! -name 'en-US.pak' -delete
node tools/setexe.mjs out/TianxiAI/TianxiAI.exe icon.ico $VER
echo assembled; du -sm $OUT
# the installer (makensis from the nsis package)
# on Windows (Git Bash) makensis needs Windows paths
W=$OUT; command -v cygpath >/dev/null && W=$(cygpath -w "$OUT")
LC_ALL=C.UTF-8 makensis -V2 -INPUTCHARSET UTF8 "-DSRC=$W" -DVER=$VER "-DOUT=out/XiaotianBot-Setup-$VER.exe" installer.nsi
