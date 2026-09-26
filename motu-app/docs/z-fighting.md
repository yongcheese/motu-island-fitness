# 深度衝突（Z-Fighting）規範

這份文件是新增建模時的檢查依據。所有數值的單一來源是
[`src/constants/terrain.ts`](../src/constants/terrain.ts)。

## 為什麼會發生

這個專案沒有 GLTF / GLB / FBX 資產，所有模型都是用 three.js primitive
在程式碼裡組出來的。因此「重複面」「匯出重複材質」這類匯入資產才會有的問題
不存在，實際發生的深度衝突只有兩類：

1. **重複的表面（duplicated surface）**
   兩個不透明、同樣朝上的面，蓋在同一塊區域，距離小於深度緩衝區能分辨的精度。

2. **猜出來的貼地高度（guessed decal height）**
   地面上的東西（踏石、腳步環、選取圈、地毯）各自硬寫一個 y 值，
   而不是去問地面到底多高。

島嶼場景兩者都中過：地面本體頂面在 `y=0.30`，上面又疊了一個頂面在 `y=0.32`
的圓柱（相差 0.02），而踏石被寫死在 `y=0.31`——正好卡在兩者中間，
所以靠海那段在閃爍，內陸那段直接被埋掉看不見。

## 兩條規則

### 規則一：不重複的表面

兩個朝向相同的不透明面，若在平面上互相覆蓋，垂直距離必須大於
`MIN_SURFACE_SEPARATION`（0.05）。

不足時要**改結構**——把兩個面合併成一個 mesh，或刪掉被蓋住的那個。
不可以隨便把其中一個往上挪一點點，也不可以在這裡用 `polygonOffset` 蓋過去。

島嶼的做法可以參考：地面現在是「一個平台面 + 一圈開口側裙 + 一片底面」，
三者邊對邊相接、完全不重疊；原本上層圓柱貢獻的淺綠色，改用頂點顏色
（vertex colors）畫在同一個平台面上——這也是 `SandEdge` 一直以來處理
乾沙→濕沙漸層的做法。

> 相對的，`ISLAND_TERRAIN.mounds` 那個高起的土丘**沒有**被移除：
> 它比平台高 0.1，遠大於門檻，是真正的高低起伏而不是重複面。

### 規則二：貼地物件用共用常數

真正「貼在另一個面上」的東西，本來就該共面，這種情況不能靠改結構解決，
要兩件事一起做：

```tsx
import { DECAL_DEPTH_BIAS, getIslandDecalY } from '../../constants/terrain';

<mesh position={[x, getIslandDecalY(x, z, islandScale), z]} rotation={[-Math.PI / 2, 0, 0]}>
  <circleGeometry args={[0.5, 8]} />
  <meshStandardMaterial color="#a8a29e" {...DECAL_DEPTH_BIAS} />
</mesh>
```

- `getIslandDecalY()` / `SURFACE_DECAL_LIFT` 處理**光照與陰影**那一半
  （剛好貼齊的面在 shadow map 裡一樣會打架，這是 polygonOffset 救不到的）。
- `DECAL_DEPTH_BIAS` 處理**深度**那一半。

`polygonOffset` 只有在這裡是正確工具。**不可以**拿它去掩蓋兩個不小心
放在同一個位置的面——那只會修好眼前這一對，還會讓錯誤在 review 時看不出來。

貼地物件疊貼地物件（例如地毯的內襯疊在外框上），上層要再調更負的
`polygonOffsetUnits`，參考 `FurnitureItem.tsx` 的 `WovenRugModel`。

## 兩個檢查工具

### 靜態檢查（CI 用）

```
npm run audit:zfighting
```

掃描原始碼，找出同一個 component、同一層 `<group>` 裡，
兩個朝上的面距離低於門檻且互相覆蓋的情況。有問題時 exit code 為 1。

門檻依場景的深度精度而定（見腳本內註解）：
島嶼場景 0.05，室內與家具 0.008——因為室內相機近、`near`/`far` 比值好，
1 公分的細節在室內是安全的，用島嶼的門檻去看會誤報一堆正常家具。

它看不到的：`<group>` 的 transform、執行期才決定的位置、領土等級縮放。

### 執行期檢查（真實場景）

開著 app，在瀏覽器 console：

```js
__auditZFighting()
```

會走訪整個 scene graph，解析真正的世界矩陣，列出所有距離低於門檻、
且互相覆蓋的面。已經宣告 `polygonOffset`、`depthWrite: false`
或 `depthTest: false` 的不會被列出來——那些是正確表態過的。

這個才是準的；靜態那個是便宜的把關。

## 相機深度精度

深度精度大致是：

```
resolution ≈ z² × (far − near) / (near × far × 2^bits)
```

`near` 是影響最大的那一項。島嶼場景的 `<Canvas>` 原本沒設 `near`/`far`，
吃到預設的 `0.1 / 2000`（20000:1），在相機大約 50 單位遠的地方，
16-bit 深度緩衝下連 0.4 的間距都分不出來——這是閃爍在部分裝置上特別嚴重的原因。

現在 `Scene.tsx` 明確設成 `near: 0.5, far: 2000`。
`far` 不能再縮，因為遠處海面本身就是 2000×2000 的平面，縮了會裁掉地平線。
`near` 提高到 0.5 是安全的：`CameraController` 的 `minDistance` 是 10。

這是**輔助**修正。幾何上的重複面已經在 `Island.tsx` 合併掉了，
不依賴這個設定。
