// MediaPipe Pose 包裝（瀏覽器專用）。全部資產本地 vendor，可離線。
import { PoseLandmarker, FilesetResolver } from '../../vendor/mediapipe/vision_bundle.mjs';

const WASM_DIR = './vendor/mediapipe/wasm';
const MODEL = {
  lite: './vendor/models/pose_landmarker_lite.task',
  full: './vendor/models/pose_landmarker_full.task',
};

// ---- One-Euro 濾波：抑制 landmark 抖動但保留快速動作（低延遲），大幅降低誤判 ----
function alphaOf(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
// minCutoff/beta 由 1.5/0.3 提高到 2.0/0.5：實測快節奏下濾波會吃掉峰值訊號
// （2.5 rep/s 的峰值 progress 從 0.845 → ~0.94，2 rep/s 以下本來就幾乎無損），
// 代價是靜止殘餘抖動 std 從 0.00112 → 0.00128（+14%，肉眼無感）。
// 再往上（3.0/0.8）靜止時骨架就會開始看得出不穩，故停在這裡。
// visSmooth：visibility 也做 EMA。原本只平滑 x/y，visibility 逐幀跳動會讓骨頭在
// 繪製門檻附近閃爍（Bug2(a) 的視覺成因之一）。
function makePoseSmoother({ minCutoff = 2.0, beta = 0.5, dCutoff = 1.0, visSmooth = 0.35 } = {}) {
  let xs = null, dxs = null, vs = null, tPrev = 0;
  return {
    reset() { xs = null; dxs = null; vs = null; tPrev = 0; },
    apply(pts, tSec) {
      if (!xs) {
        xs = pts.map(p => ({ x: p.x, y: p.y })); dxs = pts.map(() => ({ x: 0, y: 0 }));
        vs = pts.map(p => p.visibility ?? 1); tPrev = tSec;
        return pts;
      }
      let dt = tSec - tPrev; if (!(dt > 1e-4)) dt = 1 / 30; tPrev = tSec;
      return pts.map((p, i) => {
        const o = { x: p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 };
        for (const ax of ['x', 'y']) {
          const dRaw = (p[ax] - xs[i][ax]) / dt;
          const eD = alphaOf(dCutoff, dt); const dHat = eD * dRaw + (1 - eD) * dxs[i][ax];
          dxs[i][ax] = dHat;
          const a = alphaOf(minCutoff + beta * Math.abs(dHat), dt);
          xs[i][ax] = a * p[ax] + (1 - a) * xs[i][ax];
          o[ax] = xs[i][ax];
        }
        vs[i] = visSmooth * o.visibility + (1 - visSmooth) * vs[i];
        o.visibility = vs[i];
        return o;
      });
    },
  };
}

export async function createPose({ model = 'full', numPoses = 1, delegate = 'GPU', smoothing = {} } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_DIR);
  const baseOpts = {
    runningMode: 'VIDEO', numPoses,
    // 0.5：偵測/追蹤更不易斷線（斷線→骨架消失→計次中斷，是實機「抓不到人」主因之一）。
    // 品質把關交給引擎層的 visMin + visStreak + 各動作 gate，這裡以「持續追得到」優先。
    // minTrackingConfidence 0.5→0.3：快速動作有動態模糊，追蹤信心一低就整幀重新偵測（更慢更抖）。
    // 只放寬「追蹤」，presence 維持 0.5 —— 降 presence 會讓人離開畫面時吐出鬼影骨架，反而更糟。
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.3,
  };
  let landmarker;
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL[model] || MODEL.full, delegate }, ...baseOpts,
    });
  } catch (e) {
    // GPU 不可用時退回 CPU
    landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL[model] || MODEL.full, delegate: 'CPU' }, ...baseOpts,
    });
  }

  const smoother = smoothing === false ? null : makePoseSmoother(smoothing || {});

  return {
    /** @returns {Array<{x,y,z,visibility}>|null} 33 點正規化座標（已 One-Euro 平滑） */
    detect(videoEl, tMs) {
      if (!videoEl || videoEl.readyState < 2) return null;
      const res = landmarker.detectForVideo(videoEl, tMs);
      if (!res || !res.landmarks || !res.landmarks.length) { smoother?.reset(); return null; }
      const lm = res.landmarks[0].map(p => ({ x: p.x, y: p.y, z: p.z ?? 0, visibility: p.visibility ?? 1 }));
      const out = smoother ? smoother.apply(lm, tMs / 1000) : lm;
      // 附帶 3D 世界座標（公尺，MediaPipe worldLandmarks）：供 3D avatar / 進階角度計算
      if (res.worldLandmarks && res.worldLandmarks[0]) out.world = res.worldLandmarks[0];
      return out;
    },
    close() { try { landmarker.close(); } catch { /* noop */ } },
  };
}

// 啟動相機並接到指定 <video>。回傳 { video, stream, stop }。
// 失敗時丟出帶有 .name 的錯誤，呼叫端據此顯示明確原因。
export async function startCamera({ video = null, width = 640, height = 480, facingMode = 'user' } = {}) {
  // 安全環境檢查：getUserMedia 只在 https 或 localhost 可用
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new DOMException('需要安全連線（localhost 或 https）', 'SecurityError');
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new DOMException('此瀏覽器不支援相機 API', 'NotSupportedError');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: width }, height: { ideal: height }, aspectRatio: { ideal: width / height }, facingMode }, audio: false,
  });
  // 嘗試把相機變焦調到最廣（對付預設自動放大/置中的鏡頭，如 macOS 人物置中）；不支援則忽略。
  let track = null, zoom = null;
  try {
    track = stream.getVideoTracks && stream.getVideoTracks()[0];
    const caps = track && track.getCapabilities && track.getCapabilities();
    if (caps && caps.zoom && typeof caps.zoom.min === 'number') {
      zoom = { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 1 };
      await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
    }
  } catch { /* 不支援變焦則忽略 */ }
  const v = video || document.createElement('video');
  v.srcObject = stream; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
  try { await v.play(); } catch { /* 自動播放限制：已靜音通常可播，忽略 */ }
  // 等到有實際畫面尺寸（最多 3 秒），確保後續偵測拿得到影像
  if (v.readyState < 2) {
    await new Promise((res) => {
      const done = () => { v.removeEventListener('loadeddata', done); res(); };
      v.addEventListener('loadeddata', done, { once: true });
      setTimeout(done, 3000);
    });
  }
  return { video: v, stream, track, zoom, stop: () => { try { stream.getTracks().forEach(t => t.stop()); } catch { } } };
}
