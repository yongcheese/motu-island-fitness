/**
 * 健身頁主角不受島上「鏡頭拉近淡出」影響。
 *
 * 遊戲組的 `Avatar.tsx` 依鏡頭遠近淡出島上主角時，是直接改**材質本身**的 `opacity`
 * （第一人稱時改成 0），原本的值記在 `material.userData.originalOpacity`。
 * 但角色零件的材質是模組層級快取、跨畫布共用的（見 FitnessCharacter.tsx 開頭的說明），
 * 健身頁畫的主角用的是同一批材質 —— 實機回報：在島上拉近成第一人稱後打開健身頁，
 * 主角的頭和手（皮膚材質）整個透明，只剩灰色的衣服，看起來像石頭。
 *
 * 做法：健身頁每次繪製前把被淡出的材質暫時還原成原本的透明度，畫完立刻改回島上設定的值。
 * 只動 `opacity`（一個 uniform），不動 `transparent` —— 後者是著色器開關，每幀來回切會讓
 * three 每幀重新編譯程式。島上把 `transparent` 打開後，透明度 1 的透明材質畫出來與不透明相同。
 *
 *   npm run test:fitness（scripts/test-fitness-views.ts）
 */
import type { Material, Object3D } from 'three';

/**
 * 把 `root` 底下被島上淡出的材質還原成原本的透明度。
 * @returns 改回島上設定值的函式（繪製完一定要呼叫，否則島上的淡出會失效）。
 */
export function liftIslandFade(root: Object3D): () => void {
  const saved: Array<[Material, number]> = [];
  const seen = new Set<Material>();
  root.traverse((obj) => {
    const mat = (obj as Object3D & { material?: Material | Material[] }).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m || seen.has(m)) continue;
      seen.add(m);
      const original = m.userData?.originalOpacity;
      if (typeof original === 'number' && m.opacity !== original) {
        saved.push([m, m.opacity]);
        m.opacity = original;
      }
    }
  });
  return () => {
    for (const [m, opacity] of saved) m.opacity = opacity;
  };
}
