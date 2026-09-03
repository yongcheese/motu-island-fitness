# -*- coding: utf-8 -*-
"""取得驗證所需的兩個公開資料集。

兩者皆為壓縮檔且體積龐大（單檔逾 200MB），但驗證只需其中少數檔案，
故以 HTTP Range 讀取壓縮檔的中央目錄，挑出所需項目後分段下載，不必整包取回。

UI-PRMD：原網站已隨校方網站遷移而失效（實測回應 301 轉 404），
         改自 Internet Archive 之 2025-04-25 存檔取得。授權 ODC-PDDL（公眾領域）。
REHAB24-6：自 Zenodo 取得，DOI 10.5281/zenodo.13305826。授權 CC BY-NC 4.0（非商業）。

用法：
    python3 fetch_data.py <輸出目錄>
"""
import os, struct, subprocess, sys, time, zlib

W = "https://web.archive.org/web"
UIPRMD = {
    'correct':   f"{W}/20250425223830id_/https://www.webpages.uidaho.edu/ui-prmd/Segmented%20Movements.zip",
    'incorrect': f"{W}/20250425224116id_/https://www.webpages.uidaho.edu/ui-prmd/Incorrect%20Segmented%20Movements.zip",
}
REHAB_ZIP = "https://zenodo.org/api/records/13305826/files/3d_joints.zip/content"
REHAB_SEG = "https://zenodo.org/api/records/13305826/files/Segmentation.csv/content"


def _curl(url, a=None, b=None, out=None, tries=6):
    for i in range(tries):
        cmd = ["curl", "-sL", "--max-time", "300", "--retry", "2"]
        if a is not None: cmd += ["-r", f"{a}-{b}"]
        if out: cmd += ["-o", out]
        r = subprocess.run(cmd + [url], capture_output=not out)
        if out:
            if os.path.exists(out) and (a is None or os.path.getsize(out) == b - a + 1):
                return True
        elif r.stdout:
            return r.stdout
        time.sleep(3)
    return False if out else b""


def total_size(url):
    h = subprocess.run(["curl", "-sIL", "--max-time", "60", url], capture_output=True, text=True).stdout
    for line in h.splitlines():
        if line.lower().startswith("content-length:"):
            n = int(line.split(":")[1].strip())
            if n > 1000: return n
    raise SystemExit("無法取得檔案大小：" + url)


def central_directory(url, total, tail=3_000_000):
    """讀取 ZIP 尾端的中央目錄，取得每個項目的偏移與大小。"""
    start = max(0, total - tail)
    buf = _curl(url, start, total - 1)
    i = buf.rfind(b'PK\x05\x06')
    if i < 0: raise SystemExit("找不到 ZIP 中央目錄")
    cd_size, cd_off = struct.unpack_from('<II', buf, i + 12)
    j = buf.rfind(b'PK\x06\x06')
    if j >= 0:  # zip64
        cd_size, cd_off = struct.unpack_from('<QQ', buf, j + 40)
    cd = buf[cd_off - start: cd_off - start + cd_size] if cd_off >= start else _curl(url, cd_off, cd_off + cd_size - 1)
    out, p = [], 0
    while p < len(cd) and cd[p:p + 4] == b'PK\x01\x02':
        csize, usize = struct.unpack_from('<II', cd, p + 20)
        nlen, elen, clen = struct.unpack_from('<HHH', cd, p + 28)
        method = struct.unpack_from('<H', cd, p + 10)[0]
        lho = struct.unpack_from('<I', cd, p + 42)[0]
        name = cd[p + 46:p + 46 + nlen].decode('utf8', 'replace')
        out.append(dict(name=name, csize=csize, usize=usize, off=lho, method=method))
        p += 46 + nlen + elen + clen
    return out


def extract(url, entries, outdir, chunk=1_500_000):
    """把選定項目所在的連續區段分塊下載後解出。分塊是必要的 —— 單次請求超過約 2MB 常被截斷。"""
    entries = sorted(entries, key=lambda e: e['off'])
    lo = entries[0]['off']
    hi = max(e['off'] + 30 + 200 + e['csize'] for e in entries)
    blob = outdir + '.span.bin'
    if not (os.path.exists(blob) and os.path.getsize(blob) == hi - lo + 1):
        parts, a, n = [], lo, 0
        while a <= hi:
            b = min(a + chunk - 1, hi)
            pf = f'{blob}.part{n}'
            if not (os.path.exists(pf) and os.path.getsize(pf) == b - a + 1):
                if not _curl(url, a, b, pf): raise SystemExit(f'區塊 {n} 下載失敗')
            print(f'    區塊 {n}: {(b - a + 1) / 1e6:.1f}MB', flush=True)
            parts.append(pf); n += 1; a = b + 1
        with open(blob, 'wb') as o:
            for pf in parts: o.write(open(pf, 'rb').read()); os.remove(pf)
    buf = open(blob, 'rb').read()
    os.makedirs(outdir, exist_ok=True)
    for e in entries:
        p = e['off'] - lo
        assert buf[p:p + 4] == b'PK\x03\x04', e['name']
        nl, el = struct.unpack_from('<HH', buf, p + 26)
        s = p + 30 + nl + el
        raw = buf[s:s + e['csize']]
        d = zlib.decompress(raw, -15) if e['method'] == 8 else raw
        assert len(d) == e['usize'], e['name']
        open(os.path.join(outdir, e['name'].split('/')[-1]), 'wb').write(d)
    os.remove(blob)
    return len(entries)


def main(root):
    os.makedirs(root, exist_ok=True)
    # ── UI-PRMD：m01 深蹲、m02 跨欄步、m07 肩外展的 Vicon 座標 ──
    for grp, url in UIPRMD.items():
        tot = total_size(url)
        ent = central_directory(url, tot)
        for mv, label in [('m01', 'squat'), ('m02', 'hurdle'), ('m07', 'abduction')]:
            if grp == 'incorrect' and mv != 'm01': continue   # 只有深蹲需要不正確組
            want = [e for e in ent if 'Vicon/Positions' in e['name'] and f'/{mv}_' in e['name']]
            if not want: continue
            out = os.path.join(root, f'uiprmd_{label}_{grp}')
            if os.path.isdir(out) and len(os.listdir(out)) >= len(want):
                print(f'  UI-PRMD {label}/{grp}: 已存在，略過'); continue
            print(f'  UI-PRMD {label}/{grp}: {len(want)} 檔', flush=True)
            extract(url, want, out)
    # ── REHAB24-6：Ex3 桌上伏地挺身、Ex6 深蹲的 30fps 關節座標 ──
    _curl(REHAB_SEG, out=os.path.join(root, 'Segmentation.csv'))
    tot = total_size(REHAB_ZIP)
    ent = central_directory(REHAB_ZIP, tot)
    for ex in ['Ex3', 'Ex6']:
        want = [e for e in ent if e['name'].startswith(ex + '/') and '30fps' in e['name']]
        out = os.path.join(root, f'rehab_{ex}')
        if os.path.isdir(out) and len(os.listdir(out)) >= len(want):
            print(f'  REHAB24-6 {ex}: 已存在，略過'); continue
        print(f'  REHAB24-6 {ex}: {len(want)} 檔', flush=True)
        extract(REHAB_ZIP, want, out)
    print('完成 →', root)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else './_verify_data')
