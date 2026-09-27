#!/bin/bash
# 產生給遊戲組的 Windows 試玩包：建置整合版 → 組 site/（dist＋vendor）→ 壓成 zip
# 用法：bash tools/trial-pack/pack.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="$(cd "$ROOT/.." && pwd)/育秀杯_試玩包"
STAMP="$(date +%Y%m%d-%H%M)"
NAME="Motu-Trial"
STAGE="$OUT_DIR/$NAME"

# 正式版建置：不開示範模式
( cd "$ROOT/motu-app" && env -u VITE_FITNESS_DEMO npm run build )

rm -rf "$STAGE"
mkdir -p "$STAGE/runtime"
cp -R "$ROOT/motu-app/dist" "$STAGE/runtime/site"
cp -R "$ROOT/vendor" "$STAGE/runtime/site/vendor"
cp "$HERE/serve.cjs" "$STAGE/runtime/serve.cjs"
cp "$HERE/Start-Motu.bat" "$STAGE/Start-Motu.bat"
# README 轉成 Windows 記事本友善的 UTF-8 BOM＋CRLF
printf '\xEF\xBB\xBF' > "$STAGE/README.txt"
perl -pe 's/\r?\n/\r\n/' "$HERE/README.txt" >> "$STAGE/README.txt"
find "$STAGE" -name .DS_Store -delete

ZIP="$OUT_DIR/${NAME}-${STAMP}.zip"
rm -f "$ZIP"
( cd "$OUT_DIR" && zip -qr -X "$ZIP" "$NAME" )
echo "試玩包：$ZIP ($(du -h "$ZIP" | cut -f1))"
