# -*- coding: utf-8 -*-
"""UI-PRMD（Vicon 光學動捕，絕對座標 mm）→ 正面鏡頭視角的 MediaPipe-33 正規化座標。

為何採 Vicon 而非同資料集的 Kinect：
  Kinect 的 positions 是「相對父關節的位移」，須配合角度做正向運動學還原，
  而作者於其公開的視覺化程式中自述「下肢關節的重建不完全正確」。
  本團隊實測證實：還原後，深蹲期間雙腳踩地，踝距卻在一次動作內由 2.7 擺盪至 113（40 倍），
  物理上不可能。Vicon 為反光標記點的絕對座標，無須還原；同一檢驗變異係數僅 0.019。
  → 見 check_physics() 與 docs/verification/UI-PRMD_真人資料標定.md

座標系（以資料實證確認，非假設）：X=深度（面向 +X）、Y=受試者左右（左為 +Y）、Z=上。單位 mm。
標記點順序：論文 Table 2「Vicon Positions」欄（Plug-in-Gait 標準命名），非推測。
"""
import numpy as np

# 論文 Table 2「Vicon Positions」欄，1-indexed 轉 0-indexed
V = ['LFHD','RFHD','LBHD','RBHD','C7','T10','CLAV','STRN','RBAK','LSHO','LUPA','LELB','LFRM',
     'LWRA','LWRB','LFIN','RSHO','RUPA','RELB','RFRM','RWRA','RWRB','RFIN','LASI','RASI','LPSI',
     'RPSI','LTHI','LKNE','LTIB','LANK','LHEE','LTOE','RTHI','RKNE','RTIB','RANK','RHEE','RTOE']
I = {n: i for i, n in enumerate(V)}

MP = dict(NOSE=0, LEFT_EYE_INNER=1, LEFT_EYE=2, LEFT_EYE_OUTER=3, RIGHT_EYE_INNER=4,
    RIGHT_EYE=5, RIGHT_EYE_OUTER=6, LEFT_EAR=7, RIGHT_EAR=8, MOUTH_LEFT=9, MOUTH_RIGHT=10,
    LEFT_SHOULDER=11, RIGHT_SHOULDER=12, LEFT_ELBOW=13, RIGHT_ELBOW=14, LEFT_WRIST=15,
    RIGHT_WRIST=16, LEFT_PINKY=17, RIGHT_PINKY=18, LEFT_INDEX=19, RIGHT_INDEX=20,
    LEFT_THUMB=21, RIGHT_THUMB=22, LEFT_HIP=23, RIGHT_HIP=24, LEFT_KNEE=25, RIGHT_KNEE=26,
    LEFT_ANKLE=27, RIGHT_ANKLE=28, LEFT_HEEL=29, RIGHT_HEEL=30, LEFT_FOOT_INDEX=31,
    RIGHT_FOOT_INDEX=32)

DIRECT = {'LEFT_SHOULDER':'LSHO','RIGHT_SHOULDER':'RSHO','LEFT_ELBOW':'LELB','RIGHT_ELBOW':'RELB',
          'LEFT_KNEE':'LKNE','RIGHT_KNEE':'RKNE','LEFT_ANKLE':'LANK','RIGHT_ANKLE':'RANK',
          'LEFT_HEEL':'LHEE','RIGHT_HEEL':'RHEE','LEFT_FOOT_INDEX':'LTOE','RIGHT_FOOT_INDEX':'RTOE'}
MID = {'NOSE':('LFHD','RFHD'),        # 前額中央；head_tilt 量水平偏移，此近似成立
       'LEFT_EAR':('LFHD','LBHD'), 'RIGHT_EAR':('RFHD','RBHD'),
       'LEFT_WRIST':('LWRA','LWRB'), 'RIGHT_WRIST':('RWRA','RWRB')}
# 髖取同側「髂前上棘＋髂後上棘」中點：單用 ASIS 會被骨盆前後轉動放大（一側前旋即離鏡頭較近，
# 透視使其表觀高度改變）；前後各取一點求中點可抵銷該分量。
HIP_MID = {'LEFT_HIP':('LASI','LPSI'), 'RIGHT_HIP':('RASI','RPSI')}
# 資料集未提供的點一律標為不可見，**不虛構座標**
ABSENT = ['LEFT_EYE_INNER','LEFT_EYE','LEFT_EYE_OUTER','RIGHT_EYE_INNER','RIGHT_EYE',
          'RIGHT_EYE_OUTER','MOUTH_LEFT','MOUTH_RIGHT','LEFT_PINKY','RIGHT_PINKY',
          'LEFT_INDEX','RIGHT_INDEX','LEFT_THUMB','RIGHT_THUMB']


def check_physics(P):
    """物理檢驗：深蹲時雙腳踩地，踝距應近乎恆定。回傳 (平均, 標準差, 變異係數)。
    這是判斷一組動捕資料是否可用的第一道關卡 —— Kinect 那組即因此被淘汰。"""
    d = np.linalg.norm(P[:, I['LANK'], :2] - P[:, I['RANK'], :2], axis=1)
    return d.mean(), d.std(), d.std() / d.mean()


def resample(P, src_hz=100, dst_hz=30):
    """降頻至網路攝影機的真實幀率。Vicon 為 100Hz，直接餵入會與引擎平滑視窗的設計前提不符。"""
    n = len(P)
    t = np.arange(0, n - 1, src_hz / dst_hz)
    i0 = t.astype(int); w = (t - i0)[:, None, None]
    return P[i0] * (1 - w) + P[i0 + 1] * w


def to_frames(P, cam_dist_ratio=1.6, target_span=0.78, cam_height_mm=None, yaw_deg=0.0):
    """三維座標 → 正面鏡頭所見的 MediaPipe-33 正規化影像座標。

    三個刻意的設計決定：
      1. 真透視投影（u = -Y/(camX-X)），非正交 —— 本系統部分判定正依賴透視造成的投影變化。
      2. 機位固定：縮放與置中依整段影片算一次，不逐幀重算（逐幀＝自動變焦，真實鏡頭不會如此）。
      3. 鏡頭高度可設定，用以量化機位對判定的影響。cam_height_mm=None 表示與人體中心同高。
    """
    g = lambda n: P[:, I[n]]
    pts = {}
    for k, v in DIRECT.items(): pts[k] = g(v)
    for k, (a, b) in MID.items(): pts[k] = (g(a) + g(b)) / 2
    for k, (a, b) in HIP_MID.items(): pts[k] = (g(a) + g(b)) / 2

    keys = list(pts.keys())
    A = np.stack([pts[k] for k in keys], axis=1)
    if yaw_deg:
        # 身體朝向（2026-09-25 新增）：繞「首幀骨盆中心」的鉛直軸旋轉，模擬使用者不正對鏡頭。
        # 0 = 正對鏡頭；90 = 側身。只轉受試者、不動鏡頭，鏡頭距離與高度的定義不變。
        c = A[0, [keys.index('LEFT_HIP'), keys.index('RIGHT_HIP')], :].mean(axis=0)
        t = np.deg2rad(yaw_deg); ct, st = np.cos(t), np.sin(t)
        X, Y = A[:, :, 0] - c[0], A[:, :, 1] - c[1]
        A = A.copy(); A[:, :, 0] = c[0] + ct * X - st * Y; A[:, :, 1] = c[1] + st * X + ct * Y
    h0 = g('LFHD')[0, 2] - g('LANK')[0, 2]          # 站立首幀身高（mm）
    camX = P[:, :, 0].max() + cam_dist_ratio * h0    # 鏡頭在受試者前方
    camZ = float(A[:, :, 2].mean()) if cam_height_mm is None else float(cam_height_mm)
    dep = np.clip(camX - A[:, :, 0], 1e-6, None)
    u = -A[:, :, 1] / dep        # 受試者左(+Y) → 影像較小 x（與本專案慣例一致）
    v = -(A[:, :, 2] - camZ) / dep

    vmin, vmax = v.min(), v.max()
    f = target_span / (vmax - vmin)
    cu = 0.5 * (u.min() + u.max()); cv = 0.5 * (vmin + vmax)
    px = 0.5 + f * (u - cu); py = 0.5 + f * (v - cv)
    pz = (A[:, :, 0] - A[:, :, 0].mean()) / max(h0, 1e-9)

    out = []
    for i in range(len(A)):
        lm = [None] * 33
        for j, k in enumerate(keys):
            lm[MP[k]] = dict(x=float(px[i, j]), y=float(py[i, j]), z=float(pz[i, j]), visibility=1.0)
        for a in ABSENT:
            lm[MP[a]] = dict(x=0.5, y=0.5, z=0.0, visibility=0.0)
        out.append(lm)
    return out


def load(path):
    return np.loadtxt(path, delimiter=',').reshape(-1, 39, 3)


def convert(path, **kw):
    return to_frames(resample(load(path)), **kw)


def ground_truth_depth(path):
    """三維真值：一次動作中「髖中心高度 − 膝中心高度」的最小值（mm）。負值＝髖低於膝。
    此值完全不經過鏡頭，故可作為二維判定的獨立真值。"""
    P = resample(load(path))
    hip = (P[:, I['LASI']] + P[:, I['LPSI']] + P[:, I['RASI']] + P[:, I['RPSI']]) / 4
    kne = (P[:, I['LKNE']] + P[:, I['RKNE']]) / 2
    return float((hip[:, 2] - kne[:, 2]).min())


# ─────────────────────────── 命令列介面 ───────────────────────────
if __name__ == '__main__':
    import glob, json, os, sys
    src, dst = sys.argv[1], sys.argv[2]
    cam = None if len(sys.argv) < 4 or sys.argv[3] == 'ideal' else float(sys.argv[3])
    yaw = float(sys.argv[4]) if len(sys.argv) >= 5 else 0.0   # 身體朝向（度），0＝正對鏡頭
    recs = []
    for p in sorted(glob.glob(os.path.join(src, '*_positions*.txt'))):
        base = os.path.basename(p).split('_positions')[0]
        fr = convert(p, cam_height_mm=cam, yaw_deg=yaw)
        recs.append(dict(
            id=base,
            gt=ground_truth_depth(p),   # 三維真值：髖−膝最小值(mm)，負值＝髖低於膝
            f=[[round(v, 5) for lm in f for v in (lm['x'], lm['y'], lm['z'], lm['visibility'])] for f in fr],
        ))
    json.dump(recs, open(dst, 'w'))
    deep = sum(1 for r in recs if r['gt'] <= 0)
    print(f'{src} → {dst}：{len(recs)} 段，其中三維真值判定「髖低於膝」者 {deep} 段')
