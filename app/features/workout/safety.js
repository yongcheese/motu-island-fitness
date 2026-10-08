// 運動前須知（使用者 09-29 要求）：開始訓練頁的「運動前須知」鈕打開這張面板，
// 讓使用者在動之前知道該注意什麼。
//
// ⚠️ 內容一律出自官方來源、改寫成白話，不自行增添醫療建議；每一條都標出處。
//   2026-09-29 已逐句對照原文：
//   - 國民健康署〈運動注意事項〉（社區健康組，更新日期 2025/02/04）
//     https://www.hpa.gov.tw/Pages/Detail.aspx?nodeid=571&pid=9777
//   - WHO 2020 身體活動與靜態行為指引（Bull et al., Br J Sports Med 2020;54:1451–1462）
//     https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/
//   我們自己的內容只有兩處，畫面上都標「本系統」、不寫成官方：運動前須知的「本系統提醒」段（相機取景），
//   以及動作注意事項裡各動作的要點（取自判定規則與矯正口令；查不到官方針對個別動作的說明）。
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

function sectionHtml(s) {
  return `
      <section class="wk-safe-sec${s.key === 'app' ? ' is-app' : ''}">
        <h3>${icon(s.icon, { size: 18 })} ${esc(s.title)}</h3>
        <ul>${s.items.map(it => `<li><span>${esc(it.text)}</span><small class="wk-safe-src" data-src="${it.src}">${SRC_LABEL[it.src]}</small></li>`).join('')}</ul>
      </section>`;
}
function refsHtml() {
  const refs = SAFETY_SOURCES.map(r => `<li>${esc(r.name)}（${esc(r.date)}）<br><a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${esc(r.url)}</a></li>`).join('');
  return `<div class="wk-safe-refs"><b>資料來源</b><ol>${refs}</ol></div>`;
}
/** 面板外殼（運動前須知、動作注意事項共用）：id 決定面板與內部按鈕的 id（`${id}-x`、`${id}-ok`）。 */
function panelHtml({ id, ic, title, lead, body }) {
  return `
    <div class="wk-safe" id="${id}" role="dialog" aria-modal="true" aria-labelledby="${id}-t" hidden>
      <div class="wk-safe-card">
        <div class="wk-safe-head">
          <h2 id="${id}-t">${icon(ic, { size: 22 })} ${esc(title)}</h2>
          <button class="wk-safe-x" id="${id}-x" type="button" aria-label="關閉">✕</button>
        </div>
        <div class="wk-safe-body">
          <p class="wk-safe-lead">${esc(lead)}</p>
          ${body}
        </div>
        <button class="btn wk-safe-ok" id="${id}-ok" type="button">我知道了</button>
      </div>
    </div>`;
}

export function safetyPanelHtml() {
  return panelHtml({
    id: 'wk-safe', ic: 'lightbulb', title: '運動前須知',
    lead: '以下內容整理自衛生福利部國民健康署與世界衛生組織的公開建議，僅供一般參考，不能取代醫師診斷。',
    body: SAFETY_SECTIONS.map(sectionHtml).join('') + refsHtml(),
  });
}

/**
 * 動作注意事項（09-30 使用者要求：健身主畫面一顆鈕看全部動作）。
 * 每個動作的內容一律取自系統本身的判定規則與矯正口令（呼叫端從 exercises/*.js 與 judgeText 帶進來），
 * 標成「本系統」—— 查不到國健署／體育署針對個別動作的官方說明，所以不寫成官方建議。
 * 下方再接上面已查證的官方一般安全建議（不含「本系統提醒」段，避免重複）。
 * @param {{id:string,name:string,target:string,camera:string,judge:string,tips:string[]}[]} list
 */
export function exerciseGuideItems(list) {
  return list.map(ex => ({
    key: 'ex-' + ex.id, icon: 'dumbbell', title: `${ex.name}（${ex.target}）`,
    items: [
      { src: 'app', text: `鏡頭擺放：${ex.camera}` },
      { src: 'app', text: `怎樣才算一下：${ex.judge}` },
      ...ex.tips.map(t => ({ src: 'app', text: `姿勢提醒：${t}` })),
    ],
  }));
}
export function exerciseGuideHtml(list) {
  const nav = `<nav class="wk-guide-nav" aria-label="跳到動作">${list.map(ex => `<button type="button" class="wk-chip" data-jump="ex-${esc(ex.id)}">${esc(ex.name)}</button>`).join('')}</nav>`;
  const exSecs = exerciseGuideItems(list).map(s => sectionHtml(s).replace('<section class="wk-safe-sec"', `<section class="wk-safe-sec" data-sec="${s.key}"`)).join('');
  const official = SAFETY_SECTIONS.filter(s => s.key !== 'app').map(sectionHtml).join('');
  return panelHtml({
    id: 'wk-guide', ic: 'clipboard-list', title: '動作注意事項',
    lead: '各動作的要點取自本系統的判定標準與姿勢提醒（訓練時畫面上的矯正口令就是這些）；最下方是國健署與 WHO 的一般安全建議。僅供一般參考，不能取代醫師診斷。',
    body: nav + exSecs + `<h3 class="wk-guide-divider">${icon('lightbulb', { size: 18 })} 一般安全建議（官方）</h3>` + official + refsHtml(),
  });
}

/** 接上開關：open 鈕 → 顯示；✕／我知道了／點遮罩／Esc → 關閉並把焦點還給開啟鈕。 */
export function bindSafetyPanel(scope, openBtn, id = 'wk-safe') {
  const panel = scope.querySelector('#' + id);
  if (!panel || !openBtn) return;
  const close = () => { panel.hidden = true; openBtn.focus(); };
  openBtn.onclick = () => { panel.hidden = false; panel.querySelector(`#${id}-ok`)?.focus(); };
  panel.querySelector(`#${id}-x`).onclick = close;
  panel.querySelector(`#${id}-ok`).onclick = close;
  panel.onclick = (e) => { if (e.target === panel) close(); };
  panel.onkeydown = (e) => { if (e.key === 'Escape') close(); };
  // 動作注意事項：上方動作膠囊 → 捲到該動作
  panel.querySelectorAll('[data-jump]').forEach(b => {
    b.onclick = () => panel.querySelector(`[data-sec="${b.dataset.jump}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}
