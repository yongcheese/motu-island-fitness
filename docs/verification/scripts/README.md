# 驗證腳本：如何重現本專案報告中的數值

本目錄的腳本可從**公開資料源重新取得資料、完整重跑一次驗證**，
輸出報告與企劃書所引用的各項數值。

> **這份腳本存在的理由**：「數值來自程式實際執行」這句話本身證明不了任何事。
> 能證明的只有「任何人重跑都得到同一個數字」。故驗證流程必須是可重現的，
> 而不是只留下結論。

---

## 一、需求

- Python 3（需 `numpy`）
- Node.js（專案本身無建置步驟，直接執行 ES module）
- 可連外網路（首次取得資料時）

## 二、執行

```bash
cd docs/verification/scripts

# 1) 取得資料（自公開來源，約需數分鐘；已下載過會自動略過）
python3 fetch_data.py /tmp/vdata

# 2) 三維座標 → 正面鏡頭視角的 MediaPipe 座標
#    第三個參數為鏡頭高度（mm）；ideal = 與人體中心同高
python3 vicon_to_mp.py /tmp/vdata/uiprmd_squat_correct   /tmp/vdata/c.json ideal
python3 vicon_to_mp.py /tmp/vdata/uiprmd_squat_incorrect /tmp/vdata/n.json ideal

# 3) 送入未經修改的正式判定引擎並輸出數值
node measure.mjs /tmp/vdata/c.json /tmp/vdata/n.json
```

輸出應與 [`EXPECTED.md`](EXPECTED.md) 一致。

## 三、查證「舊門檻」的數值

報告中列出的舊門檻誤判率（例如軀幹前傾 90.8%）係以**當時的門檻**量得，
程式現已改為新值。腳本提供門檻覆寫，使該等歷史數值同樣可被查證：

```bash
# 以真實筆電機位（1150 mm）重現「舊門檻 0.86 誤判 90.8%」
python3 vicon_to_mp.py /tmp/vdata/uiprmd_squat_correct   /tmp/vdata/cL.json 1150
python3 vicon_to_mp.py /tmp/vdata/uiprmd_squat_incorrect /tmp/vdata/nL.json 1150
node measure.mjs /tmp/vdata/cL.json /tmp/vdata/nL.json torso=0.86
```

## 四、檔案

| 檔案 | 用途 |
|---|---|
| `fetch_data.py` | 自公開來源取得資料。以 HTTP Range 讀取壓縮檔中央目錄，只下載所需項目 |
| `vicon_to_mp.py` | UI-PRMD（Vicon）三維座標 → 正面鏡頭視角之 MediaPipe 座標；並輸出三維真值 |
| `measure.mjs` | 送入**正式判定引擎**並輸出數值 |
| `measure_squat_view.mjs` | 深蹲計次 × 鏡頭高度 × 身體朝向（`vicon_to_mp.py` 第 4 個參數＝朝向角度），見 `../深蹲朝向驗證.md` |
| `EXPECTED.md` | 預期輸出，供比對 |

## 五、資料來源與授權

| 資料集 | 授權 | 取得方式 |
|---|---|---|
| **UI-PRMD**<br>Vakanski, Jun, Paul & Baker (2018), *Data* 3(1):2 | **ODC-PDDL**（公眾領域） | 原網站已隨校方網站遷移失效（實測 301→404），改自 Internet Archive 2025-04-25 存檔取得 |
| **REHAB24-6**<br>Černek et al. (2024) | **CC BY-NC 4.0**（非商業） | Zenodo，DOI `10.5281/zenodo.13305826` |

> ⚠️ REHAB24-6 限非商業與學術／非營利研究用途。本作品為學生競賽作品符合該授權；
> 日後若商業化須另行取得授權。

**資料本身不納入版本控制**：體積逾 200 MB，且其中一份有非商業授權限制。
腳本會自公開來源取得，故重現性不受影響。

## 六、方法上的三個關鍵決定

1. **採真實透視投影，非正交投影。** 本系統部分判定正依賴透視造成的投影變化；
   以正交投影驗證會使結果失去意義。
2. **機位固定。** 縮放與置中依整段影片計算一次，不逐幀重算 ——
   逐幀重算等同自動變焦，真實鏡頭不會如此。
3. **量測值取自引擎內部，而非另寫公式。** `measure.mjs` 以包覆 `spec.evaluate`
   的方式側錄，用的是引擎當下實際採用的正規化尺度與進度值。
   曾因量測條件與程式判定條件不一致而訂錯門檻一次（詳見報告），此後嚴格對齊。

## 七、資料可用性的前置檢驗

`vicon_to_mp.py` 提供 `check_physics()`：檢查深蹲期間雙腳踩地時踝距是否恆定。
**這一步淘汰了同資料集的 Kinect 版本** —— 其座標為相對父關節位移，須經還原，
而還原後踝距在一次動作內由 2.7 擺盪至 113（40 倍），物理上不可能。
Vicon 版同一檢驗之變異係數僅 0.019，故全部改採 Vicon。
