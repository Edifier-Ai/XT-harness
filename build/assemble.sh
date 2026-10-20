#!/bin/bash
set -e
cd "$(dirname "$0")"; ROOT=$PWD/..
OUT=$PWD/out/TianxiAI
rm -rf out && mkdir -p $OUT
unzip -q dl/electron.zip -d $OUT
mv $OUT/electron.exe $OUT/TianxiAI.exe
rm -f $OUT/resources/default_app.asar $OUT/LICENSES.chromium.html
mkdir -p $OUT/resources/app $OUT/resources/runtime
cp $ROOT/desktop/{main.js,shell.js,updater.js,update.json,preload.js,loading.html,package.json,icon.png} $OUT/resources/app/
cp -r runtime/node_modules $OUT/resources/runtime/node_modules
cp runtime/package.json $OUT/resources/runtime/
rm -rf $OUT/resources/runtime/node_modules/dsh-tianxi && cp -r $ROOT/tianxi $OUT/resources/runtime/node_modules/dsh-tianxi
# slim: not used by 天禧 (document preview wasm, type defs, source maps, other platforms, other UI languages)
R=$OUT/resources/runtime/node_modules
rm -rf $R/@deepseek-ai/libreoffice-kit-wasm $R/node-pty/prebuilds/darwin-* $R/node-pty/prebuilds/linux-* $R/node-pty/prebuilds/win32-arm64
find $R \( -name '*.map' -o -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.tsbuildinfo' \) -type f -delete
find $OUT/locales -type f ! -name 'zh-CN.pak' ! -name 'en-US.pak' -delete
node tools/setexe.mjs $OUT/TianxiAI.exe icon.ico
echo assembled; du -sm $OUT
