# -*- coding: utf-8 -*-
"""產生 demo 用的種子資料，日期一律以「執行當天」為基準。

為什麼需要它：原本的 demo-seed.json 把日期寫死（2026-08-18～08-25）。
放到 demo 當天匯入時，健康分頁的「本週 VS 上週」會全是 0、近 7／14 天圖表全空、
連續天數判定為已中斷 —— 評審看到的會是一個沒有資料的儀表板。

用法：
    python3 make-demo-seed.py                  # 輸出 demo-seed.json（覆蓋）
    python3 make-demo-seed.py 我的種子.json     # 指定輸出檔名

匯入方式：設定分頁 →「匯入資料」→ 選這個檔。

產生的狀態刻意安排成：
  · 最後一次訓練在**昨天** → 連續天數仍成立，當天現場做一次即可接續（展示效果最好）
  · 本週與上週都有資料 → 「本週 VS 上週」有對比可看
  · 近 14 天皆有分布 → 兩張趨勢圖都有內容
  · 今日尚未訓練 → 今日任務維持未完成，現場示範完就會推進
"""
import json, os, sys, random
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = json.load(open(os.path.join(HERE, 'demo-seed.json'), encoding='utf8'))

# (幾天前, 動作, 動作名, 秒數, 有效次, 無效次, 評級, 錯誤分布)
PLAN = [
    (13, 'squat',       '深蹲',     300, 18, 3, 'A', {'half_rep': 1}),
    (12, 'pushup',      '伏地挺身', 240, 12, 4, 'B', {'sag': 2}),
    (10, 'jumpingjack', '開合跳',   180, 26, 2, 'A', {}),
    (9,  'squat',       '深蹲',     300, 20, 2, 'A', {'knee_valgus': 1}),
    (8,  'highknees',   '高抬腿',   180, 24, 5, 'B', {'low_knee': 3}),
    (6,  'squat',       '深蹲',     300, 22, 1, 'A', {}),
    (5,  'pushup',      '伏地挺身', 240, 15, 3, 'A', {'sag': 1}),
    (3,  'jumpingjack', '開合跳',   200, 28, 3, 'A', {'limb_desync': 2}),
    (2,  'squat',       '深蹲',     300, 21, 2, 'A', {'half_rep': 1}),
    (1,  'highknees',   '高抬腿',   200, 25, 4, 'B', {'low_knee': 2}),
]
MET = {'squat': 5.4, 'pushup': 8.0, 'jumpingjack': 8.0, 'highknees': 8.0}


def build(now=None):
    now = now or datetime.now(timezone.utc)
    rnd = random.Random(20260915)          # 固定亂數種子：同一天重跑結果一致
    hist, coins = [], 0
    for days, ex, name, dur, valid, invalid, grade, faults in PLAN:
        t = (now - timedelta(days=days)).replace(hour=19, minute=rnd.randint(0, 50), second=0, microsecond=0)
        rate = round(valid / (valid + invalid), 3)
        earned = valid * 10
        coins += earned
        hist.append({
            'id': ''.join(rnd.choice('abcdefghijklmnopqrstuvwxyz0123456789') for _ in range(8)),
            'dateISO': t.isoformat().replace('+00:00', 'Z'),
            'date': t.date().isoformat(),
            'exercise': ex, 'exerciseName': name,
            'durationSec': dur, 'validReps': valid, 'invalidReps': invalid,
            'targetRate': rate, 'calories': round(MET[ex] * 3.5 * 70 / 200 * dur / 60, 1),
            'coinsEarned': earned, 'grade': grade, 'faults': faults,
        })

    # 連續天數：由 PLAN 末段實際的連續日數推得，最後活動日為昨天
    days_set = {d for d, *_ in PLAN}
    streak, k = 0, 1
    while k in days_set:
        streak += 1; k += 1

    seed = dict(BASE)
    seed['history'] = hist
    seed['streak'] = {
        'current': streak,
        'lastActiveDate': (now - timedelta(days=1)).date().isoformat(),
        'longest': max(streak, BASE.get('streak', {}).get('longest', 0)),
    }
    seed['wallet'] = dict(BASE['wallet'])
    seed['wallet']['coins'] = coins - 1500 if coins > 1500 else coins   # 留一些已花用的痕跡
    return seed


if __name__ == '__main__':
    dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'demo-seed.json')
    s = build()
    json.dump(s, open(dst, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    d = sorted({h['date'] for h in s['history']})
    print(f'已寫入 {dst}')
    print(f'  訓練紀錄 {len(s["history"])} 筆，{d[0]} → {d[-1]}（最後一次＝昨天）')
    print(f'  連續天數 {s["streak"]["current"]} 天 · 金幣 {s["wallet"]["coins"]}')
    print(f'  匯入方式：設定分頁 →「匯入資料」')
