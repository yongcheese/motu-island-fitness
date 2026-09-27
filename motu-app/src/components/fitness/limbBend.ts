/**
 * 替沒有膝蓋的腿「彎出一個膝蓋」（檔尾另有伏地挺身用的手臂伸縮 {@link createArmStretcher}）：把腿的網格在膝蓋高度附近逐頂點繞 x 軸轉，膝蓋以下轉 `bend` 弧度。
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

/**
 * 手臂的量測：肩膀（原點）到手臂最低點的距離，與手掌頂端的高度（手臂座標，往 -y 延伸）。
 * 手掌是 Q 版的大圓球，占手臂下半段，拉長手臂時要避開它，手掌才不會被拉成水滴。
 */
export interface ArmShape {
  /** 手臂最低點（負值）。 */
  bottom: number;
  /** 手掌頂端（負值，比 bottom 高）。 */
  handTop: number;
}

/** 量手臂形狀：手掌半徑取下半段頂點離手臂軸的最大水平距離（圓球手的赤道）。 */
export function measureArm(arm: Group): ArmShape | null {
  arm.updateMatrixWorld(true);
  const inv = new Matrix4().copy(arm.matrixWorld).invert();
  const pts: Vector3[] = [];
  arm.traverse((o: Object3D) => {
    const mesh = o as Mesh;
    const pos = mesh.isMesh ? (mesh.geometry?.getAttribute('position') as BufferAttribute | undefined) : undefined;
    if (!pos) return;
    const to = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    for (let i = 0; i < pos.count; i++) pts.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(to));
  });
  if (!pts.length) return null;
  let bottom = 0;
  for (const p of pts) bottom = Math.min(bottom, p.y);
  if (!(bottom < 0)) return null;
  const low = pts.filter((p) => p.y < bottom * 0.55);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of low) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let r = 0;
  for (const p of low) r = Math.max(r, Math.hypot(p.x - cx, p.z - cz));
  // 手掌頂端再往上留一點（不拉到手掌的曲面）；至少留肩膀下方 30% 給手腕拉伸
  return { bottom, handTop: Math.min(bottom * 0.3, bottom + 2 * r - bottom * 0.03) };
}

/** 拉伸區的上緣：肩膀到手掌頂端的中點（手腕＋袖口下緣）。 */
const stretchTop = (shape: ArmShape) => shape.handTop / 2;
/** 手臂最多能縮多少（負的拉伸量）：最多縮拉伸區的 30%，再縮皮膚會從袖口穿出來。 */
export const minStretch = (shape: ArmShape) => -(stretchTop(shape) - shape.handTop) * 0.3;

export interface ArmStretcher {
  /**
   * 手臂伸縮 `stretch`（手臂座標；負值＝縮短，下限 {@link minStretch}）：只伸縮手掌上方那段手腕，
   * 手掌整顆平移、保持圓形。回傳手臂最低點（變形後）在手臂座標的位置。
   */
  apply(arm: Group | null, shape: ArmShape, stretch: number): Vector3;
  dispose(): void;
}

/**
 * 伏地挺身的手臂：打直、只伸縮手腕。遊戲組主角的手臂只有「袖子一小段＋一顆大手掌」
 * （手掌從手臂 40% 處就開始），沒有前臂可以彎手肘 —— 硬彎會折在袖口或手掌上（09-28 實測，使用者說不自然）。
 */
export function createArmStretcher(): ArmStretcher {
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
  const adopt = (arm: Group) => {
    release();
    owner = arm;
    arm.updateMatrixWorld(true);
    const inv = new Matrix4().copy(arm.matrixWorld).invert();
    arm.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
      const source = mesh.geometry;
      const copy = source.clone();
      const toLeg = new Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
      bent.push({ mesh, source, copy, toLeg, toMesh: new Matrix4().copy(toLeg).invert() });
      mesh.geometry = copy;
      mesh.frustumCulled = false;
    });
  };
  const stale = (arm: Group) => owner !== arm || !bent.length || bent.some((b) => b.mesh.geometry !== b.copy || !isInside(b.mesh, arm));

  /** 一個點（手臂座標）變形：手掌以下平移、拉伸區線性伸縮、上面不動。 */
  const deform = (p: Vector3, shape: ArmShape, stretch: number) => {
    const top = stretchTop(shape);
    if (p.y < shape.handTop) p.y -= stretch;
    else if (p.y < top) p.y = top + (p.y - top) * ((top - shape.handTop + stretch) / (top - shape.handTop));
  };

  const tip = new Vector3();
  return {
    apply(arm, shape, stretch) {
      stretch = Math.max(minStretch(shape), stretch);
      deform(tip.set(0, shape.bottom, 0), shape, stretch);
      if (!arm) return tip;
      if (stale(arm)) adopt(arm);
      if (Math.abs(stretch - last) < 1e-5) return tip;
      last = stretch;
      for (const b of bent) {
        const src = b.source.getAttribute('position') as BufferAttribute;
        const dst = b.copy.getAttribute('position') as BufferAttribute;
        for (let i = 0; i < src.count; i++) {
          v.fromBufferAttribute(src, i).applyMatrix4(b.toLeg);
          deform(v, shape, stretch);
          v.applyMatrix4(b.toMesh);
          dst.setXYZ(i, v.x, v.y, v.z);
        }
        dst.needsUpdate = true;
        b.copy.computeBoundingBox();
      }
      return tip;
    },
    dispose() {
      release();
      owner = null;
    },
  };
}
