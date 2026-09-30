// 運動前須知（使用者 09-29 要求）：開始訓練頁的「運動前須知」鈕打開這張面板，
// 讓使用者在動之前知道該注意什麼。
//
// ⚠️ 內容一律出自官方來源、改寫成白話，不自行增添醫療建議；每一條都標出處。
//   2026-09-29 已逐句對照原文：
//   - 國民健康署〈運動注意事項〉（社區健康組，更新日期 2025/02/04）
//     https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=571&pid=9777
//   - WHO 2020 身體活動與靜態行為指引（Bull et al., Br J Sports Med 2020;54:1451–1462）
//     https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/
//   只有「本系統提醒」那一段是我們自己的建議（跟相機取景有關），畫面上明確標示不是官方內容。
//   要新增條目，先查到原文再寫，不能憑印象補。
import { icon } from '../../ui/icons.js';

const HPA = { name: '衛生福利部國民健康署〈運動注意事項〉', date: '2025/02/04', url: 'https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=571&pid=9777' };
const WHO = { name: '世界衛生組織（WHO）2020 身體活動與靜態行為指引', date: '2020', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/' };

export const SAFETY_SOURCES = [HPA, WHO];

/** 各段內容（純資料，可單測）。src：'hpa'｜'who'｜'app'（本系統提醒，非官方）。 */
export const SAFETY_SECTIONS = [
  {
    key: 'before', icon: 'clipboard-list', title: '運動前',
    items: [
      { src: 'hpa', text: '先評估身體狀況：若活動時會胸悶、曾因暈眩而失去平衡或意識，或有可能因活動而惡化的骨骼、關節問題，請先詢問醫師再開始。' },
      { src: 'hpa', text: '感冒或發燒而覺得身體不太舒服時，等身體好些再運動；疑似懷孕者，增加活動量前應先詢問醫師。' },
      { src: 'hpa', text: '先做 5 至 10 分鐘的暖身與伸展，促進血液循環、逐步提高體溫與肌肉柔軟度，可有效預防運動傷害。' },
    ],
  },
  {
    key: 'during', icon: 'triangle-alert', title: '運動中',
    items: [
      { src: 'hpa', text: '身體若感覺不適，應立即休息並停止運動，避免傷害繼續惡化；有傷害時應尋求醫師診治。' },
      { src: 'hpa', text: '疼痛或不舒服是重要警訊，可能是運動過量甚至已造成傷害；感到疲累、提不起勁時，應減少運動強度與次數。' },
      { src: 'hpa', text: '隨時注意自己的身體狀況，不要逞強做超出自己體能範圍的運動。' },
    ],
  },
  {
    key: 'after', icon: 'heart', title: '運動後',
    items: [
      { src: 'hpa', text: '運動後再做 10 至 15 分鐘的緩和運動（例如走路或伸展肢體），讓身體回復到休息狀態，整個運動才算結束。' },
      { src: 'hpa', text: '若發生扭傷或拉傷，依「休息、冰敷、壓迫、抬高」四大原則處理；冰敷每次不超過 20 分鐘，可重複多次。' },
    ],
  },
  {
    key: 'weekly', icon: 'target', title: '每週建議運動量（成人 18–64 歲）',
    items: [
      { src: 'who', text: '每週至少 150–300 分鐘中等強度有氧活動，或至少 75–150 分鐘費力強度有氧活動（也可兩者搭配）。' },
      { src: 'who', text: '每週 2 天以上做中等強度以上、涵蓋主要肌群的肌力訓練。' },
    ],
  },
  {
    key: 'app', icon: 'camera', title: '本系統提醒（非官方建議）',
    items: [
      { src: 'app', text: '訓練前清出身體周圍的空間、確認地面不滑，並依動作說明擺好鏡頭，讓全身都拍得到。' },
    ],
  },
];

const SRC_LABEL = { hpa: '國健署', who: 'WHO', app: '本系統' };
const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function safetyPanelHtml() {
  const sections = SAFETY_SECTIONS.map(s => `
      <section class="wk-safe-sec${s.key === 'app' ? ' is-app' : ''}">
        <h3>${icon(s.icon, { size: 18 })} ${esc(s.title)}</h3>
        <ul>${s.items.map(it => `<li><span>${esc(it.text)}</span><small class="wk-safe-src" data-src="${it.src}">${SRC_LABEL[it.src]}</small></li>`).join('')}</ul>
      </section>`).join('');
  const refs = SAFETY_SOURCES.map(r => `<li>${esc(r.name)}（${esc(r.date)}）<br><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a></li>`).join('');
  return `
    <div class="wk-safe" id="wk-safe" role="dialog" aria-modal="true" aria-labelledby="wk-safe-t" hidden>
      <div class="wk-safe-card">
        <div class="wk-safe-head">
          <h2 id="wk-safe-t">${icon('lightbulb', { size: 22 })} 運動前須知</h2>
          <button class="wk-safe-x" id="wk-safe-x" type="button" aria-label="關閉">✕</button>
        </div>
        <div class="wk-safe-body">
          <p class="wk-safe-lead">以下內容整理自衛生福利部國民健康署與世界衛生組織的公開建議，僅供一般參考，不能取代醫師診斷。</p>
          ${sections}
          <div class="wk-safe-refs"><b>資料來源</b><ol>${refs}</ol></div>
        </div>
        <button class="btn wk-safe-ok" id="wk-safe-ok" type="button">我知道了</button>
      </div>
    </div>`;
}

/** 接上開關：open 鈕 → 顯示；✕／我知道了／點遮罩／Esc → 關閉並把焦點還給開啟鈕。 */
export function bindSafetyPanel(scope, openBtn) {
  const panel = scope.querySelector('#wk-safe');
  if (!panel || !openBtn) return;
  const close = () => { panel.hidden = true; openBtn.focus(); };
  openBtn.onclick = () => { panel.hidden = false; panel.querySelector('#wk-safe-ok')?.focus(); };
  panel.querySelector('#wk-safe-x').onclick = close;
  panel.querySelector('#wk-safe-ok').onclick = close;
  panel.onclick = (e) => { if (e.target === panel) close(); };
  panel.onkeydown = (e) => { if (e.key === 'Escape') close(); };
}
