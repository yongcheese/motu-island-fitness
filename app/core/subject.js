// 使用者鎖定（多人在鏡頭前時，決定「哪一個骨架才是正在訓練的人」）。
//
// 為什麼需要它：pose.js 原本設 `numPoses: 1` 並直接取 `landmarks[0]`。
// MediaPipe 在單人模式下只會回傳一個人，但**不保證每一幀都是同一個人** ——
// 有人從背景走過時，偵測目標會在兩人之間跳動，骨架亂飛、計次也跟著亂。
// 實機回報的「多人在鏡頭前跑動時骨架會亂跳」就是這個。
//
// 做法：改為同時偵測多人，再由本模組挑出使用者並**鎖定**。
// 鎖定的核心是遲滯（hysteresis）：一旦選定，就算畫面中出現「看起來更像主角」的人，
// 也不換 —— 只有在鎖定對象連續消失數幀後才重新挑選。
// 沒有遲滯的話，兩個體型相近的人會讓選擇在幀與幀之間反覆翻面，跟原本的問題一樣。
import { LM } from './landmarks.js';

const CORE = [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER, LM.LEFT_HIP, LM.RIGHT_HIP];

/** 軀幹中心、尺度與可信度。回傳 null 表示這個骨架連軀幹都不完整，不列入候選。 */
export function poseFeatures(lm) {
  if (!lm || lm.length < 33) return null;
  let cx = 0, cy = 0, vis = 0, n = 0;
  for (const i of CORE) {
    const p = lm[i];
    if (!p) return null;
    cx += p.x; cy += p.y; vis += p.visibility ?? 1; n++;
  }
  if (n < CORE.length) return null;
  cx /= n; cy /= n; vis /= n;
  const ls = lm[LM.LEFT_SHOULDER], rs = lm[LM.RIGHT_SHOULDER];
  const hc = { x: (lm[LM.LEFT_HIP].x + lm[LM.RIGHT_HIP].x) / 2, y: (lm[LM.LEFT_HIP].y + lm[LM.RIGHT_HIP].y) / 2 };
  const sc = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const shoulder = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const torso = Math.hypot(sc.x - hc.x, sc.y - hc.y);
  // 尺度取肩寬與軀幹長的較大者：側身時肩寬會趨近 0，只用肩寬會把側身的人判成很遠。
  const size = Math.max(shoulder, torso);
  return { cx, cy, vis, size };
}

/**
 * 建立使用者鎖定器。
 *
 * @param {object} o
 *   lostFrames   鎖定對象連續幾幀匹配不上才判定跟丟（預設 8 ≈ 0.27 秒 @30fps）。
 *                太小 → 短暫遮擋就換人；太大 → 使用者真的離開後仍卡在舊目標。
 *   maxJump      容許的位移，以「鎖定對象的尺度」為單位。超過即視為不是同一人。
 *                1.2 表示軀幹中心一幀內跳超過 1.2 個肩寬就不認 —— 真人做不到，換人才做得到。
 *   minVis       候選骨架的軀幹平均可信度下限。
 */
export function createSubjectTracker({ lostFrames = 8, maxJump = 1.2, minVis = 0.5 } = {}) {
  let lock = null;      // { cx, cy, size }
  let missed = 0;

  /** 沒有鎖定對象時的初選分數：近（大）且靠中央者優先。
   *  使用者站在鏡頭正前方，路過的人通常在邊緣且較遠，這兩項就足以分開。 */
  const freshScore = (f) => {
    const offCenter = Math.hypot(f.cx - 0.5, f.cy - 0.5);
    return f.size * (1 - 0.45 * Math.min(1, offCenter / 0.5)) * f.vis;
  };

  return {
    reset() { lock = null; missed = 0; },
    get locked() { return lock ? { ...lock } : null; },

    /**
     * 從多個骨架中挑出使用者。
     * @param {Array<Array>} poses 每個元素是一份 33 點
     * @returns {{index:number, features:object|null, state:'locked'|'acquired'|'reacquired'|'none'}}
     *   index = -1 表示這一幀沒有可用的人。
     */
    pick(poses) {
      const cand = [];
      for (let i = 0; i < (poses?.length || 0); i++) {
        const f = poseFeatures(poses[i]);
        if (f && f.vis >= minVis) cand.push({ i, f });
      }
      if (!cand.length) {
        missed++;
        if (missed >= lostFrames) { lock = null; missed = 0; }
        return { index: -1, features: null, state: 'none' };
      }

      if (lock) {
        // 只在**鎖定對象**的鄰域內找，不比較誰比較大 —— 這就是遲滯。
        let best = null, bestD = Infinity;
        for (const c of cand) {
          const d = Math.hypot(c.f.cx - lock.cx, c.f.cy - lock.cy) / Math.max(lock.size, 1e-3);
          const sizeRatio = c.f.size / Math.max(lock.size, 1e-3);
          // 尺度一幀內變化超過 ±60% 的，不可能是同一個人（多半是遠處那位被誤配）
          if (d < bestD && d <= maxJump && sizeRatio > 0.4 && sizeRatio < 2.5) { best = c; bestD = d; }
        }
        if (best) {
          missed = 0;
          // 平滑更新鎖定狀態：直接覆寫會讓一次抖動就放大搜尋範圍
          lock = {
            cx: lock.cx * 0.5 + best.f.cx * 0.5,
            cy: lock.cy * 0.5 + best.f.cy * 0.5,
            size: lock.size * 0.7 + best.f.size * 0.3,
          };
          return { index: best.i, features: best.f, state: 'locked' };
        }
        missed++;
        if (missed < lostFrames) return { index: -1, features: null, state: 'none' };
        lock = null; missed = 0;
        const re = cand.reduce((a, b) => (freshScore(b.f) > freshScore(a.f) ? b : a));
        lock = { cx: re.f.cx, cy: re.f.cy, size: re.f.size };
        return { index: re.i, features: re.f, state: 'reacquired' };
      }

      const pick = cand.reduce((a, b) => (freshScore(b.f) > freshScore(a.f) ? b : a));
      lock = { cx: pick.f.cx, cy: pick.f.cy, size: pick.f.size };
      missed = 0;
      return { index: pick.i, features: pick.f, state: 'acquired' };
    },
  };
}
