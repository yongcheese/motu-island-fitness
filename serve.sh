#!/usr/bin/env bash
# 啟動本機伺服器（ES module + WASM 需經 http:// 才能載入，不能 file://）。
# 用法：bash serve.sh [port]  → 開瀏覽器到 http://localhost:8080
# 實際伺服器在 serve.py（no-cache + 正確 MIME，避免改檔後瀏覽器吃舊快取）。
set -e
cd "$(dirname "$0")"
PORT="${1:-8080}"
echo "Island Fitness AI → http://localhost:${PORT}"
echo "（按 Ctrl+C 結束）"
python3 serve.py "${PORT}"
