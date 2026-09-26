// 合體第二階段整合 Slice 1：MediaPipe 資產（wasm、模型）的根目錄可由宿主注入。
//
// 舊版 :8080 的頁面就在專案根目錄，./vendor 一定對；整合版的頁面網址由遊戲端決定，
// 若日後掛在子路徑下，寫死的 ./vendor 會悄悄 404，相機畫面只會卡在「載入中」。
import { test, eq } from './harness.js';
import { poseAssetPaths } from '../app/core/pose.js';

test('pose 資產: 預設根目錄仍是 ./vendor（舊版行為不變）', () => {
  const a = poseAssetPaths();
  eq(a.wasm, './vendor/mediapipe/wasm');
  eq(a.model.full, './vendor/models/pose_landmarker_full.task');
  eq(a.model.lite, './vendor/models/pose_landmarker_lite.task');
});

test('pose 資產: 注入 /vendor 時全部改用站台根目錄', () => {
  const a = poseAssetPaths('/vendor');
  eq(a.wasm, '/vendor/mediapipe/wasm');
  eq(a.model.full, '/vendor/models/pose_landmarker_full.task');
});

test('pose 資產: 結尾斜線不會變成雙斜線', () => {
  eq(poseAssetPaths('/fit/vendor/').wasm, '/fit/vendor/mediapipe/wasm');
});

test('pose 資產: 空字串邊界退回預設，不產生 /mediapipe 這種站台根路徑', () => {
  eq(poseAssetPaths('').wasm, './vendor/mediapipe/wasm');
});
