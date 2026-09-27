/**
 * 共用主角畫布的「掛載點登記表」與繪製排程（純邏輯，不碰 three、不碰 DOM）。
 *
 * 整個健身頁只有一個 WebGL renderer（見 FitnessCharacter.tsx 開頭的說明：開第二個就洩漏一個 context）。
 * 推薦卡、4 張動作卡、動作說明頁、示範舞台、陪伴主角各是一個「掛載點」，每個掛載點有自己的 2D 畫布；
 * 每一幀 renderer 依序替每個看得到的點畫一次（只畫該點自己的主角），再貼到該點的畫布上。
 *
 * 為了不在每個點之間重配 renderer 的繪圖緩衝（改尺寸就是重配，一幀 5 次會卡），renderer 固定開成
 * 「所有點裡最大的寬 × 最大的高」，每個點只畫在左下角自己那一塊（WebGL 的 viewport 原點在左下），
 * 貼的時候從畫布座標（原點在左上）的 {@link sourceRect} 取出來。
 *
 *   npm run test:fitness（scripts/test-fitness-views.ts）
 */

/** 一個掛載點在排程上需要知道的事。 */
export interface ViewSlot {
  /** 版面寬高（CSS 像素，未含祖先的 transform）。 */
  width: number;
  height: number;
  /** 捲出畫面、`display:none` 或所在頁面被蓋住 → false，不畫。 */
  visible: boolean;
}

/** 這一幀要畫的點：看得到、有尺寸。 */
export function drawable<T extends ViewSlot>(slots: Iterable<T>): T[] {
  const out: T[] = [];
  for (const s of slots) if (s.visible && s.width >= 1 && s.height >= 1) out.push(s);
  return out;
}

/** 一個點實際繪製的像素尺寸（至少 1×1）。 */
export function pixelSize(s: ViewSlot, dpr: number): { w: number; h: number } {
  const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  return { w: Math.max(1, Math.round(s.width * r)), h: Math.max(1, Math.round(s.height * r)) };
}

/** renderer 繪圖緩衝要開多大：這一幀所有點的最大寬、最大高。沒有點時回 null（不改尺寸）。 */
export function atlasSize(slots: ViewSlot[], dpr: number): { w: number; h: number } | null {
  if (!slots.length) return null;
  let w = 1, h = 1;
  for (const s of slots) {
    const p = pixelSize(s, dpr);
    w = Math.max(w, p.w);
    h = Math.max(h, p.h);
  }
  return { w, h };
}

/**
 * renderer 目前的緩衝夠不夠用。夠用就不改（只長不縮，避免捲動時點的大小輪流變化造成來回重配）；
 * 不夠才回傳新的尺寸（取兩者較大）。
 */
export function growAtlas(current: { w: number; h: number }, need: { w: number; h: number }): { w: number; h: number } | null {
  if (need.w <= current.w && need.h <= current.h) return null;
  return { w: Math.max(current.w, need.w), h: Math.max(current.h, need.h) };
}

/**
 * 畫在左下角 w×h 的那一塊，在 renderer 畫布（原點左上）上的來源矩形 [sx, sy, sw, sh]。
 */
export function sourceRect(atlasH: number, w: number, h: number): [number, number, number, number] {
  return [0, Math.max(0, atlasH - h), w, h];
}

/**
 * 登記表：同一個 key 重複登記（React StrictMode 開發模式雙掛載）只算一次；
 * 最後一個點離開時 `size()` 為 0，呼叫端據此停止繪製。
 */
export function createViewRegistry<T>() {
  const map = new Map<number, T>();
  return {
    set(key: number, value: T) {
      map.set(key, value);
    },
    get: (key: number) => map.get(key),
    remove(key: number) {
      return map.delete(key);
    },
    entries: () => [...map.entries()],
    values: () => map.values(),
    size: () => map.size,
  };
}

/** 相機的垂直視角（度），框夠寬時用這個。 */
export const BASE_FOV = 30;
/**
 * 框比這個更瘦長時，相機改成以「寬度」取景：草帽帽簷（半徑約 1 個世界單位）在 30° 視角、
 * 框寬只有高的 0.45 倍時（390 寬的推薦卡 84×185）左右被裁掉。改成保證看得到的寬度不小於
 * 高 0.72 倍的框能看到的寬度，主角整體縮小一些，但帽簷與張開的手不會被裁。
 */
export const MIN_VIEW_ASPECT = 0.72;
/** 依框的寬高比決定垂直視角（度）。 */
export function fovFor(aspect: number): number {
  if (!(aspect > 0) || aspect >= MIN_VIEW_ASPECT) return BASE_FOV;
  const half = Math.tan((BASE_FOV * Math.PI) / 360) * (MIN_VIEW_ASPECT / aspect);
  return (Math.atan(half) * 360) / Math.PI;
}

/**
 * 各動作的視角（角色繞垂直軸轉幾度，弧度；負值＝轉向畫面左方露出右側面）。
 * Q 版角色的取捨（2026-09-27 使用者看過改前姿勢後修正）：深蹲是膝蓋往外、身體下降，接近正面才看得出張腿；高抬腿接近側面才看得出膝蓋抬起（3/4 側時腿朝鏡頭被透視縮短）；
 * 開合跳近正面看張開幅度；伏地挺身偏側面看身體斜線，但轉一點向鏡頭，頭才不會擋住撐在地上的手。
 */
export const VIEW_YAW: Readonly<Record<string, number>> = Object.freeze({
  squat: -0.3,
  highknees: -0.9,
  jumpingjack: -0.15,
  pushup: -1.0,
});
export const viewYaw = (exercise: string) => VIEW_YAW[exercise] ?? VIEW_YAW.squat;
