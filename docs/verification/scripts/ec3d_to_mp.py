# -*- coding: utf-8 -*-
"""EC3D 原始 3D（未正規化）→ 正面鏡頭視角的 MediaPipe-33 座標。
關節順序為 OpenPose BODY_25（已由 repo 的 bone_connections 反查確認：
11→22/23/24 為右踝接右腳趾/小趾/腳跟，14→19/20/21 為左側，與 BODY_25 定義一致）。
逐次動作的幀範圍取自 data_3D.pickle 的 (act,sub,lab,rep,frame) 標籤。
"""
import pickle, numpy as np, json, sys

B25 = dict(Nose=0, Neck=1, RSho=2, RElb=3, RWri=4, LSho=5, LElb=6, LWri=7, MidHip=8,
           RHip=9, RKnee=10, RAnk=11, LHip=12, LKnee=13, LAnk=14,
           REye=15, LEye=16, REar=17, LEar=18,
           LBigToe=19, LSmallToe=20, LHeel=21, RBigToe=22, RSmallToe=23, RHeel=24)
MP = dict(NOSE=0, LEFT_EAR=7, RIGHT_EAR=8, LEFT_SHOULDER=11, RIGHT_SHOULDER=12,
          LEFT_ELBOW=13, RIGHT_ELBOW=14, LEFT_WRIST=15, RIGHT_WRIST=16,
          LEFT_HIP=23, RIGHT_HIP=24, LEFT_KNEE=25, RIGHT_KNEE=26,
          LEFT_ANKLE=27, RIGHT_ANKLE=28, LEFT_HEEL=29, RIGHT_HEEL=30,
          LEFT_FOOT_INDEX=31, RIGHT_FOOT_INDEX=32)
M = {'NOSE':'Nose','LEFT_EAR':'LEar','RIGHT_EAR':'REar','LEFT_SHOULDER':'LSho','RIGHT_SHOULDER':'RSho',
     'LEFT_ELBOW':'LElb','RIGHT_ELBOW':'RElb','LEFT_WRIST':'LWri','RIGHT_WRIST':'RWri',
     'LEFT_HIP':'LHip','RIGHT_HIP':'RHip','LEFT_KNEE':'LKnee','RIGHT_KNEE':'RKnee',
     'LEFT_ANKLE':'LAnk','RIGHT_ANKLE':'RAnk','LEFT_HEEL':'LHeel','RIGHT_HEEL':'RHeel',
     'LEFT_FOOT_INDEX':'LBigToe','RIGHT_FOOT_INDEX':'RBigToe'}
ABSENT = ['LEFT_EYE_INNER','LEFT_EYE','LEFT_EYE_OUTER','RIGHT_EYE_INNER','RIGHT_EYE',
          'RIGHT_EYE_OUTER','MOUTH_LEFT','MOUTH_RIGHT','LEFT_PINKY','RIGHT_PINKY',
          'LEFT_INDEX','RIGHT_INDEX','LEFT_THUMB','RIGHT_THUMB']
ABS_IDX = dict(LEFT_EYE_INNER=1, LEFT_EYE=2, LEFT_EYE_OUTER=3, RIGHT_EYE_INNER=4, RIGHT_EYE=5,
               RIGHT_EYE_OUTER=6, MOUTH_LEFT=9, MOUTH_RIGHT=10, LEFT_PINKY=17, RIGHT_PINKY=18,
               LEFT_INDEX=19, RIGHT_INDEX=20, LEFT_THUMB=21, RIGHT_THUMB=22)

FOOT = [B25[k] for k in ('LAnk','RAnk','LBigToe','LSmallToe','LHeel','RBigToe','RSmallToe','RHeel')]


def floor_up(V):
    """垂直方向＝雙腳點雲擬合平面的法向。
    重要：EC3D 的 3D 由多機三角測量而得，世界座標系**非重力對齊**（實測偏離達 29.5°），
    不可假設任一座標軸為垂直。雙腳全程踩地，故地板法向是與軀幹無關的可靠參考。"""
    P = V[:, FOOT, :].reshape(-1, 3); P = P - P.mean(0)
    n = np.linalg.svd(P, full_matrices=False)[2][-1]
    up = V[:, B25['Neck']].mean(0) - V[:, FOOT, :].reshape(-1, 3).mean(0)
    return -n if n @ up < 0 else n


def sequences(raw, lab3d, act, lab):
    """回傳 [(key, (T,25,3) ndarray)]，逐次動作。幀順序由 data_3D 的 frame 欄決定。"""
    idx = {}
    m = (lab3d[:,0]==act) & (lab3d[:,2]==lab)
    for a,s,l,r,f in lab3d[m]:
        idx.setdefault((a,s,l,r), []).append(f)
    out = []
    for key, frames in idx.items():
        a,s,l,r = key
        pool = raw['frames'][a][s][int(l)]
        arrs = []
        for f in sorted(frames, key=int):
            g = (pool.get(f'frame_{int(f):06d}') or {}).get('3D_gt') or {}
            if len(g) >= 25:
                arrs.append(np.array([g[k] for k in range(25)], dtype=float))
        if len(arrs) >= 20: out.append((key, np.stack(arrs)))
    return out


def to_frames(V, cam_h=None, dist_ratio=1.6, span=0.78):
    """透視投影成正面鏡頭。垂直取地板法向，朝向由腳尖相對腳跟決定。"""
    g = lambda n: V[:, B25[n]]
    up = floor_up(V)
    toe = (g('LBigToe') + g('RBigToe')) / 2
    hee = (g('LHeel') + g('RHeel')) / 2
    f = (toe - hee).mean(0); f = f - (f @ up) * up       # 投影到水平面
    nf = np.linalg.norm(f)
    if nf < 1e-9:
        f = np.cross(up, [1.0, 0, 0]); nf = np.linalg.norm(f)
    f = f / nf                                           # 身體朝向（水平）
    right = np.cross(up, f)
    h0 = (g('Nose') @ up).max() - (g('LAnk') @ up).min()  # 身高（沿真垂直）
    ctr = V.reshape(-1,3).mean(0)
    ground = (V[:, FOOT, :].reshape(-1,3) @ up).mean()    # 地板高度
    cam = ctr + f * dist_ratio * h0
    cam = cam + (((ground + (cam_h if cam_h is not None else (ctr @ up) - ground)) - (cam @ up)) * up)
    fwd = -f
    rel = V - cam
    dep = np.clip((rel*fwd).sum(-1), 1e-6, None)
    u = (rel*right).sum(-1) / dep
    v = -((rel @ up)) / dep
    sc = span / (v.max()-v.min()); cu = 0.5*(u.min()+u.max()); cv = 0.5*(v.min()+v.max())
    px = 0.5 + sc*(u-cu); py = 0.5 + sc*(v-cv)
    out = []
    for i in range(len(V)):
        lm = [dict(x=0.5,y=0.5,z=0.0,visibility=0.0) for _ in range(33)]
        for mp, b in M.items():
            j = B25[b]
            lm[MP[mp]] = dict(x=float(px[i,j]), y=float(py[i,j]), z=0.0, visibility=1.0)
        for a in ABSENT: lm[ABS_IDX[a]] = dict(x=0.5,y=0.5,z=0.0,visibility=0.0)
        out.append(lm)
    return out


def truth_depth(V):
    """3D 真值：最深處「髖中心 − 膝中心」沿地板法向的差。負值＝髖低於膝。"""
    up = floor_up(V)
    hip = ((V[:,B25['LHip']] + V[:,B25['RHip']]) / 2) @ up
    kne = ((V[:,B25['LKnee']] + V[:,B25['RKnee']]) / 2) @ up
    return float((hip-kne).min())


if __name__ == '__main__':
    act, lab, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    cam = None if len(sys.argv)<5 or sys.argv[4]=='ideal' else float(sys.argv[4])
    raw = pickle.load(open('data_raw.pickle','rb'))
    lab3d = pickle.load(open('ec3d/data_3D.pickle','rb'))['labels']
    seqs = sequences(raw, lab3d, act, lab)
    recs = []
    for key, V in seqs:
        recs.append(dict(id='_'.join(map(str,key)), gt=truth_depth(V),
            f=[[round(x,5) for lm in fr for x in (lm['x'],lm['y'],lm['z'],lm['visibility'])]
               for fr in to_frames(V, cam_h=cam)]))
    json.dump(recs, open(dst,'w'))
    print(f'  {act}/lab={lab} → {dst}：{len(recs)} 段（原 {len(seqs)} 段）')
