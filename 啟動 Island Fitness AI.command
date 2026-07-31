#!/bin/bash
# 雙擊此檔即可啟動 Island Fitness AI（會開啟瀏覽器）。
cd "$(dirname "$0")"
PORT=8080
# 找一個可用的埠（8080 被占用就往上找）
while lsof -ti:$PORT >/dev/null 2>&1; do
  # 已在跑就直接用它
  if curl -s -o /dev/null "http://localhost:$PORT/index.html"; then break; fi
  PORT=$((PORT+1))
done

URL="http://localhost:$PORT/index.html"
if ! curl -s -o /dev/null "http://localhost:$PORT/index.html"; then
  echo "啟動本機伺服器於 $URL ..."
  python3 serve.py $PORT >/tmp/island-fitness-ai.log 2>&1 &
  SERVER_PID=$!
  sleep 1
fi

echo ""
echo "  🏝️  Island Fitness AI 已啟動"
echo "  ➜  網址： $URL"
echo "  （瀏覽器會自動開啟；訓練分頁請允許『使用相機』）"
echo "  關閉：直接關掉這個終端機視窗即可。"
echo ""
open "$URL"
# 保持視窗開著讓伺服器持續運作
wait 2>/dev/null
