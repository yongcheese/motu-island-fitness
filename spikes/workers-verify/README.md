# Cloudflare Workers 後端複驗可行性測試（spike）

結論與完整數據見 `文件/04_內部規劃/Cloudflare_Workers_後端複驗可行性測試報告_20260926.md`。
這裡是一次性的驗證程式，不屬於正式 App；正式導入時存檔／讀檔要併入 `app/core/engine.js` 並補測試。

| 檔案 | 用途 |
|---|---|
| `src/index.js` | Worker：`/verify` 整段複驗、`/verify-chunk` 分段複驗（HMAC 簽章存檔） |
| `src/codec.js` | 三種上傳格式：json／json4（小數 4 位）／bin（二進位） |
| `src/engine-snap.js` | **自動產生**：正式引擎＋snapshot/restore，勿手改 |
| `make-snap-engine.mjs` | 從 `app/core/engine.js` 產生上面那份 |
| `bench.mjs` | 本機 wrangler：三種格式的耗時與結果比對 |
| `quant-check.mjs` | 座標量化是否改變判定（純 Node） |
| `parity-check.mjs` | 前端先量化後判定 vs Worker 是否一致 |
| `chunk-check.mjs` | 拆段 vs 整段一致性（含遮擋資料，純 Node） |
| `remote-bench.mjs`、`set-bench.mjs` | 線上：整場／每組上傳的 CPU（配合 `wrangler tail --format json`） |
| `chunk-bench.mjs` | 分段複驗與竄改防護（本機或線上） |

執行：`npm install` → `npm run dev`（本機）→ 另開終端 `node bench.mjs` 等。
線上測試要 `WORKER_URL=https://...workers.dev`；部署與刪除（`npx wrangler deploy`／`delete`）需由使用者親自執行。
`wrangler.jsonc` 內的 `SPIKE_HMAC_KEY` 是測試用明碼，正式版改用 `wrangler secret`。
