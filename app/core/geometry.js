// 純幾何工具（瀏覽器 + Node 共用）。所有點為 {x,y}。
const RAD2DEG = 180 / Math.PI;

export function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// ∠ABC（B 為頂點），回傳度數 [0,180]
export function angle(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y;
  const v2x = c.x - b.x, v2y = c.y - b.y;
  const dot = v1x * v2x + v1y * v2y;
  const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
  if (m1 === 0 || m2 === 0) return 0;
  let cos = dot / (m1 * m2);
  cos = Math.max(-1, Math.min(1, cos));
  return Math.acos(cos) * RAD2DEG;
}

// 線段 (top→bottom) 相對鉛直線的傾角；0=直立，90=水平
export function vAngleFromVertical(top, bottom) {
  const dx = bottom.x - top.x, dy = bottom.y - top.y;
  // 鉛直向量 (0,1)。傾角 = atan2(|水平分量|, |垂直分量|)
  return Math.atan2(Math.abs(dx), Math.abs(dy)) * RAD2DEG;
}

export function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// 把 x 從 [a,b] 線性映射到 [0,1]
export function norm(x, a, b) { return clamp01((x - a) / (b - a)); }
