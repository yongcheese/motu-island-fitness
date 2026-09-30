// 訓練畫面的顏色語意（純函式，可單元測試；不碰 DOM、不碰判定）。
//
// 語意定義（使用者裁定）：
//   藍 (frame) = 取景／動作開始前的準備階段 —— 顏色這時不代表姿勢好壞
//   綠 (green) = 這個關節沒問題
//   黃 (yellow) = 這個關節開始跑掉
//   紅 (red)   = 這個關節明確做錯
//
// 關鍵：黃/紅只代表「關節的錯誤程度」，**不代表「還沒做到位」**。
// 曾經把「未達標」也一律塗黃，結果每一下正常動作全身都會變黃，黃色就失去警示意義了。
// 「做到哪了」由右側深度量表負責（gaugeColor），那才是使用者說的「狀態條」。
import { SEGMENTS } from '../core/landmarks.js';

export const SEG_KEYS = Object.keys(SEGMENTS);
export const ALL_FRAME = Object.fromEntries(SEG_KEYS.map(k => [k, 'frame']));

// 「開始有動作」的顯示門檻。刻意低於引擎的 attemptEnter(0.25~0.30)——用引擎門檻的話，
// 訊號 0 → 0.3 這一大段全是藍的，看起來就像「一直藍、達標才跳綠」。
export const MOVE_SIGNAL = 0.10;

/** 是否為「取景／準備」狀態（此時顏色不代表姿勢品質）。 */
export function framingPose(res) {
  if (!res || res.visible === false) return false;      // 看不到人另有警示，不歸這裡
  return res.phase === 'IDLE' || (res.phase === 'READY' && (res.signal ?? 0) < MOVE_SIGNAL);
}

/** 骨架各段顏色：準備/看不到人 → 全藍；做動作時直接用 spec 的逐關節判定。
 *
 *  `spec.judgedSegments` 有宣告時，**未列出的部位一律 dim**。
 *  為什麼要這樣（實機回報）：使用者做高抬腿時看到自己的手臂被畫成跟腿一樣的綠色，
 *  以為「這個動作居然還要辨識手」，不知道手該怎麼擺。
 *  綠色在本系統的語意是「這個關節沒問題」—— 對一個根本不判定的部位說「沒問題」，
 *  等於暗示它有被評分。dim 才是誠實的表達：這裡沒有在看。
 */
export function displaySegments(res, spec = null) {
  if (!res || res.visible === false || framingPose(res)) return ALL_FRAME;
  const judged = spec?.judgedSegments;
  const out = {};
  for (const k of SEG_KEYS) {
    out[k] = (judged && !judged.includes(k)) ? 'dim' : (res.segments?.[k] || 'green');
  }
  return out;
}

/** 深度量表顏色：這裡才是「進度」語意 —— 藍(準備) → 黃(進行中) → 綠(達標)，有錯誤則紅。
 *  使用者回報「中間完全沒有狀態條的過渡變化」指的就是這條。 */
export function gaugeColor(res, ex) {
  if (!res || res.visible === false || framingPose(res)) return 'frame';
  if (res.color === 'red') return 'red';
  return (res.signal ?? 0) >= (ex?.thresholds?.targetEnter ?? 1) ? 'green' : 'yellow';
}

/** 即時動作指引字卡：依週期相位告訴使用者「現在該做什麼」。
 *  動態動作一下不到一秒，語音根本來不及講完（見 meta.tempo）。 */
export function phaseCueText(res, ex) {
  if (!res || res.visible === false) return '';
  const cues = ex?.phaseCues;
  if (!cues) return '';
  if (framingPose(res)) return cues.READY || '';
  return cues[res.phase] || cues.READY || '';
}

// ── 顯示調色盤（設定頁「顏色顯示模式」）──────────────────────────────
//
// 語意鍵（green/yellow/red/frame/dim）由上面的純函式決定，這裡只負責「畫成什麼顏色」。
// 兩者分離的理由：判定語意不該因為使用者換了配色而改變。
//
// high（高對比）採 Okabe-Ito 色盲友善配色。#0072B2（藍）與 #D55E00（vermilion）
// 取自該八色組；其設計目標即為在三種主要色覺缺陷（deuteran／protan／tritan）下皆可區分。
// 出處：Okabe M. & Ito K., Color Universal Design (CUD), 2008；經 Wong B. (2011),
// "Points of view: Color blindness", Nature Methods 8(6):441, doi:10.1038/nmeth.1618 推廣。
// 為何要換：預設的綠(#27e6a6)↔紅(#ff5d6c) 正是本系統最關鍵的一組語意對立，
// 而綠敏感度缺陷是最常見的色覺缺陷類型，這組對比對部分使用者可能難以分辨。
// ⚠️ 本專案未對真實色覺缺陷使用者做過可用性測試，此處僅依上述配色的設計意圖選色。
export const PALETTES = {
  // dim（不判定的部位）＝取景藍的淡色版：白色會被看成「沒偵測到」（實機回報：深蹲時手臂變白像沒抓到），
  // 淡藍表示「有追蹤到、但這個動作不評分」，又與代表評分的綠／黃／紅明顯區隔。
  tricolor: { green: '#27e6a6', yellow: '#ffd23f', red: '#ff5d6c', frame: '#3aa8ff', dim: 'rgba(58,168,255,.5)' },
  high:     { green: '#0072B2', yellow: '#F0E442', red: '#D55E00', frame: '#56B4E9', dim: 'rgba(86,180,233,.55)' },
  // mono（單色）：不用色相區分，改用亮度與不透明度。給「顏色太多會分心」或在強光下
  // 看不清色差的使用者。錯誤最亮最實，正常最暗最透——讓視線只被「有問題的部位」吸走。
  mono:     { green: 'rgba(255,255,255,.34)', yellow: 'rgba(255,255,255,.72)', red: '#ffffff', frame: 'rgba(255,255,255,.5)', dim: 'rgba(255,255,255,.22)' },
};

export const DEFAULT_COLOR_MODE = 'tricolor';

/** 取調色盤；未知模式一律退回三色，不讓壞掉的偏好值把畫面弄黑。 */
export function paletteFor(mode) {
  return PALETTES[mode] || PALETTES[DEFAULT_COLOR_MODE];
}
