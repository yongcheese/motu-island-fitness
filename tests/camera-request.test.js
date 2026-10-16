// 10-16 鏡頭視野修正：先要鏡頭原生 4:3、不准瀏覽器裁切；拿不到才退回舊請求。
// 實機量測見 app/core/pose.js cameraRequests 的註解。
import { test, eq, assert } from './harness.js';
import { cameraRequests, openCameraStream } from '../app/core/pose.js';

const err = (name) => Object.assign(new Error(name), { name });

test('鏡頭請求: 第一順位是原生橫向 4:3、禁止裁切', () => {
  const [first] = cameraRequests({ width: 1280, height: 960 });
  eq(first.resizeMode.exact, 'none', '不准 crop-and-scale');
  assert(first.aspectRatio.min <= 1760 / 1328 && 1760 / 1328 <= first.aspectRatio.max, 'M4 Pro 的 1760×1328 要在範圍內');
  assert(first.aspectRatio.min <= 4 / 3 && 4 / 3 <= first.aspectRatio.max, '標準 4:3 要在範圍內');
  assert(!(first.aspectRatio.min <= 16 / 9 && 16 / 9 <= first.aspectRatio.max), '16:9 不可通過');
  assert(!(first.aspectRatio.min <= 1328 / 1760), '直立模式不可通過（判定門檻在橫向 4:3 校準）');
  eq(first.facingMode, 'user');
});

test('鏡頭請求: 第二順位與修正前完全相同', () => {
  const [, fallback] = cameraRequests({ width: 1280, height: 960 });
  eq(JSON.stringify(fallback), JSON.stringify({ width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 1280 / 960 }, facingMode: 'user' }));
});

test('鏡頭請求: 第一順位成功就不再嘗試', async () => {
  const calls = [];
  const s = await openCameraStream(async (c) => { calls.push(c); return 'stream'; }, { width: 1280, height: 960 });
  eq(s, 'stream');
  eq(calls.length, 1);
  eq(calls[0].audio, false);
});

test('鏡頭請求: 鏡頭沒有原生 4:3（OverconstrainedError）→ 退回舊請求', async () => {
  const calls = [];
  const s = await openCameraStream(async (c) => {
    calls.push(c);
    if (calls.length === 1) throw err('OverconstrainedError');
    return 'fallback-stream';
  }, { width: 1280, height: 960 });
  eq(s, 'fallback-stream');
  eq(calls.length, 2);
  eq(calls[1].video.height.ideal, 960);
});

test('鏡頭請求: 權限被拒不換請求，直接丟出原錯誤', async () => {
  let n = 0, caught = null;
  try { await openCameraStream(async () => { n++; throw err('NotAllowedError'); }, {}); }
  catch (e) { caught = e; }
  eq(n, 1);
  eq(caught && caught.name, 'NotAllowedError');
});

test('鏡頭請求: 兩個都失敗時丟出最後一個錯誤', async () => {
  let caught = null;
  try { await openCameraStream(async () => { throw err('OverconstrainedError'); }, {}); }
  catch (e) { caught = e; }
  eq(caught && caught.name, 'OverconstrainedError');
});
