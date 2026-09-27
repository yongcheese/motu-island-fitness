// 遊戲組試玩包的本機伺服器：只用 Node 內建模組，不需要 npm install。
// 把 site/（整合版 dist ＋ vendor）送給瀏覽器，並自動開啟瀏覽器。
// 只綁 127.0.0.1：相機在 localhost 可用，也不會觸發 Windows 防火牆詢問。
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const SITE = path.join(__dirname, 'site');
const HOST = '127.0.0.1';
const FIRST_PORT = 5180; // 避開遊戲組開發伺服器的 3000
const PORT_TRIES = 20;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', // 型別不對，MediaPipe 的 wasm 會無法串流編譯
  '.task': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.hdr': 'application/octet-stream',
  '.exr': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

function sendFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function handle(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }

  // 商店聊天、YouTube 搜尋、每日登入要伺服器金鑰，試玩包不提供；回 JSON 讓前端顯示錯誤而不是收到 HTML
  if (pathname.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '試玩包沒有附伺服器功能（商店聊天、YouTube 搜尋、每日登入）。' }));
    return;
  }

  const file = path.normalize(path.join(SITE, pathname));
  if (!file.startsWith(SITE)) {
    res.writeHead(403).end();
    return;
  }

  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file);
    // 有副檔名卻找不到 → 真的缺檔；沒有副檔名 → 交給 React 處理頁面路徑
    if (path.extname(pathname)) {
      res.writeHead(404).end();
      return;
    }
    sendFile(res, path.join(SITE, 'index.html'));
  });
}

function openBrowser(url) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` :
    process.platform === 'darwin' ? `open "${url}"` :
    `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function listen(port, triesLeft) {
  const server = http.createServer(handle);
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 1) return listen(port + 1, triesLeft - 1);
    console.error(`Cannot start server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, HOST, () => {
    // 有些 Windows 的 localhost 先解析成 IPv6 ::1，同一埠再補聽一個；失敗（沒有 IPv6）就算了
    http.createServer(handle).on('error', () => {}).listen(port, '::1');
    const url = `http://localhost:${port}/`;
    console.log('');
    console.log('  Motu is running at ' + url);
    console.log('  Close this window to stop the game.');
    console.log('');
    if (!process.env.MOTU_NO_BROWSER) openBrowser(url);
  });
}

listen(Number(process.env.MOTU_PORT) || FIRST_PORT, PORT_TRIES);
