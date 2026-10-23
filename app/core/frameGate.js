// 同一張相機畫面只辨識一次。
//
// 訓練迴圈跟著螢幕更新（requestAnimationFrame）跑：60Hz 螢幕一秒 60 次、MacBook 的 120Hz 螢幕一秒 120 次，
// 但相機一秒只給 30 張畫面。舊版每次迴圈都叫 MediaPipe 辨識，同一張畫面被重算 2～4 次。
// 2026-10-12 實測（M4 Pro、整合版訓練中）：主執行緒 72% 的時間卡在 MediaPipe 的 glReadPixels
// （等 GPU 算完把結果讀回來），點擊與畫面因此卡頓。
//
// 「是不是新畫面」用 requestVideoFrameCallback 判斷：瀏覽器每把一張新的相機畫面送上畫面就呼叫一次。
// ⚠️ 不能用 video.currentTime：相機是直播串流，currentTime 每次螢幕更新都在走（實測 2 秒內 121 次 rAF、
//    121 個不同的 currentTime，但真正的新畫面只有 60 張），用它判斷等於沒擋。
//
// 保險：瀏覽器不支援 requestVideoFrameCallback，或影片看不見時它不會被呼叫 ——
// 超過 STALE_MS 沒等到新畫面通知，就改回每次都辨識（原本的做法），直到通知恢復，不會讓骨架停住。
export const STALE_MS = 100;

const counters = new WeakMap();

function counterOf(video) {
  let c = counters.get(video);
  if (c) return c;
  c = { frames: 0, supported: typeof video.requestVideoFrameCallback === 'function' };
  counters.set(video, c);
  if (c.supported) {
    const onFrame = () => { c.frames++; video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  }
  return c;
}

export function createFrameGate() {
  let lastVideo = null;
  let lastFrames = -1;
  let changedAt = -Infinity;   // 上一次等到新畫面通知的時間
  return {
    /** 這張畫面還沒辨識過 → true（並記下它）；跟上一次是同一張 → false。`now` 為毫秒時間戳。 */
    isNewFrame(video, now) {
      const c = counterOf(video);
      if (!c.supported) return true;
      if (video !== lastVideo || c.frames !== lastFrames) {
        lastVideo = video; lastFrames = c.frames; changedAt = now;
        return true;
      }
      // 通知斷了：每次都辨識（＝原本的做法），直到通知恢復
      return now - changedAt >= STALE_MS;
    },
    /** 忘掉上一張：下一次一定重新辨識（換人、重開相機時用）。 */
    reset() { lastVideo = null; lastFrames = -1; changedAt = -Infinity; },
  };
}
