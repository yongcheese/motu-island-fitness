// Tab2 訓練（核心）：分類 → 清單 → 簡介 → 即時偵測 → 結算。
import { EXERCISES, PLANNED, GROUPS } from '../../core/exercises/index.js';
import { coinsFor } from '../../core/rewards.js';
import { GATE_PROGRESS as SQUAT_GATE_PROGRESS } from '../../core/exercises/squat.js';
import { createDetector } from '../../core/engine.js';
import { createPose, startCamera } from '../../core/pose.js';
import { drawSkeleton, drawCountdownRing, drawProgressRing, COLOR } from '../../ui/feedback.js';
import { makeSequence } from '../../core/synth.js';
import { createAvatar3D } from '../../ui/avatar3d.js';
import { pose3d, EX_VIEW } from '../../ui/pose3d.js';
import { nextGoal } from '../island/goals.js';
import { planFor, planLabel } from '../../core/difficulty.js';   // Slice4 R3：結算第二幕與島嶼目標條共用（純函式、零依賴）
import { coachPolicy, repCountdownCue } from '../../core/coach-policy.js';   // Slice3 修復 F3：誠實回饋決策（純函式）
import { framingReport, createStabilityTracker, landmarkOk, HEAD_LANDMARKS, cameraHeightHint } from '../../core/framing.js';
import { sampleVideoLuma, lightingReport } from '../../core/lighting.js';   // 光線品質：量出來並告知，不放寬判定門檻
import { ALL_FRAME, framingPose, displaySegments, gaugeColor, phaseCueText } from '../../ui/display-colors.js';   // 顏色語意（純函式，可單測）
import { icon } from '../../ui/icons.js';   // 合體 Slice 3：Lucide 線條圖示，取代 emoji

let CTX = null;
let root = null;
let live = null;        // 即時偵測 runtime
let demoRaf = null;     // intro 動畫
let introAv = null;     // 簡介頁 3D 人偶（Three.js renderer，需顯式 dispose 釋放 GL context）
let cardAv = null;      // 訓練卡片共用離屏 3D renderer
let bgmCtx = null, bgmNodes = null;   // 背景音樂 (WebAudio)

function disposeIntroAv() { try { introAv?.dispose(); } catch { } introAv = null; }
function disposeCardAv() { try { cardAv?.dispose(); } catch { } cardAv = null; }

/* ---------------- 整合版插槽（合體第二階段整合 Slice 1） ----------------
   遊戲組的元件（島嶼主角、阿肌、對話框、金幣碎片列）由整合版宿主用 React 畫進這些節點。
   只有宿主提供 ctx.slots 時才產生；舊版 :8080 沒有宿主，輸出空字串，版面完全不變。 */
export function slotHtml(slots, name) {
  return slots ? `<div class="fx-slot fx-slot-${name}" data-slot="${name}"></div>` : '';
}
function clearSlots() { CTX?.slots?.set({}); }
// 每次重畫 root 後呼叫：把目前畫面上的插槽一次交給宿主（舊節點隨 innerHTML 消失，宿主整批換掉）
function syncSlots() {
  if (!CTX?.slots) return;
  const map = {};
  root.querySelectorAll('[data-slot]').forEach(el => { map[el.dataset.slot] = el; });
  CTX.slots.set(map);
}
/* 整合版事件（Slice 7）：陪伴主角跟著計次動、對話框說台詞。只有宿主提供 ctx.events 時才發；舊版沒有，完全不影響。
   type：rep（每計一下，含沒算到）／phase（ready 準備、work 進行、rest 休息、end 結束）／milestone（last3 剩 3 下、target 本組達標） */
export function emitLive(events, list) {
  if (!events?.emit || !list?.length) return 0;
  for (const e of list) events.emit(e.type, e.payload);
  return list.length;
}
function emitPhase(phase, set, ex) {
  emitLive(CTX?.events, [{ type: 'phase', payload: { phase, exercise: ex?.id, setIdx: set?.idx ?? 1, totalSets: set?.total ?? 1 } }]);
}
/** 這一幀計次後要發的事件（純函式）。set＝組數狀態（baseValid 為本組起點的累計有效次數）。 */
export function liveRepEvents(res, set) {
  if (!res?.repCountedThisFrame || !set) return [];
  const total = res.reps?.valid ?? 0;
  const setValid = Math.max(0, total - (set.baseValid || 0));
  const valid = !!res.repValidThisFrame;
  const list = [{ type: 'rep', payload: { valid, setValid, target: set.target, total } }];
  if (valid && setValid >= set.target) list.push({ type: 'milestone', payload: { kind: 'target', setIdx: set.idx, totalSets: set.total } });
  else if (valid && set.target - setValid === 3) list.push({ type: 'milestone', payload: { kind: 'last3', setIdx: set.idx, totalSets: set.total } });
  return list;
}
/** 結束訓練後要逐項領取的獎勵 —— 只剩「宿主有 ctx.game.claim 卻沒有 settle」的相容路徑使用（Slice 1 骨架）；
 *  整合版一律走 ctx.game.settle，金額以遊戲端為準（看板架構決策 5）。 */
export function previewAwards(session) {
  return [
    { kind: 'coins', amount: session.coinsEarned || 0 },
    { kind: 'xp', amount: session.xpGain ?? (session.validReps || 0) * 5 },
  ];
}
/** 結束訓練後的遊戲端發獎＋領獎（合體第二階段 Slice 9）。沒有 ctx.game 時什麼都不做（舊版）。
 *  有 settle：交出 session（補上計次方式 mode）由遊戲端發放金幣、經驗、商品碎片並回傳領獎清單；
 *  清單為空（示範模式、0 下有效）就跳過領獎，直接進結算。
 *  settle 或 claim 失敗會丟出，由呼叫端照樣進結算頁（錢已經由遊戲端處理，畫面不能卡住）。 */
export async function claimRewards(game, session, mode) {
  if (!game) return [];
  const awards = game.settle ? await game.settle({ ...session, mode })
    : game.claim ? previewAwards(session) : [];
  if (awards?.length && game.claim) await game.claim(awards);
  return awards || [];
}

// Slice3 R3（六-補決策）：SET_SECONDS(60s 時間制) 退役 → 次數為主、SAFETY_SECONDS=單組 90 秒安全網（防站著不動卡死）。
const SAFETY_SECONDS = 90;

// 柔和環境背景音樂（WebAudio，免音檔）。點擊為使用者手勢，可合法啟動。
function toggleBgm(on) {
  try {
    if (on) {
      bgmCtx = bgmCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (bgmCtx.state === 'suspended') bgmCtx.resume();
      if (bgmNodes) return;
      const master = bgmCtx.createGain(); master.gain.value = 0.05; master.connect(bgmCtx.destination);
      const lfo = bgmCtx.createOscillator(); lfo.frequency.value = 0.16;
      const lfoGain = bgmCtx.createGain(); lfoGain.gain.value = 0.025;
      lfo.connect(lfoGain); lfoGain.connect(master.gain); lfo.start();
      const oscs = [220, 277.18, 329.63].map((f) => {
        const o = bgmCtx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = bgmCtx.createGain(); g.gain.value = 0.5; o.connect(g); g.connect(master); o.start(); return o;
      });
      bgmNodes = { master, lfo, oscs };
    } else if (bgmNodes) {
      try { bgmNodes.oscs.forEach(o => o.stop()); bgmNodes.lfo.stop(); bgmNodes.master.disconnect(); } catch { }
      bgmNodes = null;
    }
  } catch { /* WebAudio 不支援則靜默 */ }
}

// 在使用者手勢（點「立即開始」）當下解鎖音訊，之後倒數嗶聲/結束提示才能發聲。
function ensureAudio() {
  try {
    bgmCtx = bgmCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (bgmCtx.state === 'suspended') bgmCtx.resume();
  } catch { /* noop */ }
}

// 短促提示音（倒數、最後三秒）。與語音是不同通道，不會打斷口語說明。
function beep(freq = 640, dur = 0.12, vol = 0.2) {
  try {
    ensureAudio();
    if (!bgmCtx) return;
    const t = bgmCtx.currentTime;
    const o = bgmCtx.createOscillator(); const g = bgmCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(bgmCtx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.03);
  } catch { /* noop */ }
}

export default {
  id: 'workout', label: '訓練', icon: 'dumbbell',   // 分頁列實際讀 main.js 的 TABS，這裡只是 Lucide 名稱註記
  mount(el, ctx) { CTX = ctx; root = el; renderMenu(); },
  unmount() { stopLive(); cancelAnimationFrame(demoRaf); disposeIntroAv(); stopCardAnims(); disposeCardAv();
    // 獎勵儀式的 timer 與掛在 body 上的金幣、彩帶都要清 —— 它們不會隨 #view.innerHTML 一起消失，
    // 切頁後會變成畫面上擦不掉的殘影。rwClear 一併處理（Slice 13）。
    rwClear();
    clearSlots();   // 整合版：頁面拆掉時一併撤掉畫進插槽的遊戲元件
    CTX?.setChrome(true); },
};

/* ---------------- 選單 ---------------- */
function renderMenu(activeGroup = 'all') {
  CTX.setChrome(true);
  cancelAnimationFrame(demoRaf);
  disposeIntroAv();
  const groups = ['all', ...Object.keys(GROUPS)];
  const groupName = (g) => g === 'all' ? '全部' : GROUPS[g];
  const all = [
    ...Object.values(EXERCISES).map(e => ({ ...e, ready: true })),
    ...PLANNED.map(e => ({ ...e, ready: false })),
  ];
  const list = activeGroup === 'all' ? all : all.filter(e => e.group === activeGroup);

  root.innerHTML = `
    <div class="fade-in">
      ${slotHtml(CTX.slots, 'wallet')}
      <h1 class="h1">開始訓練</h1>
      ${recCardHtml(EXERCISES[REC_ID])}
      <div class="wk-filters">
        <div class="wk-search">
          <span class="wk-search-ic">${icon('search')}</span>
          <input id="wk-q" class="wk-input" aria-label="搜尋動作" placeholder="搜尋動作（深蹲、開合跳…）" />
        </div>
        <div class="wk-groups">
          ${groups.map(g => `<button class="wk-chip ${g === activeGroup ? 'on' : ''}" data-g="${g}">${groupName(g)}</button>`).join('')}
        </div>
      </div>
      <div class="wk-grid stagger" id="wk-list"></div>
    </div>`;

  syncSlots();
  const listEl = root.querySelector('#wk-list');
  const renderCards = (items) => {
    listEl.innerHTML = items.map(e => cardHtml(e)).join('') ||
      `<p class="sub" style="grid-column:1/-1">找不到符合的動作</p>`;
    listEl.querySelectorAll('[data-id]').forEach(c => {
      c.onclick = () => {
        const ex = EXERCISES[c.dataset.id];
        if (ex) renderIntro(ex); else CTX.toast('此動作開發中，敬請期待');
      };
    });
    listEl.querySelectorAll('[data-soon]').forEach(c => {
      c.onclick = () => CTX.toast('此動作開發中，敬請期待');
    });
    // 合體 Slice 6：卡片是 div（role=button），鍵盤的 Enter／空白鍵要等同點擊（同今日推薦卡）
    listEl.querySelectorAll('.wk2[role="button"]').forEach(c => {
      c.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); c.click(); } };
    });
    startCardAnims();
  };
  renderCards(list);

  root.querySelectorAll('.wk-chip').forEach(b => b.onclick = () => renderMenu(b.dataset.g));
  const q = root.querySelector('#wk-q');
  q.oninput = () => {
    const kw = q.value.trim().toLowerCase();
    const filtered = (activeGroup === 'all' ? all : list).filter(e =>
      !kw || e.name.includes(kw) || e.id.includes(kw));
    renderCards(filtered);
  };

  // 推薦卡：hook 只用 data-rec-id（與型錄卡 [data-id]/.wk2 完全隔離）；innerHTML 後綁定＋null-guard
  const recEl = root.querySelector('[data-rec-id]');
  if (recEl) {
    const goRec = () => { const ex = EXERCISES[recEl.dataset.recId]; if (ex) renderIntro(ex); };
    recEl.onclick = goRec;
    recEl.onkeydown = (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); goRec(); }
    };
  }
}

// 分類色：合體 Slice 3 改用 Motu 色票（只當裝飾填色，不當文字色）
const ACCENT = {
  lower: 'var(--motu-teal)', cardio: 'var(--motu-color-info)', upper: 'var(--motu-coral)',
  core: 'var(--motu-gold)', glute: 'var(--motu-fragment-4)',
};
// Slice2 R1：今日推薦寫死深蹲（Demo 取景最穩、對應今日任務動作）。
// TODO(R3): 接 store 任務欄位——推薦讀今日任務、無任務時退化為預設深蹲；FAB 一併接推薦。
const REC_ID = 'squat';

/* ---------------- 卡片元件（純模板：吃資料回字串，不碰 DOM／事件／store） ---------------- */
// 難度三點 dots。只吃已算好的數字——fallback 語義留在各呼叫端（cardHtml 與 recCardHtml 不同，不得統一）。
function diffDots(d) { return [1, 2, 3].map(i => `<i class="${i <= d ? 'on' : ''}"></i>`).join(''); }
// 獎勵與部位雙徽章；prefix 輸出各卡既有 class。
// 原本第二格顯示「kcal/分」，已移除——熱量由 MET 公式估算，未納入個體代謝差異，
// 亦無心率或攝氧量佐證，屬本系統無法驗證的數字。改顯示訓練部位，資訊更確實也更實用。
// ⚠️ 2026-09-19 修正：原本寫死 `baseCoinPerRep * 10`，等於假設一輪只做 10 下。
//    實際一輪是 3 組（深蹲 3×12=36 下、高抬腿 3×30=90 下），
//    卡片顯示 ≈100／≈50，實際結算 432／540 —— 差 4.3 與 10.8 倍。
//    而且舊寫法完全不吃難度設定，切到困難模式差得更多。
//    改為以該難度的實際課表量 × 結算公式估算，並標示為「整輪上限」。
function estimateRoundCoins(e) {
  const plan = planOf(e);
  const reps = plan.sets * plan.repsPerSet;
  // 上限估計：假設全部有效（targetRate=1）、不計連續天數加成、不計雙倍卡。
  // 取上限而非期望值，是因為期望值要假設一個達標率 —— 那個數字我們沒有依據。
  return coinsFor({ validReps: reps, baseCoinPerRep: e.baseCoinPerRep, targetRate: 1, streakDays: 0 });
}
function rewardBadges(e, p) {
  return `<span class="${p}-coin" title="全部有效時的整輪上限">${icon('coins', { size: 16 })} 最多 ${estimateRoundCoins(e)}</span>
          <span class="${p}-target">${icon('target', { size: 16 })} ${e.meta?.target || '全身'}</span>`;
}
// 依使用者設定的難度換算該動作的訓練量。**所有**顯示與執行都必須經由此函式，
// 否則簡介頁寫「3 組 × 12 下」、實際跑 2 組，使用者會以為系統壞了。
function planOf(ex) { return planFor(ex?.meta, CTX.store.getState().prefs?.difficulty); }
// 課表句（R4 簡介文案一致化的單一來源）。
function planText(meta) { return planLabel(planFor(meta, CTX.store.getState().prefs?.difficulty)); }
// 推薦理由 caption。TODO(R3): 改讀 store 任務欄位（無任務→預設推薦文案）。
function recWhyText() { return `${icon('target', { size: 16 })} 今天練下肢 · 完成今日任務：20 個有效深蹲`; }
// 取景提示：開合跳需腳踝＋橫向空間。（原本深蹲另有「Demo 推薦」標籤，與今日推薦卡重複，已移除）
const SPACE_NOTE = { jumpingjack: `${icon('triangle-alert', { size: 16 })} 需較大空間` };
const TAGLINE = {
  squat: '持續專注於重心平穩', jumpingjack: '燃燒全身脂肪', highknees: '提高瞬發爆發力',
  pushup: '強化胸大肌與核心', lunge: '精準雕塑臀部線條', burpee: '極速燃脂之王',
  situp: '雕塑腹部核心', crunch: '集中訓練上腹', glutebridge: '啟動臀部與後鏈', sidelunge: '強化側向穩定',
};

/* Slice2 R1 今日推薦大卡：純模板函式。金幣估算與 cardHtml 同式（真值以結算為準）。
   合體第二階段 Slice 9：hero 改放 3D 人物 canvas（原本是圖示，深蹲的往下箭頭看起來像下載鍵）。
   推薦卡比例與動作卡不同，startCardAnims 會從共用 renderer 的畫面置中裁切貼上，不為它重設 renderer 尺寸。 */
export function recHeroHtml(id) {
  // 整合版：推薦卡改放島嶼主角（遊戲組元件畫進插槽），不畫我方 3D 人物
  if (CTX?.slots) return `<div class="wk-rec-hero">${slotHtml(CTX.slots, 'hero')}</div>`;
  return `<div class="wk-rec-hero"><canvas class="wk-rec-canvas" data-ex="${id}" data-crop="1" aria-hidden="true"></canvas></div>`;
}
function recCardHtml(e) {
  if (!e) return '';
  const d = e.meta?.difficulty || e.difficulty || 1;
  return `
    <div class="wk-rec card" data-rec-id="${e.id}" role="button" tabindex="0"
      aria-label="今日推薦：${e.name}" style="--accent:${ACCENT[e.group] || 'var(--green)'}">
      ${recHeroHtml(e.id)}
      <div class="wk-rec-body">
        <div class="wk-rec-head">
          <span class="pill wk-rec-badge">今日推薦</span>
          <span class="wk-rec-diff" title="難度 ${d}/3">${diffDots(d)}</span>
        </div>
        <h3 class="wk-rec-name">${e.name}</h3>
        <p class="wk-rec-why">${recWhyText()}</p>
        <p class="wk-rec-plan">${planText(e.meta)}</p>
        <div class="wk-rec-stats">
          ${rewardBadges(e, 'wk-rec')}
          <span class="wk-rec-go">›</span>
        </div>
      </div>
    </div>`;
}

function cardHtml(e) {
  const d = e.meta?.difficulty || e.difficulty || 1;   // Demo 打磨 P1-2 裁決：與 recCardHtml 同鏈（伏地挺身難度 3 曾恆顯 1）
  const grp = GROUPS[e.group] || '';
  const tag = TAGLINE[e.id] || '';
  if (!e.ready) {
    return `
    <div class="wk2 locked" data-soon="1" role="button" tabindex="0" aria-label="${e.name}（即將推出，按下會顯示說明）">
      <div class="wk2-hero"><span class="wk2-lock">${icon('lock', { size: 24 })}</span><span class="wk2-badge soon">規劃中</span></div>
      <div class="wk2-body">
        <div class="wk2-top"><h3 class="wk2-name">${exIcon(e.id)} ${e.name}</h3><span class="wk2-soon">即將推出</span></div>
        <p class="wk2-tag">${grp}${tag ? ' · ' + tag : ''}</p>
        <div class="wk2-stats dim"><span>${icon('coins', { size: 16 })} --</span><span>${icon('flame', { size: 16 })} --</span></div>
      </div>
    </div>`;
  }
  return `
    <div class="wk2" data-id="${e.id}" role="button" tabindex="0" aria-label="${e.name}：查看動作說明" style="--accent:${ACCENT[e.group] || 'var(--green)'}">
      <div class="wk2-hero">
        <canvas class="wk2-canvas" data-ex="${e.id}"></canvas>
        <span class="wk2-badge">${grp}</span>
      </div>
      <div class="wk2-body">
        <div class="wk2-top">
          <h3 class="wk2-name">${e.name}</h3>
          <span class="wk2-diff" title="難度 ${d}/3">${diffDots(d)}</span>
        </div>
        <p class="wk2-tag">${grp}${tag ? ' · ' + tag : ''}${SPACE_NOTE[e.id] ? ' · ' + SPACE_NOTE[e.id] : ''}</p>
        <div class="wk2-stats">
          ${rewardBadges(e, 'wk2')}
          <span class="wk2-go">›</span>
        </div>
      </div>
    </div>`;
}
// 動作圖示：對照 icons.js 的 EMOJI_ICON（原本的 emoji 註記在右側，方便回查）
function exIcon(id, size) {
  const name = {
    squat: 'arrow-down-to-line',   // 🦵
    jumpingjack: 'person-standing', // 🤸
    highknees: 'activity',         // 🏃
    pushup: 'biceps-flexed',       // 💪
    lunge: 'footprints',           // 🚶
    burpee: 'flame',               // 🔥
    situp: 'chevrons-up',          // 🧎
    crunch: 'shrink',              // 🌀
    glutebridge: 'bridge',         // 🌉
    sidelunge: 'move-horizontal',  // ↔
  }[id] || 'dumbbell';             // 🏋
  return icon(name, { size });
}

/* ---------------- 簡介 ---------------- */
function renderIntro(ex) {
  CTX.setChrome(true);
  stopCardAnims();
  const s = CTX.store.getState();
  const warm = s.prefs.warmup;
  root.innerHTML = `
    <div class="fade-in wk-intro">
      <button class="wk-back" id="wk-back">‹ 返回</button>
      <div class="wk-hero card">
        <div id="wk-demo" class="wk-demo3d"></div>
        <div class="wk-hero-badge">${exIcon(ex.id, 16)} ${ex.name}</div>
      </div>
      <h1 class="h1">${ex.name}</h1>
      <p class="sub">${ex.meta.desc}</p>
      <div class="wk-stats stagger">
        ${stat('target', '部位', ex.meta.target)}
        ${stat('repeat', '組數', `${planOf(ex).sets} 組 × ${planOf(ex).repsPerSet} 下`)}
        ${stat('timer', '組間休息', `${planOf(ex).restSec} 秒`)}
        ${stat('coins', '可得金幣', `${ex.baseCoinPerRep} / 有效次 · 整輪最多 ${estimateRoundCoins(ex)}`)}
        ${stat('flame', '強度', `${ex.met} MET`)}
        ${stat('camera', '鏡頭', ex.id === 'pushup' ? '側面' : ex.id === 'jumpingjack' ? '正面 · 需全身入鏡' : '正面')}
      </div>
      <div class="wk-judge card">
        <div class="wk-judge-t">${icon('circle-check')} 判定關鍵</div>
        <div class="wk-judge-d">${judgeText(ex.id)}</div>
      </div>
      <label class="wk-toggle">
        <span>${icon('flame')} 開始前先暖身（約 1 分鐘）</span>
        <input type="checkbox" id="wk-warm" ${warm ? 'checked' : ''}/>
        <i></i>
      </label>
      <div class="wk-cta">
        <button class="btn" id="wk-start" style="flex:1">立即開始</button>
      </div>
    </div>`;

  root.querySelector('#wk-back').onclick = () => renderMenu();
  root.querySelector('#wk-warm').onchange = (e) => CTX.store.updatePrefs({ warmup: e.target.checked });
  root.querySelector('#wk-start').onclick = () => startLive(ex, root.querySelector('#wk-warm').checked);
  animDemo(ex.id, root.querySelector('#wk-demo'));
}
function stat(ic, k, v) { return `<div class="wk-stat card"><div class="k">${icon(ic, { size: 16 })} ${k}</div><div class="v">${v}</div></div>`; }
function judgeText(id) {
  return {
    squat: '髖部需低於膝蓋高度、起身回穩；排除只彎腰、半蹲。',
    jumpingjack: '雙手過肩且雙腳張開超過肩寬；排除只揮手或只張腳。',
    highknees: '大腿抬到接近水平（與鉛直約 55°）、左右交替；排除坐著抬腿、不交替。',
    pushup: '手肘下壓達標、身體保持一直線；排除半程、塌腰。',
  }[id] || '';
}

// —— 示範動畫的「物理節奏」——
// 真實動作不是對稱等速：離心（下降）慢而受控 → 底部短暫停頓 → 向心（起身/推起）爆發較快 → 頂部休息。
// 開合跳/高抬腿則是快節奏彈性動作。回傳 {d, side} 供卡片與簡介動畫共用。
const MOTION = {
  squat: { T: 2100, down: 0.44, hold: 0.10, up: 0.28 },     // 其餘 0.18 為頂部休息
  pushup: { T: 2000, down: 0.42, hold: 0.10, up: 0.26 },
  jumpingjack: { T: 1000, down: 0.40, hold: 0.06, up: 0.38 }, // down=展開、up=收回
  highknees: { T: 800, down: 0.46, hold: 0.04, up: 0.42 },
};
const easeIO = (t) => t * t * (3 - 2 * t);       // 平滑進出（離心受控）
const easeOut = (t) => 1 - (1 - t) * (1 - t);    // 快出慢收（向心爆發）
function demoMotion(id, now, t0) {
  const m = MOTION[id] || MOTION.squat;
  const cyc = Math.floor((now - t0) / m.T);
  const ph = ((((now - t0) % m.T) + m.T) % m.T) / m.T;
  let d;
  if (ph < m.down) d = easeIO(ph / m.down);
  else if (ph < m.down + m.hold) d = 1;
  else if (ph < m.down + m.hold + m.up) d = 1 - easeOut((ph - m.down - m.hold) / m.up);
  else d = 0;                                    // 頂部休息
  return { d, side: cyc % 2 === 0 ? 'L' : 'R' };
}

function animDemo(id, el) {
  if (!el) return;
  cancelAnimationFrame(demoRaf);
  disposeIntroAv();
  introAv = createAvatar3D(el);              // 真 3D 模型（光影 + 每動作專屬視角）
  introAv.setView(EX_VIEW[id]);
  const t0 = performance.now();
  const loop = (now) => {
    const { d, side } = demoMotion(id, now, t0);
    introAv?.render(pose3d(id, d, side));
    demoRaf = requestAnimationFrame(loop);
  };
  demoRaf = requestAnimationFrame(loop);
}

/**
 * 置中裁切（object-fit: cover）：從 srcW×srcH 的畫面取出與 dstW×dstH 同比例、最大的置中區塊。
 * 回傳 drawImage 的來源矩形 [sx, sy, sw, sh]；任一邊為 0 時回傳 null（畫面還沒排版好，這一幀不畫）。
 */
export function coverCrop(srcW, srcH, dstW, dstH) {
  if (!(srcW > 0 && srcH > 0 && dstW > 0 && dstH > 0)) return null;
  const scale = Math.min(srcW / dstW, srcH / dstH);
  const sw = dstW * scale, sh = dstH * scale;
  return [(srcW - sw) / 2, (srcH - sh) / 2, sw, sh];
}

/* 訓練清單卡片：每張用 Q 版人偶循環示範該動作。用世代計數停掉舊動畫。
   Slice 9：推薦卡（data-crop）也走同一個迴圈，但不參與 renderer 尺寸 —— 沿用動作卡的尺寸，畫完置中裁切。 */
let cardGen = 0;
function stopCardAnims() { cardGen++; }
function startCardAnims() {
  const gen = ++cardGen;
  // 推薦卡排在最後：它不改 renderer 尺寸，要等動作卡先把尺寸定下來
  const canvases = [...root.querySelectorAll('canvas.wk2-canvas[data-ex]'), ...root.querySelectorAll('canvas.wk-rec-canvas[data-ex]')];
  const items = canvases.map((cv) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = cv.getBoundingClientRect();
    cv.width = Math.max(180, Math.round((rect.width || 240) * dpr));
    cv.height = Math.max(120, Math.round((rect.height || 132) * dpr));
    return { cv, ctx: cv.getContext('2d'), id: cv.dataset.ex, crop: cv.dataset.crop === '1', t0: performance.now() + Math.random() * 900 };
  });
  if (!items.length) return;
  // 所有卡片共用一個離屏 3D renderer（blit 到各卡 2D canvas）：一個 GL context 服務全部卡片
  if (!cardAv) cardAv = createAvatar3D(null, { headless: true });
  let curW = 0, curH = 0;
  const loop = (now) => {
    if (gen !== cardGen) return;               // 已被新一輪取代 → 自我終止
    for (const it of items) {
      // 推薦卡只有在清單裡完全沒有動作卡時（例如篩選後為空）才決定 renderer 尺寸
      if ((!it.crop || !curW) && (it.cv.width !== curW || it.cv.height !== curH)) { curW = it.cv.width; curH = it.cv.height; cardAv.setSize(curW, curH); }
      const { d, side } = demoMotion(it.id, now, it.t0);   // 物理節奏：離心慢/停頓/向心快
      cardAv.setView(EX_VIEW[it.id]);
      cardAv.render(pose3d(it.id, d, side));
      it.ctx.clearRect(0, 0, it.cv.width, it.cv.height);
      if (!it.crop) { it.ctx.drawImage(cardAv.canvas, 0, 0, it.cv.width, it.cv.height); continue; }
      const src = coverCrop(cardAv.canvas.width, cardAv.canvas.height, it.cv.width, it.cv.height);   // 以 renderer 實際像素為準
      if (src) it.ctx.drawImage(cardAv.canvas, ...src, 0, 0, it.cv.width, it.cv.height);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/* ---------------- 即時偵測 ---------------- */
async function startLive(ex, doWarmup) {
  cancelAnimationFrame(demoRaf);
  disposeIntroAv();
  stopCardAnims();
  ensureAudio();               // 趁點擊手勢解鎖音訊
  CTX.setChrome(false);
  root.innerHTML = liveShell(ex);
  syncSlots();
  emitPhase('ready', null, ex);
  const canvas = root.querySelector('#lv-canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = root.querySelector('#lv-status');
  // Coach HUD 元素快取（每幀更新，避免重複 querySelector）
  const hud = {
    track: root.querySelector('#lv-track'),
    stages: [...root.querySelectorAll('#lv-stages span')],
    gfill: root.querySelector('#lv-gfill'),
    flash: root.querySelector('#lv-repflash'),
    next: root.querySelector('#lv-next'),      // 即時動作指引（Bug2(b)）
  };
  // 達標線：直接標在深度量表上，使用者知道「要做到哪裡」。
  // ⚠️ 必須畫在「品質 gate 的位置」，不是相位門檻 targetEnter 的位置 ——
  //    深蹲的兩者原本不一致（targetEnter 0.62 vs gate 0.667），中間是死區：
  //    深度條過了白線，這一下卻被判半程。2026-09-19 改由 gate 導出。
  root.querySelector('#lv-gtarget').style.bottom = (gaugeTargetOf(ex) * 100) + '%';

  live = {
    ex, ctx, canvas, raf: null, pose: null, cam: null, demo: null, hud,
    detector: createDetector(ex),
    paused: false, startTs: 0, elapsedMs: 0, lastResult: null, mode: 'camera',
    voice: CTX.store.getState().prefs.voice, bgm: CTX.store.getState().prefs.bgm,
    finished: false, started: false,
    // Slice3 R3：組數狀態機（進迴圈時由 initSetState 建立）＋統一時鐘＋跳過休息旗標
    set: null, lastFrameTs: 0, skipRest: false,
    // Slice3 修復：gate 逃生旗標＋F3 誠實回饋進度資料
    skipGate: false, lastValidAt: 0, lastMoveAt: 0,
  };
  const run = live;            // 本次訓練 token：每個 await 後確認仍是同一場，避免舊流程污染新訓練
  bindLiveControls();

  const video = root.querySelector('#lv-video');
  // 階段一：相機
  try {
    statusEl.innerHTML = `<div class="lv-loading">${icon('camera', { size: 24 })} 啟動相機中…<br><span>瀏覽器跳出詢問時請按「允許」</span></div>`;
    const cam = await startCamera({ video, width: 1280, height: 960 });   // 4:3：垂直視野較大，全身較易入鏡
    if (live !== run) { cam.stop(); return; }   // 等待期間已離開/重開 → 關掉 stream 退出
    live.cam = cam;
    bindZoom(cam);
  } catch (e) {
    if (live !== run) return;                   // 頁面已換 → 不要把錯誤 UI 寫到新畫面
    console.warn('camera failed', e);
    return offerDemo(ex, statusEl, e);
  }
  // 階段二：AI 模型
  try {
    statusEl.innerHTML = `<div class="lv-loading">${icon('brain', { size: 24 })} 載入 AI 模型中…</div>`;
    const pose = await createPose({ model: 'full', assetRoot: CTX.assetRoot });   // 整合版由宿主注入 /vendor
    if (live !== run) { try { pose.close(); } catch { } run.cam?.stop(); return; }   // 已過期 → 釋放模型與相機,避免 GPU/相機洩漏
    live.pose = pose;
  } catch (e) {
    if (live !== run) return;
    console.warn('model failed', e);
    return offerDemo(ex, statusEl, { name: 'ModelError', message: e?.message });
  }
  statusEl.innerHTML = '';
  resizeCanvas();
  if (doWarmup) await runWarmup(run);
  if (live !== run) return;
  const ready = await preStart(statusEl, run);   // 說明 + 3、2、1、開始
  if (live !== run || !ready) return;
  runCameraLoop(run);
}

// 開始前：顯示＋朗讀動作說明，再做 3、2、1 倒數，給使用者明確「開始」訊號。
async function preStart(statusEl, run) {
  const ex = run.ex;
  statusEl.innerHTML = `
    <div class="lv-prestart">
      <div class="lv-ps-name">${exIcon(ex.id)} ${ex.name}</div>
      <p>${ex.meta.voiceIntro || ex.meta.desc}</p>
      <div class="lv-ps-tip">請站到鏡頭中、全身入鏡，準備開始</div>
    </div>`;
  if (run.voice && ex.meta.voiceIntro) CTX.coach.say(ex.meta.voiceIntro, 'mid');
  await sleep(2600);             // 讓使用者讀說明、就定位
  if (live !== run) return false;
  // Slice3 R3 取景關卡（僅 camera 路徑；demo 合成幀永遠可見故跳過——已申報）
  if (run.mode !== 'demo' && run.pose) {
    statusEl.innerHTML = '';
    const g = await waitForFraming(run);
    if (live !== run || !g.ok) return false;   // gate 後、倒數前的二次 token 檢查（檢查點 #9）
  }
  return await runCountdown(statusEl, run);
}

/* Slice3 R3 取景就緒判定（呈現層純函式：只讀 spec 欄位與 landmark 可見度，不碰 engine/detector） */
// Slice3 校準 P1：取景骨架全段用青藍 frame 色（與訓練 res.segments 紅黃綠語意分離；不改 drawSkeleton 訓練預設）。
// Slice3 實機修復 F1：landmark 索引 → 人話部位群（檢查燈與缺件語音同源，不再固定三列）。
const LM_GROUP = [
  { label: '肩膀', idx: [11, 12] },
  { label: '手臂', idx: [13, 14, 15, 16] },
  { label: '髖部', idx: [23, 24] },
  { label: '膝蓋', idx: [25, 26] },
  { label: '腳踝', idx: [27, 28] },
];
// Bug1(a)：頭部從來不在任何 spec 的 gate 裡 → 抓不到頭也照樣放行。頭部改為所有動作的必檢列。
// any:true —— 鼻或任一耳看得到即可（側面伏地挺身只看得到一隻耳朵）。
const HEAD_GROUP = { label: '頭部', idx: HEAD_LANDMARKS, any: true };
// 依 spec 實際要求的 gate 索引，動態產出「需要檢查的部位群」（只保留 spec 有涵蓋的群）。
function gateGroups(spec) {
  const need = new Set(spec.gateLandmarks || spec.requiredLandmarks || []);
  const paired = new Set((spec.gatePairs || []).flat());
  const groups = LM_GROUP.filter(g => g.idx.some(i => need.has(i)))
    // 成對關節（側面拍攝時遠側被擋住）→ 該列改成「至少一側看得見」就亮燈，與引擎判定一致
    .map(g => (g.idx.every(i => paired.has(i)) ? { ...g, any: true } : { ...g }));
  return [{ ...HEAD_GROUP }, ...(groups.length ? groups : LM_GROUP.slice(0, 3))];   // 保底：無 spec 時退肩/臂/髖
}
// 取景就緒判定（呈現層純函式：不碰 engine/detector）。門檻對齊引擎 visMin=0.4（互審：gate 不得嚴於實際判定）。
// 判定改用 framing.js 的 landmarkOk —— 除了可見度，還要求座標「真的在畫面內」。
// 這是 Bug1 的關鍵：MediaPipe 對出框的點會外插座標並仍給不低的 visibility，只看可見度會放行太近的取景。
function framingReady(lm, groups) {
  if (!lm) return { rows: groups.map(() => false), all: false };
  const ok = (i) => landmarkOk(lm[i], 0.4);
  const rows = groups.map(g => g.any ? (g._need || g.idx).some(ok) : (g._need || g.idx).every(ok));
  return { rows, all: rows.every(Boolean) };
}

/* Slice3 R3 取景關卡等待（實機修復 F1 增強）。契約（互審 #1）：Promise 必定 settle——
   全綠連續 2000ms → {ok:true}；token 失效 / 跳過 → {ok}。
   看得見（骨架 dim 疊圖）＋缺件同源（燈與語音讀同一組 spec 群）＋語音引導＋10 秒逃生鈕（永不軟鎖）。
   paused 幀不累積且歸零。每幀頂部即 run-token 檢查點 #8；nudge 掛此 tick（gate 階段語音卡死也救得到）。 */
function waitForFraming(run) {
  return new Promise((resolve) => {
    const gate = root?.querySelector('#lv-gate');
    const video = root?.querySelector('#lv-video');
    if (!gate || !video) return resolve({ ok: true });   // 版型缺失不擋流程（保守放行）
    const groups = gateGroups(run.ex);
    groups.forEach(g => { g._need = g.idx.filter(i => (run.ex.gateLandmarks || run.ex.requiredLandmarks || []).includes(i)); if (!g._need.length) g._need = g.idx; });
    // Bug1/Bug2(a)：多一列「距離穩定」——位置與距離抓好、軀幹尺度不再跳動，才開始辨識。
    const labels = [...groups.map(g => g.label), '距離穩定'];
    const stability = createStabilityTracker();
    // 開始前的關卡刻意比逐幀判定嚴：這時人是靜態就位的，頭部本來就該看得到，
    // 而且 needsHeadroom（跳躍留白）只有在站姿量才有意義 —— 逐幀量會把每個跳躍最高點都判失敗。
    const framingOpts = {
      gateLandmarks: run.ex.gateLandmarks || run.ex.requiredLandmarks || [],
      gatePairs: run.ex.gatePairs || [],
      requireHead: true,
      needsHeadroom: !!run.ex.needsHeadroom,
    };
    // 依 spec 動態填充檢查燈（R1 靜態三列僅預設殼）
    const checksWrap = gate.querySelector('.lv-gate-checks');
    if (checksWrap) checksWrap.innerHTML = labels.map(l => `<li class="lv-gate-chk">${l}</li>`).join('');
    const checks = [...gate.querySelectorAll('.lv-gate-chk')];
    const skip = gate.querySelector('.lv-gate-skip');
    const alt = gate.querySelector('.lv-gate-alt');            // Slice 12：跳過鈕連同說明文字一起現身
    const bar = gate.querySelector('.lv-gate-bar i');          // Slice 12：「保持 2 秒」的進度
    if (alt) alt.hidden = true;
    if (bar) bar.style.width = '0%';
    if (skip) skip.onclick = () => { if (live !== run) return; run.skipGate = true; };
    gate.hidden = false;
    if (live?.hud?.next) { live.hud.next.hidden = true; live.hud.next.textContent = ''; }   // 關卡期間不顯示動作指引，避免疊字
    run.skipGate = false;
    if (run.voice) CTX.coach.say('請站進畫面中，讓我看到全身', 'high');
    let readyMs = 0, gateMs = 0, last = performance.now();
    // Slice 12：取景期間深度量表沒有意義，還會在小螢幕蓋到狀態卡 → 關卡期間隱藏
    const wrap = root?.querySelector('#lv-wrap');
    wrap?.classList.add('is-gating');
    const done = (ok) => { try { gate.hidden = true; wrap?.classList.remove('is-gating'); } catch { } resolve({ ok }); };
    const tick = (now) => {
      if (live !== run) return done(false);   // 檢查點 #8
      if (run.skipGate) return done(true);    // 逃生口：只由本 tick 消費（互審 #3）
      CTX.coach.nudge(Date.now());            // 語音 watchdog 覆蓋 gate（互審 #5）
      const dt = now - last; last = now;
      if (!run.paused) {
        gateMs += dt;
        const lm = run.pose.detect(video, now);
        // 骨架 dim 疊圖：讓使用者立刻看到「AI 看得到我」（不引入 detector/update）
        live.ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);
        if (lm) {
          const r = containRect(video, live.canvas.width, live.canvas.height);
          live.ctx.save(); live.ctx.translate(r.x, r.y);
          drawSkeleton(live.ctx, lm, ALL_FRAME, { w: r.w, h: r.h, mirror: CTX.store.getState().prefs.mirror });   // 青藍取景骨架（非訓練綠）
          live.ctx.restore();
        }
        const st = framingReady(lm, groups);
        // 位置/距離判定（與 engine 同一份 framingReport）＋ 軀幹尺度穩定度
        const report = framingReport(lm, framingOpts);
        const stab = stability.push(lm);
        // 光線：每 15 幀量一次就夠（照明不會逐幀變），避免每幀都做一次 getImageData
        if ((run.lightTick = (run.lightTick || 0) + 1) % 15 === 1) {
          run.light = lightingReport(sampleVideoLuma(video));
          // 機位粗估只在站姿時有意義，取景關卡正是站著不動的時候
          if (lm) run.camHint = cameraHeightHint(lm);
        }
        const settled = report.ok && stab.stable;
        const rows = [...st.rows, settled];
        const allOk = rows.every(Boolean);
        checks.forEach((el, i) => el.classList.toggle('ok', rows[i]));   // 勾選符號由 CSS 畫，文字只放部位名
        if (live.hud) {
          const miss = groups.filter((g, i) => !st.rows[i]).map(g => g.label);
          // 取景專屬 state（不沿用訓練共用的 ok/seek/warn）：frame-ok 青／frame-adjust 橘／frame-wait 灰
          live.hud.track.dataset.s = allOk ? 'frame-ok' : (lm ? 'frame-adjust' : 'frame-wait');
          // 訊息優先序：完全沒人 → 缺件 → 距離/取景問題（太近/留白不足）→ 軀幹還在跳 → 已就位
          // 訊息優先序刻意這樣排：光線不足會讓後面每一項都量不準，先講它沒有意義 ——
          // 但「完全看不到人」時要先講找不到人，否則使用者只會困惑「我人就在這裡」。
          const people = run.pose.peopleCount || 0;
          const [ic, msg] = !lm ? (run.light && !run.light.ok ? ['lightbulb', run.light.text] : ['search', '尋找人體…'])
            : run.light && run.light.level === 'dark' ? ['lightbulb', run.light.text]
              : miss.length ? ['search', `看不到：${miss.join('、')}`]
                : !report.ok ? ['ruler', report.text]
                  : !stab.stable ? ['hourglass', '請站穩不動，正在鎖定您的位置…']
                    : people > 1 ? ['map-pin', `已就位（畫面中有 ${people} 人，已鎖定最靠近鏡頭的您）`]
                      : (run.camHint && run.camHint.high) ? ['ruler-dimension-line', run.camHint.text]
                        : ['map-pin', '已就位，準備開始'];
          setTrack(live.hud.track, ic, msg);
          // 語音只講「怎麼改」，且以最高優先的那一項為準（不要三種問題輪播疊在一起）
          if (run.voice && !allOk && lm) {
            if (miss.length) CTX.coach.say(`看不到你的${miss[0]}，請調整位置`, 'mid');
            else if (!report.ok && report.text) CTX.coach.say(report.text, 'mid');
          }
        }
        readyMs = allOk ? readyMs + dt : 0;
        if (bar) bar.style.width = Math.min(100, readyMs / 20) + '%';
        if (readyMs >= 2000) return done(true);
        if (alt && alt.hidden && gateMs >= 10000) alt.hidden = false;   // 逃生鈕 10 秒現身
      } else { readyMs = 0; if (bar) bar.style.width = '0%'; }   // 暫停凍結且歸零
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function runCountdown(statusEl, run) {
  for (const n of [3, 2, 1]) {
    if (live !== run) return false;
    statusEl.innerHTML = `<div class="lv-count">${n}</div>`;
    beep(620, 0.12);
    await sleep(680);
  }
  if (live !== run) return false;
  statusEl.innerHTML = `<div class="lv-count go">開始！</div>`;
  beep(880, 0.24, 0.24);
  if (run.voice) CTX.coach.say('開始', 'high');
  await sleep(620);
  if (live !== run) return false;
  if (statusEl) statusEl.innerHTML = '';
  return true;
}

function cameraErrorMsg(err) {
  const n = err && err.name || '';
  switch (n) {
    case 'SecurityError':
      return '相機被瀏覽器封鎖：目前不是<b>安全連線</b>。<br>請改用 <b>http://localhost:8080</b> 開啟（不要用 IP 位址、或直接雙擊開檔）。';
    case 'NotAllowedError': case 'PermissionDeniedError':
      return '<b>相機權限被拒</b>。<br>請點網址列左側的鎖頭／相機圖示，把相機改成「允許」，再按下方重試。<br>（Mac 也請確認「系統設定 → 隱私權與安全性 → 相機」已開放給瀏覽器）';
    case 'NotFoundError': case 'DevicesNotFoundError': case 'OverconstrainedError':
      return '<b>找不到可用的相機</b>，請確認鏡頭已連接且未被停用。';
    case 'NotReadableError': case 'TrackStartError':
      return '<b>相機正被其他程式使用中</b>（如視訊會議、相機 App），請關閉後重試。';
    case 'NotSupportedError':
      return '此瀏覽器不支援相機功能，建議改用最新版 <b>Chrome</b> 或 <b>Safari</b>。';
    case 'ModelError':
      return 'AI 模型載入失敗，請重新整理頁面再試一次。';
    default:
      return '相機啟動失敗（' + (err && (err.message || err.name) || '未知原因') + '）。可先用示範模式體驗。';
  }
}

/* ---------------- Live 版型元件（Slice3 R2：純模板，吃資料回字串；接線歸 R3） ---------------- */
// 取景檢查關卡（R3 接 gateLandmarks 後由 framingReady 驅動檢查燈；R2 為 R1 靜態內容原樣）
function gateHtml() {
  // Slice 12：原本「提示字」「檢查項」「跳過鈕」都是同一種白色膠囊，使用者分不出哪個是狀態、哪個要按。
  // 改成一張狀態卡：上半是狀態（檢查清單＋2 秒進度條，都不可按），分隔線下才是唯一的操作（附後果說明的次要文字鈕）。
  return `<div class="lv-gate" id="lv-gate" hidden>
        <div class="lv-gate-inner">
          <div class="lv-gate-t">${icon('eye', { size: 24 })} 站進畫面中，讓 AI 看見你</div>
          <div class="lv-gate-frame"></div>
          <div class="lv-gate-panel" role="status">
            <ul class="lv-gate-checks" aria-label="取景檢查">
              <li class="lv-gate-chk ok">肩膀</li>
              <li class="lv-gate-chk ok">髖部</li>
              <li class="lv-gate-chk">膝蓋</li>
            </ul>
            <div class="lv-gate-s">全部打勾並站穩 2 秒，就會<b>自動開始</b></div>
            <div class="lv-gate-bar" aria-hidden="true"><i></i></div>
            <div class="lv-gate-alt" hidden>
              <span>偵測一直過不了？</span>
              <button class="lv-gate-skip" type="button">跳過檢查，直接開始</button>
              <small>跳過後計次可能不準</small>
            </div>
          </div>
        </div>
      </div>`;
}
// 組間休息卡（R3 以真資料呼叫：組序＋ planText(meta) 同源的次數/休息秒；totalSets 供 R3 備用）
function restHtml({ setIdx, totalSets, restSec, nextReps }) {
  return `<div class="lv-rest" id="lv-rest" hidden>
        <div class="lv-rest-card">
          <div class="lv-rest-t">${icon('biceps-flexed', { size: 24 })} 第 ${setIdx} 組完成</div>
          <div class="lv-rest-ring"><b>${restSec}</b><span>秒</span></div>
          <div class="lv-rest-next">下一組：第 ${setIdx + 1} 組 · ${nextReps} 下</div>
          <div class="lv-rest-s">深呼吸，放鬆一下</div>
          <button class="btn secondary lv-rest-skip" type="button">跳過休息</button>
        </div>
      </div>`;
}

function liveShell(ex) {
  return `
    <div class="lv-wrap${CTX.slots ? ' lv-fx' : ''}" id="lv-wrap">
      ${slotHtml(CTX.slots, 'backdrop')}
      <video id="lv-video" playsinline muted></video>
      <canvas id="lv-canvas"></canvas>
      <div class="lv-top">
        <!-- Slice 11：左上角收成一張資訊卡（原本結束鈕、動作名、追蹤狀態、四個階段燈各自一顆膠囊，擠在一起又全像按鈕）
             第一列＝唯一可按的「結束」＋動作名／模式；虛線下＝系統狀態；最下＝動作週期步驟條（指示器，不可按） -->
        <div class="lv-head">
          <div class="lv-head-row">
            <button class="lv-exit" id="lv-exit" type="button" aria-label="結束訓練">‹ 結束</button>
            <div class="lv-head-name"><span class="lv-title">${ex.name}</span><span class="lv-mode" id="lv-modebadge"></span></div>
          </div>
          <div class="lv-head-body">
            <span class="lv-track" id="lv-track" data-s="seek">${trackHtml('search', '尋找人體…')}</span>
            <div class="lv-stages" id="lv-stages" role="img" aria-label="動作週期：起始、進行、達標、回復，完整走完才計次">
              <span>起始</span><i aria-hidden="true"></i><span>進行</span><i aria-hidden="true"></i><span>達標</span><i aria-hidden="true"></i><span>回復</span>
            </div>
          </div>
        </div>
      </div>
      <div class="lv-zoom" id="lv-zoom" hidden>
        <span class="lv-zoom-ic" title="拉到最左＝最廣（全身入鏡）">${icon('search', { size: 16 })}</span>
        <input type="range" id="lv-zoom-range" aria-label="視野縮放（最左＝最廣，全身入鏡）" />
        <span class="lv-zoom-lbl">廣</span>
      </div>
      <div class="lv-gauge">
        <div class="lv-gauge-track"><i id="lv-gfill"></i><b id="lv-gtarget"></b></div>
        <span>深度</span>
      </div>
      ${slotHtml(CTX.slots, 'companion')}
      <!-- Slice 8：動作指引與教練提示（含「找不到人」）收進同一欄。舊版此欄 display: contents，兩者照舊各自定位；
           整合版由下往上堆疊在控制鈕上方，提示折行變高時指引自動上推，手機再讓出左側阿肌、右側深度量表 -->
      <div class="lv-prompts">
        <div class="lv-next" id="lv-next" hidden></div>
        <div class="lv-coach" id="lv-coach"></div>
      </div>
      <div class="lv-repflash" id="lv-repflash"></div>
      <div class="lv-status" id="lv-status"></div>
      <!-- Slice3 R1 靜態版型（預設 hidden、零邏輯；gate 判定/組數切換歸 R3 接線輪） -->
      ${gateHtml()}
      ${restHtml({ setIdx: 1, totalSets: 3, restSec: 45, nextReps: 12 })}
      <div class="lv-hud">
        <div class="lv-metric"><div class="m-v" id="m-reps">0</div><div class="m-k">有效次數</div></div>
        <div class="lv-metric"><div class="m-v" id="m-time">0:00</div><div class="m-k">時間</div></div>
        <div class="lv-metric"><div class="m-v" id="m-rate">—</div><div class="m-k">達標率</div></div>
        <div class="lv-metric lv-cdmetric">
          <div class="m-v" id="m-cd" hidden>${planOf(ex).restSec}</div><div class="m-k" hidden>倒數</div>
          <div class="m-v lv-set-progress">0/${planOf(ex).repsPerSet}</div><div class="m-k lv-set-label">本組次數</div>
        </div>
      </div>
      <div class="lv-ctrls">
        <button class="lv-btn" id="lv-voice" type="button"></button>
        <button class="lv-btn" id="lv-bgm" type="button"></button>
        <button class="lv-btn lv-pause" id="lv-pause" type="button">${pauseHtml(false)}</button>
      </div>
    </div>`;
}

/** 深度量表上「達標線」該畫的位置（0..1 的 progress）。
 *  有品質 gate 的動作以 gate 為準；其餘動作沒有獨立的 gate，退回相位門檻。
 *  ⚠️ 新增動作若也有「達到相位但仍可能被 gate 擋下」的設計，必須在此登記，
 *     否則畫面會再度對使用者說謊。 */
export function gaugeTargetOf(ex) {
  if (ex?.id === 'squat') return SQUAT_GATE_PROGRESS;
  return ex?.thresholds?.targetEnter ?? 1;
}

function resizeCanvas() {
  const wrap = root.querySelector('#lv-wrap'); if (!wrap || !live) return;
  live.canvas.width = wrap.clientWidth; live.canvas.height = wrap.clientHeight;
}

// 視野縮放滑桿：直接控制相機變焦（拉左＝最廣、全身入鏡）。相機不支援變焦則不顯示。
function bindZoom(cam) {
  const wrap = root.querySelector('#lv-zoom');
  const range = root.querySelector('#lv-zoom-range');
  if (!wrap || !range) return;
  if (!cam || !cam.zoom || !cam.track) { wrap.hidden = true; return; }
  const { min, max, step } = cam.zoom;
  range.min = min; range.max = max; range.step = step; range.value = min;   // 預設最廣
  wrap.hidden = false;
  range.oninput = async () => {
    try { await cam.track.applyConstraints({ advanced: [{ zoom: Number(range.value) }] }); } catch { /* 忽略 */ }
  };
}

function bindLiveControls() {
  root.querySelector('#lv-exit').onclick = () => finishLive();
  root.querySelector('#lv-pause').onclick = (e) => {
    live.paused = !live.paused;
    e.currentTarget.innerHTML = pauseHtml(live.paused);   // 按鈕內有 SVG：e.target 可能是圖示，必須用 currentTarget
    if (!live.paused) live.lastFrameTs = performance.now();   // Slice3 R3 申報：累加制時鐘下 resume 重設 lastFrameTs（原 startTs 平移語義失效）
  };
  root.querySelector('#lv-voice').onclick = (e) => {
    live.voice = !live.voice; CTX.coach.setEnabled(live.voice);
    if (!live.voice) CTX.coach.stop();
    setVoiceBtn(e.currentTarget, live.voice);
    CTX.toast(live.voice ? '語音已開啟' : '語音已靜音');
  };
  root.querySelector('#lv-bgm').onclick = (e) => {
    live.bgm = !live.bgm; toggleBgm(live.bgm);
    setBgmBtn(e.currentTarget, live.bgm);
    CTX.toast(live.bgm ? '背景音樂開啟' : '背景音樂關閉');
  };
  // 初始按鈕狀態反映目前設定
  setVoiceBtn(root.querySelector('#lv-voice'), live.voice);
  setBgmBtn(root.querySelector('#lv-bgm'), live.bgm);
  if (live.bgm) toggleBgm(true);
  window.addEventListener('resize', resizeCanvas);
}

async function runWarmup(run) {
  const statusEl = root.querySelector('#lv-status');
  const coachEl = root.querySelector('#lv-coach');
  coachEl.textContent = '暖身：原地踏步、活動關節';
  CTX.coach.say('開始暖身，原地踏步活動一下關節', 'mid');
  statusEl.innerHTML = `
    <div class="lv-loading lv-warmup">${icon('person-standing', { size: 24 })} 暖身：原地踏步、活動關節<br>
      <span id="lv-warm-cd">暖身倒數 10 秒</span>
      <div class="lv-demo-actions"><button class="btn secondary" id="lv-skipwarm">跳過暖身 ›</button></div>
    </div>`;
  await new Promise((resolve) => {
    let s = 10, done = false, timer = null;
    const finish = () => { if (done) return; done = true; if (timer) clearInterval(timer); resolve(); };
    statusEl.querySelector('#lv-skipwarm')?.addEventListener('click', finish);
    const cd = statusEl.querySelector('#lv-warm-cd');
    timer = setInterval(() => {
      s--;
      if (live !== run) return finish();
      if (cd) cd.textContent = `暖身倒數 ${s} 秒`;
      if (s <= 0) finish();
    }, 1000);
  });
  statusEl.innerHTML = ''; coachEl.textContent = '';
}

// 影片以 object-fit:contain 顯示時，計算它在畫布內實際佔的矩形（置中、留黑邊）。
function containRect(video, cw, ch) {
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale, h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/* ---------------- Slice3 R3 組數狀態機（六-補：次數為主／90s 安全網／倒數環雙語意） ---------------- */
// 建立組狀態＋統一時鐘起點。時鐘契約：每幀無條件 dt=now−lastFrameTs 貼緊；僅 WORK && !paused 把 dt 累進 elapsedMs。
function initSetState(run) {
  // 與簡介頁同一個 planOf，兩處數字必然一致
  const m = planOf(run.ex);
  run.set = { idx: 1, total: m.sets, target: m.repsPerSet, baseValid: 0, lastValid: 0, setEndValid: 0, phase: 'WORK', workMs: 0, restMs: 0, restSec: m.restSec, cue3: false, cue1: false };
  run.lastFrameTs = performance.now();
  run.skipRest = false;
  setCdMode('count');
  emitPhase('work', run.set, run.ex);
}
// 倒數欄雙態成對切換（R1 版型：時間態=#m-cd+倒數標籤／次數態=lv-set-progress+lv-set-label，互斥）
function setCdMode(mode) {
  const cell = root?.querySelector('.lv-cdmetric'); if (!cell) return;
  const timeEls = [cell.querySelector('#m-cd'), cell.querySelector('.m-k:not(.lv-set-label)')];
  const countEls = [cell.querySelector('.lv-set-progress'), cell.querySelector('.lv-set-label')];
  timeEls.forEach((el) => { if (el) el.hidden = mode !== 'time'; });
  countEls.forEach((el) => { if (el) el.hidden = mode !== 'count'; });
}
// WORK → REST：snapshot setEndValid（互審 #2——不依賴當幀 res）；休息卡以真資料重繪（restHtml/planText 同源）
function enterRest(run) {
  const set = run.set;
  set.phase = 'REST'; set.restMs = 0; set.setEndValid = set.lastValid;
  run.skipRest = false; run.warn10 = false; run.lastBeepSec = null;   // 每相位 cue 重置
  const rest = root.querySelector('#lv-rest');
  if (rest) {
    rest.outerHTML = restHtml({ setIdx: set.idx, totalSets: set.total, restSec: set.restSec, nextReps: set.target });
    const el = root.querySelector('#lv-rest');
    el.hidden = false;
    // 跳過休息 token 契約（互審 #4）：只設當前 run 的旗標，消費在迴圈內（檢查點 #10）
    el.querySelector('.lv-rest-skip').onclick = () => { if (live !== run) return; run.skipRest = true; };
  }
  setCdMode('time');
  emitPhase('rest', set, run.ex);
  beep(720, 0.16);
  if (run.voice) CTX.coach.say(`第 ${set.idx} 組完成，休息 ${set.restSec} 秒`, 'mid');
}
// REST → WORK：baseValid 固定用 snapshot
function enterWork(run) {
  const set = run.set;
  set.idx += 1; set.phase = 'WORK'; set.workMs = 0;
  set.baseValid = set.setEndValid; set.lastValid = set.setEndValid;
  set.cue3 = false; set.cue1 = false;                                // P2 剩次語音旗標每組重置
  run.skipRest = false; run.warn10 = false; run.lastBeepSec = null;
  const rest = root.querySelector('#lv-rest'); if (rest) rest.hidden = true;
  setCdMode('count');
  emitPhase('work', set, run.ex);
  beep(880, 0.2, 0.24);
  if (run.voice) CTX.coach.say(`第 ${set.idx} 組，開始！`, 'high');
}
// 每幀相位推進（兩迴圈共用）。回傳 'finish' 表示課表完成。
function advanceSetPhase(run, dt) {
  const set = run.set;
  if (set.phase === 'WORK') {
    set.workMs += dt;
    const setValid = set.lastValid - set.baseValid;
    // P2 剩次語音旁路（互審契約）：say 成功才設旗標；失敗下一幀重試、remain 一變即停，永不報錯數字
    const cue = repCountdownCue(set);
    if (cue && run.voice && CTX.coach.say(cue.text, cue.priority)) set[cue.flag] = true;
    if (setValid >= set.target || set.workMs >= SAFETY_SECONDS * 1000) {
      if (set.idx >= set.total) return 'finish';
      enterRest(run);
    }
  } else {
    set.restMs += dt;
    const remain = Math.max(0, set.restSec * 1000 - set.restMs);
    const b = root.querySelector('#lv-rest .lv-rest-ring b'); if (b) b.textContent = Math.ceil(remain / 1000);
    if (remain <= 0 || run.skipRest) enterWork(run);
  }
  return null;
}

function runCameraLoop(run) {
  live.mode = 'camera';
  live.started = true;             // 已進入計數階段：之後結束才結算入帳
  root.querySelector('#lv-modebadge').textContent = '● 即時偵測';
  initSetState(run);
  const video = root.querySelector('#lv-video');
  const mirror = CTX.store.getState().prefs.mirror;
  const loop = () => {
    if (live !== run) return;
    const now = performance.now();
    const dt = now - live.lastFrameTs; live.lastFrameTs = now;   // 時鐘契約：無條件貼緊（含 paused/REST 幀）
    CTX.coach.nudge(Date.now());   // Slice3 修復 F2：語音卡死 watchdog（每幀）
    if (!live.paused) {
      if (live.set.phase === 'WORK') {
        live.elapsedMs += dt;      // 累計 WORK 時間＝durationSec 來源（不含休息）
        const lm = live.pose.detect(video, now);
        live.ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);
        if (lm) {
          const res = live.detector.update(lm, now);
          live.lastResult = res;
          live.set.lastValid = res.reps.valid;
          // 對齊 contain 後的相機矩形：骨架疊在「實際顯示的影像」上，不被黑邊拉歪
          const r = containRect(video, live.canvas.width, live.canvas.height);
          live.ctx.save(); live.ctx.translate(r.x, r.y);
          // 顏色語意：藍=取景/準備；做動作時直接用各關節的錯誤程度（綠/黃/紅），見 ui/display-colors.js
          drawSkeleton(live.ctx, lm, displaySegments(res, live.ex), { w: r.w, h: r.h, mirror });
          live.ctx.restore();
          handleResult(res, now, lm);
        } else {
          setCoach('找不到人，請站到鏡頭中、保持全身入鏡', 'mid');
          if (live.hud) {
            live.hud.track.dataset.s = 'seek'; setTrack(live.hud.track, 'search', '尋找人體…');
            // 人不在畫面時清掉動作字卡，否則會停在上一句（例如「到位了！收回來」）與「找不到人」打架
            if (live.hud.next) { live.hud.next.hidden = true; live.hud.next.textContent = ''; }
          }
        }
      } else {
        live.ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);   // REST：清畫布防環殘影
      }
      drawRingAndHud();
      if (advanceSetPhase(run, dt) === 'finish') return finishLive();
    }
    live.raf = requestAnimationFrame(loop);
  };
  live.raf = requestAnimationFrame(loop);
}

function offerDemo(ex, statusEl, err) {
  try { live?.cam?.stop(); } catch { }
  if (live) live.cam = null;
  statusEl.innerHTML = `
    <div class="lv-demo-prompt">
      <span class="wk-ic-disc">${icon('camera', { size: 24 })}</span>
      <p>${cameraErrorMsg(err)}</p>
      <div class="lv-demo-actions">
        <button class="btn" id="lv-retry">${icon('refresh-cw')} 重新嘗試相機</button>
        <button class="btn secondary" id="lv-demo-go">${icon('play')} 改用示範模式</button>
      </div>
    </div>`;
  root.querySelector('#lv-demo-go').onclick = () => { statusEl.innerHTML = ''; runDemoLoop(ex); };
  root.querySelector('#lv-retry').onclick = () => {
    const warm = CTX.store.getState().prefs.warmup;
    live = null;                 // 讓 startLive 重建
    startLive(ex, warm);
  };
}

// 示範模式：用合成序列（含偶發作弊）餵入同一引擎，眼見為憑。
async function runDemoLoop(ex) {
  const run = live;                // 本次訓練 token（同 startLive）
  live.mode = 'demo';
  root.querySelector('#lv-modebadge').textContent = '● 示範模式';
  root.querySelector('#lv-video').style.display = 'none';
  const ready = await preStart(root.querySelector('#lv-status'), run);   // 說明 + 3、2、1
  if (live !== run || !ready) return;
  live.started = true;             // 已進入計數階段：之後結束才結算入帳
  resizeCanvas();
  // 3D 人偶舞台（插在 2D canvas 之下：倒數環/HUD 仍畫在上層）
  const wrap = root.querySelector('#lv-wrap');
  const stage = document.createElement('div');
  stage.className = 'lv-avatar3d';
  wrap.insertBefore(stage, root.querySelector('#lv-canvas'));
  live.avatarEl = stage;
  live.avatar = createAvatar3D(stage);
  live.avatar.setView(EX_VIEW[ex.id]);   // 每動作專屬視角（伏地挺身=側面）
  live.avatar.resize();
  // 組合序列：clean ×4 + 一次作弊 + clean ×4 …
  const cheat = { squat: 'half', jumpingjack: 'armsonly', highknees: 'sitting', pushup: 'sag' }[ex.id] || 'half';
  const build = () => {
    const a = makeSequence(ex.id, { reps: 4, variant: 'clean', framesPerRep: 26 });
    const b = makeSequence(ex.id, { reps: 1, variant: cheat, framesPerRep: 26 });
    return { frames: a.frames.concat(b.frames), meta: a.meta.concat(b.meta) };
  };
  // 時間驅動 + 追補：playback 速度與 rAF 幀率脫鉤，引擎拿到確定性合成時間戳，
  // 故不論瀏覽器是否節流 rAF（背景分頁等），計次都與測試一致。
  const FRAME_MS = 33;            // 合成幀間隔（~30fps）
  ({ frames: live.frames, meta: live.meta } = build());
  live.fed = 0;                   // 已餵入引擎的合成幀數
  initSetState(run);
  const loop = () => {
    if (live !== run) return;
    const now = performance.now();
    const dt = now - live.lastFrameTs; live.lastFrameTs = now;   // 時鐘契約：無條件貼緊（含 paused/REST 幀）
    CTX.coach.nudge(Date.now());   // Slice3 修復 F2：語音卡死 watchdog（每幀）
    if (!live.paused) {
      if (live.set.phase === 'WORK') {
        live.elapsedMs += dt;      // 累計 WORK 時間；demo 追補 target 派生於此 → 休息/暫停零 catch-up（互審 #3）
        const target = Math.floor(live.elapsedMs / FRAME_MS);
        // 一次追補可能餵好幾幀：每一個「有結算」的幀都要交給 handleResult，
        // 否則只看最後一幀會漏掉中間的 +1／✗（Slice 10）
        let handledLast = false;
        while (live.fed < target) {
          const idx = live.fed % live.frames.length;
          const lm = live.frames[idx];
          const res = live.detector.update(lm, live.fed * FRAME_MS); // 確定性時間戳
          live.lastResult = res;
          live.set.lastValid = res.reps.valid;
          handledLast = res.repCountedThisFrame;
          if (res.repCountedThisFrame) handleResult(res, now, lm);
          live.fed++;
          if (live.fed % live.frames.length === 0) ({ frames: live.frames, meta: live.meta } = build()); // 每輪換一批（含作弊）
        }
        const idx = ((live.fed - 1) % live.frames.length + live.frames.length) % live.frames.length;
        const lm = live.frames[idx];
        const m = live.meta[idx];
        live.ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);
        live.avatar.render(pose3d(ex.id, m.d, m.side));   // 3D 公仔以「真 3D 編排姿勢」重現同一時間軸
        // 這一幀沒有新的結算要處理時，只刷新 HUD：拿掉結算旗標再交出去 ——
        // 60fps 下約每兩個 rAF 才餵一幀合成資料，直接重交 lastResult 會把同一下再閃一次、再嗶一次
        if (live.lastResult && !handledLast) handleResult({ ...live.lastResult, repCountedThisFrame: false, repValidThisFrame: false }, now, lm);
      } else {
        live.ctx.clearRect(0, 0, live.canvas.width, live.canvas.height);   // REST：不餵幀、清畫布防環殘影（公仔停格）
      }
      drawRingAndHud();
      if (advanceSetPhase(run, dt) === 'finish') return finishLive();
    }
    live.raf = requestAnimationFrame(loop);
  };
  live.raf = requestAnimationFrame(loop);
}

/* 合體 Slice 4：HUD 的圖示＋文字。追蹤膠囊每幀更新，內容沒變就不重寫 DOM（避免每幀 innerHTML）。
   文字可能含引擎產生的字串，一律跳脫後再放進 innerHTML。 */
const escHtml = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function trackHtml(ic, text) { return `${icon(ic, { size: 16 })}<span>${escHtml(text)}</span>`; }
function setTrack(el, ic, text) {
  if (!el) return;
  const key = ic + '|' + text;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  el.innerHTML = trackHtml(ic, text);
}
function pauseHtml(paused) { return paused ? `${icon('play', { size: 18 })} 繼續` : `${icon('pause', { size: 18 })} 暫停`; }
// 只有圖示的按鈕：名稱放在 aria-label，狀態放在 aria-pressed（原本靠 emoji 當可讀名稱）
function setVoiceBtn(b, on) {
  if (!b) return;
  b.innerHTML = icon(on ? 'volume-2' : 'volume-x', { size: 20 });
  b.setAttribute('aria-label', on ? '語音提示：開啟' : '語音提示：關閉');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('muted', !on);
}
function setBgmBtn(b, on) {
  if (!b) return;
  b.innerHTML = icon(on ? 'music' : 'volume-1', { size: 20 });
  b.setAttribute('aria-label', on ? '背景音樂：開啟' : '背景音樂：關閉');
  b.setAttribute('aria-pressed', String(on));
  b.classList.toggle('muted', !on);
}

function setCoach(text, p) {
  const el = root.querySelector('#lv-coach'); if (!el) return;
  el.textContent = text; if (p) el.dataset.p = p;
}

// 沒有錯誤時輪播的正向回饋（節流），讓畫面隨時都有「該怎麼做」的訊息。
const GOOD_TIPS = ['很好，保持這個節奏', '動作很標準，繼續！', '核心收緊、呼吸放鬆', '很棒，再多幾下！'];
let _tipIdx = 0, _tipTs = 0;
function positiveTip(now) {
  if (now - _tipTs > 3000) { _tipTs = now; _tipIdx = (_tipIdx + 1) % GOOD_TIPS.length; }
  return GOOD_TIPS[_tipIdx];
}

const STAGE_OF = { READY: 0, CONCENTRIC: 1, TARGET: 2, ECCENTRIC: 3 };  // 企劃 2.3：起始→發力→達標→回復

// 追蹤膠囊的短標籤（長句留給下方教練字幕，膠囊只給一眼看懂的原因）
// 合體 Slice 4：emoji 改成 Lucide 圖示名稱，由 setTrack() 組成圖示＋文字
const TRACK_LABEL = {
  too_close: ['triangle-alert', '太近了，請後退'],
  no_head: ['triangle-alert', '看不到頭部'],
  no_headroom: ['triangle-alert', '頭頂空間不足'],
  no_footroom: ['triangle-alert', '腳快出畫面了'],
  turned_away: ['triangle-alert', '請正對鏡頭'],
  too_far: ['triangle-alert', '太遠了，請往前'],
  missing: ['triangle-alert', '入鏡不完整'],
  no_pose: ['search', '尋找人體…'],
};

function handleResult(res, now, lm) {
  const hud = live.hud;

  // —— Coach HUD：把引擎每幀的內部狀態翻譯給使用者 ——
  if (hud) {
    // 1) 追蹤狀態膠囊（永遠可見：使用者隨時知道「系統看不看得到我」）
    //    看不到人時直接講「為什麼」（太近／看不到頭／缺哪個部位），不再只寫「入鏡不完整」。
    if (res.visible === false) {
      hud.track.dataset.s = 'warn';
      setTrack(hud.track, ...(TRACK_LABEL[res.framing?.issue] || TRACK_LABEL.missing));
    } else {
      hud.track.dataset.s = 'ok'; setTrack(hud.track, 'activity', '追蹤中 · 33 點');
    }
    // 2) 動作週期燈：READY→發力→達標→回復（Slice3 補修：準備態不亮綠，只在真正做動作時亮）
    const st = (res.visible !== false && !framingPose(res)) ? STAGE_OF[res.phase] : undefined;
    hud.stages.forEach((el, i) => el.classList.toggle('on', i === st));
    // 3) 深度量表：訊號即時填充 + 四段色（藍準備 → 黃進行中 → 綠達標 → 紅錯誤）
    const gpct = Math.round(Math.max(0, Math.min(1, res.signal)) * 100);
    hud.gfill.style.height = gpct + '%';
    hud.gfill.classList.toggle('empty', gpct === 0);   // Slice 9：0% 時描邊會縮成一顆深藍點，交給 CSS 拿掉
    hud.gfill.dataset.c = gaugeColor(res, live.ex);
    // 3b) 即時動作指引：告訴使用者「現在該做什麼」（Bug2(b)）
    if (hud.next) {
      const t = phaseCueText(res, live.ex);
      hud.next.textContent = t;
      hud.next.dataset.p = res.visible === false ? 'off' : (res.phase === 'TARGET' ? 'hit' : 'go');
      hud.next.hidden = !t;
    }
    // 4) 計次即時判定：✓ +1 / ✗ 原因 / −1 撤銷
    const fl = repFlash(res, live.shownValid);
    if (fl) popRepFlash(hud.flash, fl);
  }
  // 撤銷偵測要看「上一幀畫面上的有效次數」，不論 HUD 在不在都要更新
  const revoked = live.shownValid != null && res.reps.valid < live.shownValid;
  live.shownValid = res.reps.valid;
  emitLive(CTX.events, liveRepEvents(res, live.set));

  // —— 教練訊息（語音 + 字幕）——
  if (res.visible === false) {
    setCoach(res.cue?.text || '請站到鏡頭中、保持全身入鏡', 'mid');
    return;
  }
  // 這一下被判無效 → 立刻講「為什麼、怎麼改」，並且直接 return，
  // 不能讓下面的稱讚/指導把它蓋掉（否則會出現「剛判你無效」又說「很好，保持節奏」）。
  if (res.repCountedThisFrame && !res.repValidThisFrame) {
    const msg = revoked ? REVOKE_HINT : rejectHint(res.repReason, live.ex);
    setCoach('✗ ' + msg, 'high');
    if (live.voice) CTX.coach.say(msg, 'high', Date.now());
    return;
  }
  // Slice3 修復 F3：追蹤進度資料（誠實回饋用）
  if (res.repCountedThisFrame && res.repValidThisFrame) live.lastValidAt = Date.now();
  if (res.visible !== false && res.signal >= (live.ex.thresholds.attemptEnter ?? 0.3)) live.lastMoveAt = Date.now();

  if (res.cue) {
    if (live.voice) CTX.coach.cue(res.cue, Date.now());   // 修正口令（時基統一 epoch——F2-1）
    setCoach(res.cue.text, res.cue.priority);
  } else {
    // F3：用純函式決策「稱讚 vs 指導」，避免沒計次卻誇「動作很標準」
    const nowMs = Date.now();
    const secsSinceValid = (nowMs - (live.lastValidAt || 0)) / 1000;
    const movingButNotTarget = (nowMs - (live.lastMoveAt || 0)) < 12000;
    const pol = coachPolicy({ visible: res.visible !== false, hasCue: false, secsSinceValid, movingButNotTarget });
    if (pol.kind === 'guide') { setCoach(pol.text, 'mid'); if (live.voice) CTX.coach.say(pol.text, 'mid', nowMs); }
    else if (pol.kind === 'framing') {
      const hint = lm && live.mode === 'camera' ? framingHint(lm, live.ex) : null;
      setCoach(hint || positiveTip(now), hint ? 'mid' : 'good');
      if (hint && live.voice) CTX.coach.say(hint, 'mid', nowMs);
    } else {   // praise
      setCoach(positiveTip(now), 'good');
    }
  }
  if (res.repCountedThisFrame && res.repValidThisFrame) { flashRep(); positiveRepFeedback(); }
}

/* 計次閃字（Slice 10）。
   repFlash：純函式，決定這一幀要閃什麼。prevValid＝上一幀畫面上的有效次數。
   高抬腿的防作弊規則：同一隻腳連抬兩下，引擎會把「上一下」也作廢（有效次數 −1）。
   以前畫面只閃「✗ 未左右交替」，數字卻悄悄少 1，使用者看到的就是「次數有時會自己減少」。
   現在明講「−1」和原因。 */
const REVOKE_HINT = '上一下不算：左右腳要輪流抬';
export function repFlash(res, prevValid) {
  if (!res || !res.repCountedThisFrame) return null;
  if (res.repValidThisFrame) return { kind: 'ok', text: '✓ +1' };
  const valid = res.reps?.valid;
  if (prevValid != null && valid != null && valid < prevValid) return { kind: 'bad', text: '−1 左右腳要輪流' };
  // 用引擎給的 repReason，不是當下這一幀的 faults —— 一下在回到起始位置時才結算，
  // 那時瞬間發生的錯誤已經消失，讀當幀會退回顯示「半程未達標」而報錯原因。
  return { kind: 'bad', text: '✗ ' + faultName(res.repReason || 'half_rep') };
}
// 重播閃字動畫：一定要先拿掉 pop、強制 reflow、再加回去。
// 舊寫法直接覆寫 className —— 連續兩下都有效時 class 字串完全相同，瀏覽器不會重播動畫，
// 而動畫是 forwards 停在 opacity 0，於是第二下之後的「+1」就看不到（「+1 有時出現有時不會」的根因）。
export function popRepFlash(el, { kind, text }) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('pop', 'ok', 'bad');
  void el.offsetWidth;
  el.classList.add(kind, 'pop');
}

// Demo 前最小補強：一次有效動作成立時的正向回饋（短音效＋輪播語音）。
// 只在「有效計次成立瞬間」由 handleResult 呼叫；1.8 秒冷卻避免連續狂播。不碰計次/判定/門檻。
let _lastRepFbAt = 0, _repFbIdx = 0;
const REP_PRAISE = ['做得好', '這一下有效', '姿勢正確', '很好，繼續'];
// Bug2(c)：開合跳/高抬腿一下不到 1 秒，稱讚語還沒講完下一下就來了 —— 使用者只聽到一片糊。
// 快節奏動作改以「短音效 + 畫面字卡」為主要回饋通道，語音只留修正口令與剩次提示。
const isFastTempo = () => live?.ex?.meta?.tempo === 'fast';
function positiveRepFeedback() {
  const now = Date.now();
  if (now - _lastRepFbAt < 1800) return;   // 冷卻：1.8 秒內不重複
  _lastRepFbAt = now;
  beep(880, 0.09, 0.18); beep(1180, 0.11, 0.18);   // 兩顆上行短音（成功感）
  if (live?.voice && !isFastTempo()) {
    _repFbIdx = (_repFbIdx + 1) % REP_PRAISE.length;
    CTX.coach.say(REP_PRAISE[_repFbIdx], 'low', now);   // 低優先，不搶修正口令通道
  }
}

// 取景建議：改用與 engine 同一份 framingReport（舊版自己算 bbox 高度、門檻 0.97 形同虛設，
// 而且水平姿勢的伏地挺身永遠會被誤判「太遠」）。取景良好則回 null。
// 逐幀不帶 needsHeadroom —— 與 engine 保持同一套規則（留白是開始前的前置條件，見 engine.js）。
function framingHint(lm, ex) {
  const r = framingReport(lm, {
    gateLandmarks: ex.gateLandmarks || ex.requiredLandmarks || [],
    gatePairs: ex.gatePairs || [],
    requireHead: ex.requireHead !== false,
  });
  return r.ok ? null : r.text;
}

// Slice3 R3 倒數環雙語意（六-補）：WORK=本組次數進度環（teal 漸進）／REST=休息倒數環（隨時間消退）。
function drawRingAndHud() {
  const set = live.set;
  const s = live.detector.summary();
  if (set.phase === 'WORK') {
    const setValid = Math.max(0, set.lastValid - set.baseValid);
    drawProgressRing(live.ctx, setValid / set.target, { w: live.canvas.width, h: live.canvas.height, lineWidth: 8 });
    const sp = root.querySelector('.lv-set-progress'); if (sp) sp.textContent = `${setValid}/${set.target}`;
    checkEndingCues(Math.max(0, SAFETY_SECONDS * 1000 - set.workMs));   // 安全網提示（cue 旗標於相位轉換時重置）
  } else {
    const remain = Math.max(0, set.restSec * 1000 - set.restMs);
    drawCountdownRing(live.ctx, remain / (set.restSec * 1000), { w: live.canvas.width, h: live.canvas.height, color: COLOR.green, lineWidth: 8 });
    setText('m-cd', Math.ceil(remain / 1000));
    checkEndingCues(remain);
  }
  setText('m-reps', s.validReps);
  setText('m-time', fmtTime(live.elapsedMs / 1000));
  // 即時達標率：訓練當下最該讓使用者知道的是「我做的算不算數」，而非估算的熱量。
  // 尚未有任何一次結算前顯示「—」，避免 0/0 顯示成 0% 造成誤解。
  const attempts = s.validReps + s.invalidReps;
  setText('m-rate', attempts ? Math.round(s.validReps / attempts * 100) + '%' : '—');
}

// 接近結束時提醒：最後 10 秒語音＋提示、最後 3 秒每秒嗶聲、倒數欄轉紅。
function checkEndingCues(remainMs) {
  const r = remainMs / 1000;
  const cd = root.querySelector('#m-cd'); if (cd) cd.classList.toggle('low', r <= 10);
  if (!live.warn10 && r <= 10 && r > 3) {
    live.warn10 = true;
    if (live.voice) CTX.coach.say('最後十秒，加油！', 'high');
    CTX.toast('最後 10 秒，全力衝刺！');
  }
  const sec = Math.ceil(r);
  if (sec >= 1 && sec <= 3 && live.lastBeepSec !== sec) { live.lastBeepSec = sec; beep(660, 0.1); }
}

function flashRep() {
  const el = root.querySelector('#m-reps');
  if (!el) return;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
}

/* ---------------- 結算 ---------------- */
function finishLive() {
  if (!live || live.finished) return;
  // 還沒真正開始計數（卡在啟動相機／暖身／倒數／示範提示就退出）→ 不結算、不記紀錄
  if (!live.started) { stopLive(); CTX.setChrome(true); renderMenu(); return; }
  live.finished = true;
  const ex = live.ex;
  const wasVoice = live.voice;
  const mode = live.mode;   // stopLive 會清掉 live，先記下計次方式（只有 camera 會發獎）
  const summary = live.detector.summary();
  const durationSec = Math.max(1, live.elapsedMs / 1000);
  emitPhase('end', live.set, ex);
  stopLive();

  const session = CTX.store.commitSession({
    exercise: ex.id, exerciseName: ex.name, durationSec,
    validReps: summary.validReps, invalidReps: summary.invalidReps,
    met: ex.met, baseCoinPerRep: ex.baseCoinPerRep, faultCounts: summary.faultCounts,
    advisoryCounts: summary.advisoryCounts,
  }, { grantCoins: !CTX.game?.settle });   // 整合版：金幣經驗由遊戲端發，本端只記訓練統計
  const toResult = () => {
    renderResult(ex, summary, session);
    if (wasVoice) CTX.coach.say('這組完成，做得很好！', 'high');
  };
  // 整合版：遊戲端發獎 → 逐項領獎（玩家按下任意鍵後才 resolve）→ 結算頁
  if (CTX.game) {
    claimRewards(CTX.game, session, mode).then(toResult, (e) => { console.error(e); toResult(); });
  } else toResult();
}

/* ---------------- 結算（Slice 13：一頁看懂） ----------------
   以前是兩頁：六格數字平鋪的結算頁 →「領取獎勵 ›」→ 獎勵頁。問題：
   ① 六格一樣大，看不出重點；② 中間一個大「C」沒有任何說明；③「領取獎勵」暗示金幣還沒拿到，
      但 store 早在 finishLive 就入帳了。
   現在一頁由上而下回答三個問題：做得怎麼樣（有效次數＋達標率＋評等說明）→ 拿到什麼（金幣／經驗／島嶼進度）
   → 下次怎麼更好（沒算到的原因）。版型語言沿用遊戲組商店頁：青色方形圖示標頭、白卡、虛線分隔、金幣膠囊。 */
const GRADE_INFO = {
  S: { name: '完美', min: 90 },
  A: { name: '很棒', min: 75 },
  B: { name: '不錯', min: 60 },
  C: { name: '再加油', min: 0 },
};
const GRADE_ORDER = ['C', 'B', 'A', 'S'];
/** 評等的白話說明（純函式）。評等只由達標率決定（見 core/rewards.js grade 與 store.commitSession），
 *  所以直接講「達標率多少 → 哪一級、到多少可以升級」。 */
export function gradeInfo(grade, validReps, invalidReps) {
  const g = GRADE_INFO[grade] ? grade : 'C';
  const total = (validReps || 0) + (invalidReps || 0);
  // 用無條件捨去：評等門檻是「≥」，四捨五入會出現「顯示 75% 卻是 B」。
  // 先乘 100 再除：v/t*100 會有浮點誤差（0.29*100 = 28.999…），捨去後少 1%
  const rate = total ? Math.floor(validReps * 100 / total) : null;
  const next = GRADE_ORDER[GRADE_ORDER.indexOf(g) + 1];
  let hint;
  if (rate == null) hint = '這次沒有偵測到完整的動作';
  else if (!next) hint = '最高評等！每一下幾乎都做到位';
  else hint = `達標率到 ${GRADE_INFO[next].min}% 就是 ${next} 級`;
  return { grade: g, name: GRADE_INFO[g].name, rate, hint };
}

/** 達標率圓環（SVG）。rate 為 null 時畫空環、中間顯示「—」。 */
function rateRing(rate) {
  const R = 52, C = 2 * Math.PI * R;
  const k = rate == null ? 0 : Math.max(0, Math.min(100, rate)) / 100;
  return `<div class="wk-sum-ring" role="img" aria-label="達標率 ${rate == null ? '無資料' : rate + '%'}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${R}" class="bg"/>
        <circle cx="60" cy="60" r="${R}" class="fg" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${(C * (1 - k)).toFixed(1)}"/>
      </svg>
      <div class="wk-sum-ring-v"><b>${rate == null ? '—' : rate + '<small>%</small>'}</b><span>達標率</span></div>
    </div>`;
}

/* 整合版結算左側的延伸數據（Slice 1 骨架：版位先出來，Slice 11 接上真實數值） */
function sumMoreHtml(session) {
  const cell = (ic, k, v) => `<div class="wk-sum-more-c">${icon(ic, { size: 16 })}<span>${k}</span><b>${v}</b></div>`;
  return `<div class="wk-sum-more" aria-label="更多數據">
    ${cell('timer', '總時間', fmtTime(session.durationSec))}
    ${cell('repeat', '各組次數', '—')}
    ${cell('award', '最佳一組', '—')}
    ${cell('triangle-alert', '失誤分布', '—')}
  </div>`;
}
function renderResult(ex, summary, session) {
  CTX.setChrome(true);
  rwClear();
  const s = CTX.store.getState();
  const gi = gradeInfo(session.grade, summary.validReps, summary.invalidReps);
  const total = summary.validReps + summary.invalidReps;
  const faults = Object.entries(session.faults || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
  // advisory：不影響有效次數，但值得提醒的姿勢問題。與「沒算到的原因」分開呈現 ——
  // 混在一起會讓使用者以為這些是被扣次數的原因。
  const advisories = Object.entries(summary.advisoryCounts || {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const xp = CTX.store.derived.xpProgress();
  const ratio = Math.max(0, Math.min(1, xp.ratio || 0));   // clamp 防異常值破版
  const xpGain = session.xpGain ?? session.validReps * 5;   // ?? 僅為舊存檔的 history 相容
  const empty = session.coinsEarned === 0;
  // 這次訓練「之前」的金幣：store 已 commit，所以要往回推才知道進度條該從哪裡長起來。
  const prevCoins = Math.max(0, s.wallet.coins - session.coinsEarned);
  const goal = nextGoal(s);
  const cost = goal.kind === 'save' ? goal.item.cost : 0;
  const pctOf = (c) => (cost > 0 ? Math.max(0, Math.min(100, Math.round(c / cost * 100))) : 100);
  const row = ([f, n]) => `<li><span>${faultName(f)}</span><span class="wk-sum-n">${n} 次</span></li>`;

  root.innerHTML = `
    <div class="fade-in wk-sum stagger">
      <header class="card wk-sum-head">
        <span class="wk-sum-badge">${icon(total ? 'party-popper' : 'biceps-flexed', { size: 28 })}</span>
        <div class="wk-sum-title">
          <h1>${total ? '訓練完成！' : '這次沒有完成動作'}</h1>
          <p>${ex.name} · ${fmtTime(session.durationSec)}</p>
        </div>
        ${total ? `<div class="wk-sum-grade" data-g="${gi.grade}" title="評等由達標率決定">
          <span class="wk-sum-grade-k">評等</span>
          <b>${gi.grade}</b>
          <span class="wk-sum-grade-n">${gi.name}</span>
        </div>` : ''}
      </header>

      <section class="card wk-sum-hero" aria-label="這次的表現">
        ${rateRing(gi.rate)}
        <div class="wk-sum-main">
          <div class="wk-sum-big"><b id="wk-sum-valid">${summary.validReps}</b> 下有效</div>
          <div class="wk-sum-sub">共做 ${total} 下 · ${summary.invalidReps} 下沒算到</div>
          <p class="wk-sum-hint">${icon('target', { size: 16 })} ${gi.hint}</p>
        </div>
        ${CTX.game ? sumMoreHtml(session) : ''}
      </section>
      ${CTX.game ? '' : `
      <section class="card wk-sum-reward" aria-label="獲得獎勵">
        <div class="wk-sum-sec-t">這次拿到</div>
        <div class="wk-sum-gains">
          <div class="wk-sum-gain coin${empty ? ' zero' : ''}">
            <span class="ico">${icon('coins', { size: 24, label: '金幣' })}</span>
            <div><b class="wk-rw-coins">+<span id="wk-rw-num">0</span></b><span>金幣${session.coinBoostApplied ? '（雙倍卡）' : ''}</span></div>
          </div>
          <div class="wk-sum-gain xp">
            <span class="ico">${icon('star', { size: 24 })}</span>
            <div><b>+${xpGain}</b><span>經驗 · Lv.${s.wallet.level}</span></div>
          </div>
        </div>
        <div class="wk-sum-xpbar" role="img" aria-label="升級進度 ${Math.round(ratio * 100)}%"><i style="width:${Math.round(ratio * 100)}%"></i></div>
        <div class="wk-sum-xp-s">再 ${Math.max(0, xp.need - xp.cur)} XP 升到 Lv.${s.wallet.level + 1}</div>
        ${gameResourceCard(session)}
        <div class="wk-rw-island" id="wk-rw-island">
          <div>${empty ? `${icon('house', { size: 16 })} 已建 <b>${s.island.placed.length}</b> 棟 · 只有有效動作才換得到金幣` : rewardIslandLine(s)}</div>
          ${!empty && cost > 0 ? `
          <div class="wk-rw-goalbar" role="img" aria-label="距下一個目標的存款進度">
            <i id="wk-rw-goalfill" style="width:${pctOf(prevCoins)}%"></i>
          </div>` : ''}
        </div>
      </section>`}

      <section class="card wk-sum-notes" aria-label="下次怎麼更好">
        ${faults.length ? `
        <div class="wk-sum-sec-t">${icon('triangle-alert', { size: 16 })} 沒算到的原因</div>
        <ul class="wk-sum-list">${faults.map(row).join('')}</ul>` : total ? `
        <div class="wk-sum-sec-t good">${icon('award', { size: 16 })} 每一下都算數，沒有被判無效的動作</div>` : `
        <div class="wk-sum-sec-t">${icon('lightbulb', { size: 16 })} 下次請全身入鏡，完整做完一下才會開始計次</div>`}
        ${advisories.length ? `
        <div class="wk-sum-sec-t advis">${icon('lightbulb', { size: 16 })} 可以更好（不影響次數）</div>
        <ul class="wk-sum-list">${advisories.map(row).join('')}</ul>` : ''}
      </section>

      <div class="wk-cta">
        <button class="btn secondary" id="wk-again" style="flex:1">${icon('repeat', { size: 18 })} 再一次</button>
        ${empty
          ? `<button class="btn" id="wk-rw-done" style="flex:1">完成</button>`
          : `<button class="btn" id="wk-rw-go" style="flex:1">${icon('tree-palm', { size: 18 })} 去蓋房子</button>`}
      </div>
      ${empty ? '' : `<button class="wk-sum-link" id="wk-rw-done" type="button">回到動作清單</button>`}
    </div>`;
  root.querySelector('#wk-again').onclick = () => { rwClear(); renderIntro(ex); };
  const go = root.querySelector('#wk-rw-go'); if (go) go.onclick = () => { rwClear(); CTX.navigate('island'); };
  root.querySelector('#wk-rw-done').onclick = () => { rwClear(); renderMenu(); };

  // ── 演出：彩帶 → 金幣滾動 → 飛向島嶼目標 → 進度推進 ──
  // 純表現層：store 早在 finishLive 就 commit 完了，演出只是把「已經發生的事」畫出來。
  const numEl = root.querySelector('#wk-rw-num');
  const islEl = root.querySelector('#wk-rw-island');
  const fillEl = root.querySelector('#wk-rw-goalfill');
  const settle = () => {          // 終態：任何時候被跳過都是走到這裡，畫面與 store 一致
    rwClear();
    if (numEl) numEl.textContent = String(session.coinsEarned);
    if (fillEl) fillEl.style.width = pctOf(s.wallet.coins) + '%';
    document.querySelectorAll('.wk-coin-fly, .wk-confetti').forEach(el => el.remove());
  };
  // 整合版：獎勵已在領獎序列演出並飛進資源列，結算頁不再重演
  if (CTX.game) return;
  if (summary.validReps > 0) launchConfetti();
  if (empty) return;
  if (reducedMotion()) { settle(); return; }
  rwAfter(350, () => countUp(numEl, session.coinsEarned, 900));
  rwAfter(1100, () => flyCoins(root.querySelector('.wk-sum-gain.coin'), islEl, session.coinsEarned, () => {
    if (fillEl) { fillEl.style.width = pctOf(s.wallet.coins) + '%'; }
    if (islEl) { islEl.classList.add('hit'); rwAfter(600, () => islEl.classList.remove('hit')); }
  }));
  // 跳過：整頁任一處按下就直接給終態。演出是禮物不是關卡，不該擋著人操作。
  root.querySelector('.wk-sum')?.addEventListener('pointerdown', settle, { once: true });
}

/* 彩帶（Slice 13）：一次性的 canvas 粒子，約 2.6 秒後自行移除。
   顏色取 Motu 色票（青、金、珊瑚、薄荷、深藍）；尊重減少動態效果（直接不放）；
   pointer-events:none，不擋任何操作。不引入套件。 */
export const CONFETTI_VARS = ['--motu-teal', '--motu-gold', '--motu-coral', '--motu-mint', '--motu-teal-light', '--motu-navy-soft'];
function launchConfetti() {
  if (reducedMotion() || typeof document === 'undefined') return;
  document.querySelectorAll('.wk-confetti').forEach(el => el.remove());
  const cv = document.createElement('canvas');
  cv.className = 'wk-confetti';
  cv.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const g = cv.getContext('2d'); if (!g) { cv.remove(); return; }
  g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = CONFETTI_VARS.map(v => css.getPropertyValue(v).trim()).filter(Boolean);
  if (!colors.length) { cv.remove(); return; }   // 讀不到 Motu 色票就不放（不自創色值）
  // 兩門「禮炮」從左右下角往中間上方噴，比從天而降更有「恭喜」的感覺
  const N = W < 620 ? 90 : 150;
  const parts = Array.from({ length: N }, (_, i) => {
    const left = i % 2 === 0;
    const ang = (left ? -60 : -120) * Math.PI / 180 + (Math.random() - 0.5) * 0.7;
    const sp = (Math.max(H, W * 0.6) * 0.018) * (0.7 + Math.random() * 0.6);   // 寬螢幕噴遠一點，彩帶才會飛到畫面中間
    return {
      x: left ? -10 : W + 10, y: H * 0.72,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      w: 6 + Math.random() * 6, h: 3 + Math.random() * 4,
      r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
      c: colors[i % colors.length], delay: Math.random() * 180,
    };
  });
  const t0 = performance.now(), LIFE = 2600;
  const step = (now) => {
    const t = now - t0;
    g.clearRect(0, 0, W, H);
    const fade = t > LIFE - 600 ? Math.max(0, (LIFE - t) / 600) : 1;
    for (const p of parts) {
      if (t < p.delay) continue;
      p.vy += H * 0.00042; p.vx *= 0.992; p.vy *= 0.992;   // 重力＋空氣阻力
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      g.save(); g.globalAlpha = fade; g.translate(p.x, p.y); g.rotate(p.r);
      g.fillStyle = p.c; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)) + 1);
      g.restore();
    }
    if (t < LIFE && cv.isConnected) rwTimers.push(requestAnimationFrame(step));
    else cv.remove();
  };
  rwTimers.push(requestAnimationFrame(step));
  rwAfter(LIFE + 200, () => cv.remove());   // 保險：分頁在背景時 rAF 不跑，也要清掉
}

/* 第二幕的「遊戲資源」卡：碎片與抽獎券。
   這兩項由遊戲端記帳，健身端只顯示不儲存（08/21 議定），因此：
   —— 只出現在結算畫面，主畫面不常駐；
   —— 兩者皆為 0 時整張卡不渲染。0 與「沒發生」是兩件事，畫一張全 0 的卡只會讓人以為系統壞了。
   視覺權重刻意低於金幣卡與經驗值卡：用 .pill 並列而非大數字、不做 countUp，
   藉此表達「這是遊戲端資產」而不顯得次等（見 TODO_PLAN 的設計顧問輸入）。 */
export function gameResourceCard(session) {
  const shards = session?.shards || 0;
  const tickets = session?.tickets || 0;
  if (shards <= 0 && tickets <= 0) return '';
  // 合體 Slice 5：碎片／抽獎券是「到島嶼遊戲領用」的資源，套遊戲端的可領取脈動
  const pill = (ic, n, label) => `<span class="pill wk-rw-res-pill motu-is-claimable">${icon(ic, { size: 16 })} ${label} <b>+${n}</b></span>`;
  return `
      <div class="card wk-rw-res">
        <div class="wk-rw-res-row">
          ${shards > 0 ? pill('puzzle', shards, '碎片') : ''}
          ${tickets > 0 ? pill('ticket', tickets, '抽獎券') : ''}
        </div>
        <div class="wk-rw-res-s">於島嶼遊戲中使用 · 不會出現在錢包</div>
      </div>`;
}

/* Slice4 R3 第二幕島嶼行：與島嶼目標條共用 nextGoal——同一函式、同一數字。三態文案，皆非死路。 */
// 合體 Slice 3：建築的 emoji（g.item.icon）是島嶼頁的資料，這裡不再顯示，只留名稱；差額數字用深藍、金幣圖示帶金色。
function rewardIslandLine(s) {
  const n = s.island.placed.length;
  const g = nextGoal(s);
  const built = `${icon('house', { size: 16 })} 已建 <b>${n}</b> 棟`;
  if (g.kind === 'save') {
    const cheer = g.gap <= 100 ? `快到了！再練一輪衝刺 ${icon('biceps-flexed', { size: 16 })}` : '';
    return `${built} · 下一個目標：${g.item.name} <b class="wk-rw-gap">差 ${g.gap} ${icon('coins', { size: 16 })}</b>${cheer ? ' · ' + cheer : ''}`;
  }
  if (g.kind === 'unlock') return `${built} · ${g.item.name}：${g.hint}`;
  return `${built} · 島嶼全部解鎖 ${icon('party-popper', { size: 16 })}`;
}

/* D-1 獎勵轉換儀式：金幣滾動 → 飛向島嶼 → 島嶼進度推進 → 落袋音。
   純表現層：store 早在 finishLive 就 commit 完了，這裡一枚金幣都不會多給。
   演出只是把「已經發生的事」畫出來，所以中途離開、跳過、關動畫都不影響帳。 */
let rwTimers = [];                       // setTimeout / rAF 控制代碼，unmount 與跳過時一併清掉
function rwClear() {
  for (const t of rwTimers) { clearTimeout(t); cancelAnimationFrame(t); }
  rwTimers = [];
  // 掛在 body 上的演出元素（飛行金幣、彩帶）一併清掉：計時器一取消它們就不會自己消失了，
  // 切頁、鍵盤按按鈕（不會先觸發 pointerdown → settle）都會走到這裡（Slice 13 審查修正）
  if (typeof document !== 'undefined') document.querySelectorAll('.wk-coin-fly, .wk-confetti').forEach(el => el.remove());
}
const rwAfter = (ms, fn) => { rwTimers.push(setTimeout(fn, ms)); };
// 尊重系統的「減少動態效果」：直接give終態，不做任何位移或滾動。
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/** 數字滾動。ease-out，最後一幀一定落在 to（不靠浮點數湊）。 */
function countUp(el, to, ms = 900) {
  if (!el) return;
  if (reducedMotion() || to <= 0) { el.textContent = String(to); return; }
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = String(Math.round(to * eased));
    if (k < 1) rwTimers.push(requestAnimationFrame(step));
    else el.textContent = String(to);
  };
  rwTimers.push(requestAnimationFrame(step));
}

/** 金幣從起點飛到終點。用固定定位的浮動元素，不動版面、不觸發 reflow。 */
function flyCoins(fromEl, toEl, n, onLand) {
  if (!fromEl || !toEl || reducedMotion()) { onLand?.(); return; }
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width) { onLand?.(); return; }      // 元素還沒排版好就別演，直接給結果
  const count = Math.max(3, Math.min(8, n));
  let landed = 0;
  for (let i = 0; i < count; i++) {
    rwAfter(i * 70, () => {
      const c = document.createElement('span');
      c.className = 'wk-coin-fly'; c.innerHTML = icon('coins', { size: 20 });
      // 起點在金幣數字附近散開，終點收斂到島嶼卡中心 —— 散開再收攏才有「被吸進去」的感覺
      c.style.left = (a.left + a.width * (0.25 + Math.random() * 0.5)) + 'px';
      c.style.top = (a.top + a.height * 0.4) + 'px';
      document.body.appendChild(c);
      requestAnimationFrame(() => {
        c.style.transform = `translate(${b.left + b.width / 2 - a.left - a.width * 0.5}px, ${b.top + b.height / 2 - a.top - a.height * 0.4}px) scale(.55)`;
        c.style.opacity = '0.15';
      });
      rwAfter(560, () => {
        c.remove();
        beep(880 + i * 40, 0.06, 0.10);      // 落袋音，音高遞升
        if (++landed >= count) onLand?.();
      });
    });
  }
}

// 一下被判無效時要說的話：優先用該動作 spec 已寫好的修正口令（每個動作講法不同，
// 例如深蹲的 half_rep 該說「再往下蹲」、伏地挺身該說「胸口往下壓」），沒有才退回通用句。
const REJECT_FALLBACK = {
  half_rep: '沒做到底 —— 要做到達標線才算一下',
  no_alternation: '要左右輪流，同一邊連做不算',
  unseen: '剛才有一段沒看清楚 —— 請保持全身在畫面內',
  form: '深度或姿勢還差一點',
};
function rejectHint(reason, ex) {
  const key = reason || 'half_rep';
  if (key === 'half_rep' && ex?.cues?.deeper?.text) return ex.cues.deeper.text;
  return ex?.cues?.[key]?.text || REJECT_FALLBACK[key] || faultName(key);
}

function faultName(f) {
  return { torso_lean: '彎腰／軀幹前傾', knee_valgus: '膝蓋內夾',
    head_tilt: '頭部歪斜', tempo_fast: '下放太快',
    no_lockout: '推到頂時手臂沒打直', head_forward: '頭頸往前伸',
    half_rep: '動作半程未達標', limb_desync: '手腳不同步',
    no_support: '坐姿／支撐不穩', no_alternation: '未左右交替', sag: '塌腰', form: '深度／姿勢不足',
    unseen: '動作中有一段沒看清楚', not_visible: '不在畫面中' }[f] || f;
}

/* ---------------- 共用 ---------------- */
function stopLive() {
  if (!live) return;
  cancelAnimationFrame(live.raf);
  window.removeEventListener('resize', resizeCanvas);
  try { live.cam?.stop(); } catch { }
  try { live.pose?.close(); } catch { }
  try { live.avatar?.dispose(); live.avatarEl?.remove(); } catch { }
  CTX.coach.stop();
  toggleBgm(false);
  live = null;
}
function setText(id, v) { const e = root.querySelector('#' + id); if (e) e.textContent = v; }
function fmtTime(sec) { const m = Math.floor(sec / 60), s = Math.floor(sec % 60); return `${m}:${String(s).padStart(2, '0')}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
