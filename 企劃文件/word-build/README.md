# 企劃書 Word 產生器

把 `../AI健身系統_育秀盃企劃書_v2_整合版.md` 轉成美化排版的
`../AI健身系統_育秀盃企劃書_v2_整合版.docx`。**Markdown 是唯一的內容來源**，
改完 md 重跑一次就會重出 Word 檔。

## 使用方式

```bash
cd 企劃文件/word-build
python3 build_docx.py
```

## 需要的環境

| 需求 | 用途 | 備註 |
|---|---|---|
| `python-docx` | 組出 .docx | `pip3 install python-docx` |
| Node.js（`npx`） | 只在 mermaid 圖有變動時才需要 | 第一次會自動下載 mermaid-cli |

圖沒改就不會重新渲染（比對 `mmd/*.mmd` 與 `img/*.png` 的時間戳），
所以一般改文字重跑只要幾秒、也不需要網路。

## 目錄結構

| 路徑 | 內容 |
|---|---|
| `build_docx.py` | 轉檔主程式（Markdown 解析 + Word 排版 + mermaid 前處理） |
| `mmd/` | 從 md 抽出的 14 張 mermaid 原始碼，**由程式自動產生，不要手改** |
| `img/` | 上述 mermaid 渲染出的 PNG（3 倍解析度） |
| `mconf.json` | mermaid 主題（中文字型、配色與正文一致） |
| `pconf.json` | mermaid-cli 的 puppeteer 參數 |

## 排版規格

- A4、邊界 2.5 cm，中文蘋方／西文 Helvetica Neue，行距 1.4
- 封面 → 目錄（Word 功能變數）→ 正文；頁首書名、頁尾「第 X 頁」
- `##` → 章（深藍＋下藍線）、`###` → 節（左側藍色色塊）、`####` → 小節
- 表格：深藍表頭反白、隔列斑馬紋、跨頁重複表頭、寬度撐滿版心
- `>` 引言 → 淺藍底＋左粗藍條方框；mermaid → 置中圖片（自動縮到單頁內）

## 已知事項

- 開檔時 Word 會問要不要更新功能變數，選「是」目錄頁碼才會出現
  （這是刻意設定的 `w:updateFields`）。
- 封面把標題與作品資訊拆成標題列與資訊表呈現，文字與 md 開頭那段完全相同。
- 本機 `pandoc` 會卡死（連 `--version` 都無回應），所以沒有走 pandoc 路線。
