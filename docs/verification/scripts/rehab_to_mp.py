# -*- coding: utf-8 -*-
"""REHAB24-6（3d_joints，30fps）→ 正面鏡頭視角的 MediaPipe-33 座標。

資料來源：Zenodo DOI 10.5281/zenodo.13305826，授權 CC BY-NC 4.0（非商業）。
逐次動作的幀範圍與正確性標註取自資料集隨附的 Segmentation.csv
（`correctness` 欄由物理治療師標註，1 = 正確）。

座標系：26 關節，(x, y, z, conf)，單位公尺，**axis1 為垂直向上**
（實測腳部 0.0、頭部 1.8，重力對齊；與 EC3D 的三角測量座標系不同，
 後者非重力對齊，需另以地板法向求垂直）。

關節索引（由骨架鏈結構反查）：
  0 骨盆　1–5 脊椎→頭
  6–10 左：鎖骨/肩/肘/腕/手　11–15 右：同上
  16–20 左腿：髖/膝/踝/跟/趾　21–25 右腿：同上

⚠️ 第 6 與 11 號是**鎖骨中線點**（x≈0），不是肩關節；肩是 7 與 12。
   誤用 6/11 會使肩寬趨近 0，所有以肩寬正規化的比值爆增（實測膝/肩比達 7.49，
   解剖上不可能）—— 凡以肩寬為分母者，務必先驗算比值是否落在常模內。

用法：python3 rehab_to_mp.py <rehab_ExN 目錄> <Segmentation.csv> <運動編號> <正確性 0|1> <輸出.json> [機位高度mm|ideal]
"""
import sys, os, csv, json
import numpy as np

J = dict(HEAD=5, LSHO=7, LELB=8, LWRI=9, RSHO=12, RELB=13, RWRI=14,
         LHIP=16, LKNEE=17, LANK=18, LHEEL=19, LTOE=20,
         RHIP=21, RKNEE=22, RANK=23, RHEEL=24, RTOE=25)
MP = dict(NOSE=0, LEFT_SHOULDER=11, RIGHT_SHOULDER=12, LEFT_ELBOW=13, RIGHT_ELBOW=14,
          LEFT_WRIST=15, RIGHT_WRIST=16, LEFT_HIP=23, RIGHT_HIP=24,
          LEFT_KNEE=25, RIGHT_KNEE=26, LEFT_ANKLE=27, RIGHT_ANKLE=28,
          LEFT_HEEL=29, RIGHT_HEEL=30, LEFT_FOOT_INDEX=31, RIGHT_FOOT_INDEX=32)
M = {'NOSE':'HEAD','LEFT_SHOULDER':'LSHO','RIGHT_SHOULDER':'RSHO','LEFT_ELBOW':'LELB',
     'RIGHT_ELBOW':'RELB','LEFT_WRIST':'LWRI','RIGHT_WRIST':'RWRI','LEFT_HIP':'LHIP',
     'RIGHT_HIP':'RHIP','LEFT_KNEE':'LKNEE','RIGHT_KNEE':'RKNEE','LEFT_ANKLE':'LANK',
     'RIGHT_ANKLE':'RANK','LEFT_HEEL':'LHEEL','RIGHT_HEEL':'RHEEL',
     'LEFT_FOOT_INDEX':'LTOE','RIGHT_FOOT_INDEX':'RTOE'}
UNSEEN = [1,2,3,4,5,6,7,8,9,10,17,18,19,20,21,22]   # 眼/耳/口/手指：本資料集無
VERT = 1


def segments(seg_csv, ex_id, correctness):
    """回傳 {video_id: [(first, last), ...]}，僅取指定運動與正確性。"""
    out = {}
    with open(seg_csv, newline='') as f:
        for r in csv.DictReader(f, delimiter=';'):
            if r['exercise_id'] != str(ex_id) or r['correctness'] != str(correctness):
                continue
            if r.get('mocap_erroneous') == '1':      # 資料集自行標記的壞段，排除
                continue
            out.setdefault(r['video_id'], []).append((int(r['first_frame']), int(r['last_frame'])))
    return out


def to_frames(V, cam_h=None, dist_ratio=1.6, span=0.78):
    """透視投影成正面鏡頭。cam_h 為公尺；None = 與人體中心同高。"""
    g = lambda n: V[:, J[n]]
    toe = (g('LTOE') + g('RTOE')) / 2
    hee = (g('LHEEL') + g('RHEEL')) / 2
    f = (toe - hee).mean(0); f[VERT] = 0
    n = np.linalg.norm(f)
    f = np.array([1.0, 0, 0]) if n < 1e-9 else f / n
    hor = [i for i in range(3) if i != VERT]
    right = np.zeros(3); right[hor[0]] = -f[hor[1]]; right[hor[1]] = f[hor[0]]
    h0 = g('HEAD')[:, VERT].max() - g('LANK')[:, VERT].min()
    ctr = V.reshape(-1, 3).mean(0)
    cam = ctr + f * dist_ratio * h0
    cam[VERT] = ctr[VERT] if cam_h is None else cam_h
    rel = V - cam
    dep = np.clip((rel * (-f)).sum(-1), 1e-6, None)
    u = (rel * right).sum(-1) / dep
    v = -rel[..., VERT] / dep
    sc = span / (v.max() - v.min())
    cu, cv = 0.5 * (u.min() + u.max()), 0.5 * (v.min() + v.max())
    px, py = 0.5 + sc * (u - cu), 0.5 + sc * (v - cv)
    out = []
    for i in range(len(V)):
        lm = [dict(x=0.5, y=0.5, z=0.0, visibility=0.0) for _ in range(33)]
        for mp, b in M.items():
            j = J[b]
            lm[MP[mp]] = dict(x=float(px[i, j]), y=float(py[i, j]), z=0.0, visibility=1.0)
        for k in UNSEEN:
            lm[k] = dict(x=0.5, y=0.5, z=0.0, visibility=0.0)
        out.append(lm)
    return out


def truth_depth(V):
    """三維真值：最深處「髖中心 − 膝中心」的高度差。負值 = 髖低於膝。"""
    hip = (V[:, J['LHIP'], VERT] + V[:, J['RHIP'], VERT]) / 2
    kne = (V[:, J['LKNEE'], VERT] + V[:, J['RKNEE'], VERT]) / 2
    return float((hip - kne).min())


def main(src, seg_csv, ex_id, correctness, dst, cam):
    segs = segments(seg_csv, ex_id, correctness)
    recs, nvid = [], 0
    for vid, spans in sorted(segs.items()):
        p = os.path.join(src, f'{vid}-30fps.npy')
        if not os.path.exists(p):
            continue
        nvid += 1
        A = np.load(p)[:, :, :3]
        for k, (a, b) in enumerate(spans):
            V = A[a:b + 1]
            if len(V) < 20:
                continue
            recs.append(dict(id=f'{vid}_s{vid[-3:]}_r{k}', gt=truth_depth(V),
                             f=[[round(x, 5) for lm in fr for x in (lm['x'], lm['y'], lm['z'], lm['visibility'])]
                                for fr in to_frames(V, cam_h=cam)]))
    json.dump(recs, open(dst, 'w'))
    print(f'{src} → {dst}：{nvid} 支影片、{len(recs)} 次動作'
          f'（三維真值「髖低於膝」者 {sum(1 for r in recs if r["gt"] <= 0)} 次）')


if __name__ == '__main__':
    cam = None if len(sys.argv) < 7 or sys.argv[6] == 'ideal' else float(sys.argv[6]) / 1000.0
    main(sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), sys.argv[5], cam)
