# Stitch 設計系統「Lumina Kinetic」（Island Fitness）

來源：Google Stitch 專案 projects/2242100647705384623 之 designMd。
風格：Premium 健身 × 遊戲化，Glassmorphism + Cyber-Minimalism。

## 核心 Token
- 背景：Ebony #0a0a0c / #121414；卡片 Charcoal #1a1a1e（80% 透明）+ 20px backdrop-blur
- Primary（Mint）#22e0a1（含光暈，Go/正向/CTA，按鈕底白字黑字）
- Secondary（Coral）#ff7a59（高能量、提醒、Streak/Rank 遊戲化 HUD）
- 文字：純白為主，次要 60–70% 白
- 邊框：1px、Primary 15% 透明的「霓虹邊」+ 頂/左高光
- 光暈：Active 元素用 Primary 柔光 drop shadow（blur 24、30% 透明）
- 字體：Montserrat（標題/數據，幾何運動感，display 48/800）、Inter（內文）；
  中文（zh-Hant）用系統字 PingFang TC / Noto Sans TC，weight ≤700 防糊
- 圓角：容器 24px、按鈕/chip 全圓 pill；圖表圓頭
- 間距：8px 網格；卡內距 16px；大區塊 48px
- 進度環：粗 8px+ 主環，Mint→emerald 漸層

## 落地方式
字體 woff2 已 vendor 至 vendor/fonts（Inter/Montserrat latin 子集）。
新增 app/styles/lumina.css（最後載入），覆寫 app.css 既有 CSS 變數與關鍵元件，
全站（島嶼/訓練/健康/設定）自動套用此設計系統，不動功能與引擎。
