// 2026-10-12 實機回報「網站卡卡的、辨識中也卡」：訓練迴圈每次螢幕更新都叫 MediaPipe 辨識，
// 相機一秒 30 張、螢幕一秒 60～120 次，同一張畫面被重算 2～4 次。frameGate 讓同一張畫面只辨識一次。
import { test, eq, assert } from './harness.js';
import { createFrameGate, STALE_MS } from '../app/core/frameGate.js';

// 假相機：present() ＝ 瀏覽器送上一張新畫面（觸發 requestVideoFrameCallback）
function fakeCam() {
  let cb = null;
  return {
    currentTime: 0,
    requestVideoFrameCallback(f) { cb = f; },
    present() { const f = cb; cb = null; f?.(0, {}); },
  };
}

test('同一張相機畫面只算一次；新畫面到了才再算', () => {
  const g = createFrameGate(); const v = fakeCam();
  assert(g.isNewFrame(v, 0), '第一次一定要辨識');
  eq(g.isNewFrame(v, 8), false);
  eq(g.isNewFrame(v, 16), false);
  v.present();
  assert(g.isNewFrame(v, 33), '相機給了新畫面卻被跳過');
  eq(g.isNewFrame(v, 41), false);
});

test('120Hz 螢幕＋30fps 相機：1 秒 120 次迴圈只辨識 30 次（舊版 120 次）', () => {
  const g = createFrameGate(); const v = fakeCam(); let n = 0;
  for (let i = 0; i < 120; i++) {
    if (i % 4 === 0) v.present();            // 每 4 次螢幕更新相機才換一張
    if (g.isNewFrame(v, i * 1000 / 120)) n++;
  }
  eq(n, 30);
});

test('直播鏡頭的 currentTime 每次都在變也不影響判斷（實測 currentTime 不能拿來分辨新畫面）', () => {
  const g = createFrameGate(); const v = fakeCam();
  g.isNewFrame(v, 0);
  v.currentTime = 0.008;
  eq(g.isNewFrame(v, 8), false);
});

test(`保險：超過 ${STALE_MS}ms 沒等到新畫面通知就改回每次辨識，通知恢復後再省下來`, () => {
  const g = createFrameGate(); const v = fakeCam();
  g.isNewFrame(v, 0);
  eq(g.isNewFrame(v, STALE_MS - 1), false);
  assert(g.isNewFrame(v, STALE_MS), '一直等不到畫面通知時沒有退回照常辨識');
  // 通知斷掉期間每次都辨識（不是每 100ms 才一次）
  assert(g.isNewFrame(v, STALE_MS + 8) && g.isNewFrame(v, STALE_MS + 16), '退回後只偶爾辨識，快速動作會漏看');
  // 通知恢復後又回到只算新畫面
  v.present(); assert(g.isNewFrame(v, STALE_MS + 24), '通知恢復後的新畫面沒辨識');
  eq(g.isNewFrame(v, STALE_MS + 32), false);
});

test('瀏覽器不支援 requestVideoFrameCallback：每次都辨識（＝原本的行為）', () => {
  const g = createFrameGate(); const v = { currentTime: 0 };
  assert(g.isNewFrame(v, 0) && g.isNewFrame(v, 8) && g.isNewFrame(v, 16), '不支援時不該跳過任何一次');
});

test('換了 video 元素或 reset 之後，下一次一定重新辨識', () => {
  const g = createFrameGate(); const a = fakeCam(), b = fakeCam();
  g.isNewFrame(a, 0);
  assert(g.isNewFrame(b, 8), '換了相機畫面卻沿用舊結果');
  g.reset();
  assert(g.isNewFrame(b, 16), 'reset 後仍判成舊畫面');
});
