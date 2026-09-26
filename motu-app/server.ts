import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { registerDailyLoginApi } from "./src/server/dailyLoginApi";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// 健身組整合：MediaPipe 的 wasm／模型與字型放在上一層的 vendor/，健身頁以 ./vendor/... 相對網址載入
app.use('/vendor', express.static(path.resolve(process.cwd(), '../vendor')));

// Initialize Gemini lazily to prevent startup crashes when the API key is not yet set
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required to run the AI Shop assistant. Please define it in your environment/settings.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// AI Shop Assistant Endpoint
app.post("/api/shop/chat", async (req, res) => {
  try {
    const { message, inventory, gold, items } = req.body;

    const systemPrompt = `你是一個在熱帶海島上的精品店店主。你的口氣要親切、充滿活力，並且帶點海島風情（例如提到陽光、海浪、貝殼等）。
你的任務是協助玩家挑選商店中的商品。

玩家目前的金幣：${gold}
玩家已擁有的物品：${inventory.join(", ")}
商店中的商品列表：
${JSON.stringify(items, null, 2)}

請根據玩家的話語提供建議。如果玩家錢不夠，要委婉地提醒。如果玩家想買某樣東西，你可以極力推薦其優點。
請使用繁體中文回答。回覆請保持簡短精練（不超過 100 字）。`;

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: "user", parts: [{ text: message }] }],
      config: {
        systemInstruction: systemPrompt,
      },
    });

    res.json({ reply: response.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * YouTube search, so the music picker takes a song name instead of a pasted URL.
 *
 * This has to be a server route. Searching YouTube requires the Data API v3 and
 * therefore an API key, and an API key shipped to the browser is a key anyone can
 * lift out of the bundle and spend. The IFrame player's old keyless
 * `listType: 'search'` would have avoided all of this, but YouTube removed it in
 * November 2020 - there is no longer any way to search from the client alone.
 *
 * Results are filtered to what the embedded player can actually play
 * (`videoEmbeddable`/`videoSyndicated`): an un-embeddable hit looks like a
 * perfectly good search result and then dies with a 101/150 the moment it is
 * picked, which is exactly the dead end this feature exists to remove.
 *
 * Quota note: search.list costs a FLAT 100 units per call against a 10,000/day
 * default - roughly 100 searches a day. The cost does not scale with
 * `maxResults`, which is why this asks for the maximum 50 rather than a
 * conservative handful: a wider result set is free, and every song the user
 * finds on the first try is a repeat search that never happens. The cache below
 * is the other half of that; between them the daily ceiling stops being ~100
 * searches and starts being ~100 DISTINCT songs.
 */

/** Cached search results, keyed by normalised query. */
interface CachedSearch {
  expires: number;
  results: unknown[];
}

/**
 * A YouTube search result for "告白氣球" is the same today as it was an hour ago,
 * but every repeat of that query used to cost another 100 units. Since the quota
 * is per-day and per-project (not per-user), caching on the server means one
 * lookup serves every repeat from every player until it expires.
 *
 * Twelve hours is chosen to be long enough that a day's listening rarely pays
 * for the same song twice, and short enough that a newly-released MV still shows
 * up the same day.
 */
const searchCache = new Map<string, CachedSearch>();
const SEARCH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const SEARCH_CACHE_MAX = 500;

/**
 * Fold away the differences that don't change what YouTube would return, so
 * "告白氣球", "  告白氣球  " and "告白氣球" typed in caps all share one entry
 * instead of costing 100 units each.
 */
function searchCacheKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

app.get("/api/youtube/search", async (req, res) => {
  const query = String(req.query.q ?? "").trim();
  if (!query) {
    res.status(400).json({ error: "缺少搜尋關鍵字。" });
    return;
  }

  const cacheKey = searchCacheKey(query);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    res.json({ results: cached.results, cached: true });
    return;
  }
  // Expired entries are dropped on read rather than swept on a timer - the only
  // way an entry matters is by being looked up.
  if (cached) searchCache.delete(cacheKey);

  // A Google Cloud API key with "YouTube Data API v3" enabled. Falls back to the
  // Gemini key because both are plain Google Cloud API keys and are usually
  // issued from the same project - if that project has YouTube Data API v3
  // switched on, the same key works and there is nothing extra to configure.
  const key = process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({
      error: "伺服器尚未設定 YouTube 搜尋金鑰。請在 .env 中設定 YOUTUBE_API_KEY。",
    });
    return;
  }

  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("q", query);
    // 50 is the API maximum, and costs exactly the same as asking for 5.
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("videoSyndicated", "true");
    // Bias toward the official music video rather than a lyric re-upload or a
    // reaction video, which is what "搜尋歌名找到那款 MV" actually means.
    url.searchParams.set("videoCategoryId", "10");
    url.searchParams.set("key", key);

    const upstream = await fetch(url);
    const data: any = await upstream.json();

    if (!upstream.ok) {
      const reason = data?.error?.errors?.[0]?.reason;
      // These two are the ones a user can actually act on; everything else is a
      // server-side misconfiguration they cannot fix from the game.
      const message =
        reason === "quotaExceeded"
          ? "今天的 YouTube 搜尋次數已用完,請明天再試,或改用貼連結的方式(貼連結不消耗次數)。"
          : reason === "accessNotConfigured"
            ? "這組金鑰尚未啟用 YouTube Data API v3,請到 Google Cloud Console 開啟。"
            : data?.error?.message || "YouTube 搜尋失敗。";
      res.status(upstream.status).json({ error: message });
      return;
    }

    const results = (data.items ?? [])
      .filter((item: any) => item?.id?.videoId)
      .map((item: any) => ({
        videoId: item.id.videoId,
        title: item.snippet?.title ?? "",
        channel: item.snippet?.channelTitle ?? "",
        thumbnail:
          item.snippet?.thumbnails?.medium?.url ??
          item.snippet?.thumbnails?.default?.url ??
          "",
      }));

    // Cache before responding, so the 100 units just spent cover every repeat of
    // this query for the next 12 hours. Only successes are cached - caching a
    // quota error would keep serving it after the quota resets at midnight PT.
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      // Map iterates in insertion order, so the first key is the oldest.
      const oldest = searchCache.keys().next().value;
      if (oldest !== undefined) searchCache.delete(oldest);
    }
    searchCache.set(cacheKey, { expires: Date.now() + SEARCH_CACHE_TTL_MS, results });

    res.json({ results, cached: false });
  } catch (error) {
    console.error("YouTube Search Error:", error);
    res.status(500).json({ error: "YouTube 搜尋失敗,請稍後再試。" });
  }
});

// 每日登入 — the one part of the game whose state the browser is NOT trusted with. Registered
// before the Vite/static middleware so its routes are matched as API rather than swallowed by the
// SPA fallback. See src/server/dailyLoginApi.ts for why it is server-side at all.
registerDailyLoginApi(app);

// Vite middleware logic
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

setupVite();
