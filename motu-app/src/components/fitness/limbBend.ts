/**
 * 替沒有膝蓋的腿「彎出一個膝蓋」：把腿的網格在膝蓋高度附近逐頂點繞 x 軸轉，膝蓋以下轉 `bend` 弧度。
 *
 * 為什麼需要：遊戲組角色的腿是一整根（見 FitnessCharacter.tsx 檔頭「Q 版化」），只轉髖關節的話
 * 深蹲只能「整根腿往前伸」（像坐在地上）或「往兩側張開」（像劈腿），都不像深蹲。有膝蓋之後
 * 大腿前傾、小腿斜立，才是人看得懂的深蹲；高抬腿也能抬大腿、小腿自然下垂。
 *
 * 不改遊戲組的模型檔：網格物件本來就是每個角色各一份（partLoader 的 `scene.clone(true)`），
 * 只有幾何是共用快取，所以這裡把「這個主角的腿」的幾何換成自己的複本再改頂點，島上的主角不受影響；
 * 卸載時換回原本的幾何並釋放複本。換裝後零件重掛、網格物件換新，下一幀自動重新接手。
 */
import { Matrix4, Vector3, type BufferAttribute, type BufferGeometry, type Group, type Mesh, type Object3D } from 'three';

interface Bent {
  mesh: Mesh;
  source: BufferGeometry;
  copy: BufferGeometry;
  /** 網格座標 → 腿座標（腿的原點在髖關節，往 -y 延伸）。 */
  toLeg: Matrix4;
  toMesh: Matrix4;
}

/** 膝蓋上下多少比例的腿長是漸變區（整段硬折會在膝蓋撕開、看得出摺痕）。 */
const BLEND = 0.12;

const v = new Vector3();
const n = new Vector3();
const m3 = new Matrix4();

export interface LegBender {
  /**
   * 把腿彎 `bend` 弧度（正值＝小腿往後折，膝蓋往前）。`length`：髖到腳底的長度（腿座標）。
   * 回傳腳底在腿座標的位置（彎過之後），供呼叫端把腳釘在地上。
   */
  apply(leg: Group | null, bend: number, length: number): Vector3;
  dispose(): void;
}

export function createLegBender(): LegBender {
  let bent: Bent[] = [];
  let owner: Group | null = null;
  let last = NaN;

  const release = () => {
    for (const b of bent) {
      if (b.mesh.geometry === b.copy) b.mesh.geometry = b.source;
      b.copy.dispose();
    }
    bent = [];
    last = NaN;
  };

  const adopt = (leg: Group) => {
    release();
    owner = leg;
    leg.updateMatrixWorld(true);
    const inv = new Matrix4().copy(leg.matrixWorld).invert();
    leg.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
      const source = mesh.geometry;
      const copy = source.clone();
      const toLeg = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      bent.push({ mesh, source, copy, toLeg, toMesh: new Matrix4().copy(toLeg).invert() });
      mesh.geometry = copy;
      mesh.frustumCulled = false;                     // 包圍球跟著頂點變，不值得每幀重算
    });
  };

  // 零件重掛（換裝）或還沒接手：網格的幾何不是我們的複本
  const stale = (leg: Group) => owner !== leg || !bent.length || bent.some((b) => b.mesh.geometry !== b.copy || !isInside(b.mesh, leg));

  const foot = new Vector3();
  return {
    apply(leg, bend, length) {
      const knee = -length / 2;
      const s = Math.sin(bend), c = Math.cos(bend);
      foot.set(0, knee - length / 2 * c, -length / 2 * s);
      if (!leg) return foot;
      if (stale(leg)) adopt(leg);
      if (Math.abs(bend - last) < 1e-4) return foot;
      last = bend;
      const h = length * BLEND;
      for (const b of bent) {
        const src = b.source.getAttribute('position') as BufferAttribute;
        const dst = b.copy.getAttribute('position') as BufferAttribute;
        const srcN = b.source.getAttribute('normal') as BufferAttribute | undefined;
        const dstN = b.copy.getAttribute('normal') as BufferAttribute | undefined;
        for (let i = 0; i < src.count; i++) {
          v.fromBufferAttribute(src, i).applyMatrix4(b.toLeg);
          // 膝蓋以上 0、以下整段 bend、中間平滑過渡
          const t = smooth((knee + h - v.y) / (2 * h));
          const a = bend * t;
          if (a !== 0) {
            const sa = Math.sin(a), ca = Math.cos(a);
            const y = v.y - knee, z = v.z;
            v.y = knee + y * ca - z * sa;
            v.z = y * sa + z * ca;
          }
          v.applyMatrix4(b.toMesh);
          dst.setXYZ(i, v.x, v.y, v.z);
          if (srcN && dstN) {
            n.fromBufferAttribute(srcN, i).transformDirection(b.toLeg);
            if (a !== 0) {
              const sa = Math.sin(a), ca = Math.cos(a);
              const y = n.y, z = n.z;
              n.y = y * ca - z * sa;
              n.z = y * sa + z * ca;
            }
            n.transformDirection(m3.copy(b.toMesh));
            dstN.setXYZ(i, n.x, n.y, n.z);
          }
        }
        dst.needsUpdate = true;
        if (dstN) dstN.needsUpdate = true;
        b.copy.computeBoundingBox();                    // 腳底貼地量的是包圍盒
      }
      return foot;
    },
    dispose() {
      release();
      owner = null;
    },
  };
}

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function isInside(o: Object3D, root: Object3D) {
  for (let p: Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}
