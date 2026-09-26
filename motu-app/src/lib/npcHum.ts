/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isSfxMuted, peekSynthAudioContext, primeSynthAudio } from './soundUtils';
import { npcDebug } from './npcRig';

/**
 * 河馬管家一邊巡視一邊低聲哼的歌 —— 全場唯一的一條哼唱聲源。
 *
 * ## 為什麼只有一組節點
 *
 * 「不可重複建立造成聲音疊加」最強的寫法不是小心，而是讓它寫不出來：整個模組只有**一組**振盪器
 * 與增益，唱哪一個音是改那一組的頻率與包絡，而不是每個音 new 一顆 oscillator。所以不論幾位
 * 管家、幾次掛載、狀態切換得多頻繁，喇叭裡最多就是這一個聲音。第二位想唱的人拿不到擁有權
 * （{@link humTick} 的 owner），直接被忽略。
 *
 * ## 為什麼是「往前看一小段」而不是整句排好
 *
 * 音符是在每幀的 tick 裡、只往前排 {@link LOOKAHEAD} 秒。整句一次排進 AudioContext 的話，
 * 頁面一被切到背景（requestAnimationFrame 停了），那一句還會自己唱完 —— 而且回來的時候時間
 * 軸已經走過頭，下一句會被排到過去、一次擠出來。只排一小段，畫面停了、聲音最多再唱完當下那
 * 一個音就停；回來時如果游標已經落後，就從「現在」重新起句，不補唱。
 *
 * ## 音色
 *
 * 三角波 + 同頻正弦，過一個 700Hz 的低通 —— 閉著嘴的「嗯」大部分能量就在基頻和前幾個泛音，
 * 高頻切掉之後圓潤、不尖。音域壓在 A2–B3（110–247Hz），低男聲的區域。一點點 5Hz 顫音，
 * 每個音之間用很短的滑音接起來，換句時換氣停頓 1.2–2.4 秒。
 *
 * 旋律是原創的五句，D 大調五聲音階，每句約兩小節，隨機輪替、不連續重複同一句。
 */

/** [MIDI 音高, 拍數]。null 音高是休止。 */
type Note = readonly [number | null, number];

const PHRASES: readonly (readonly Note[])[] = [
  [[50, 1], [54, 0.5], [57, 1.5], [59, 0.5], [57, 0.5], [54, 1], [52, 1], [50, 2]],
  [[45, 0.5], [50, 0.5], [52, 1], [54, 1.5], [52, 0.5], [50, 1], [47, 1], [50, 2.5]],
  [[57, 1], [54, 0.5], [52, 0.5], [50, 1], [null, 0.5], [52, 0.5], [54, 1.5], [55, 0.5], [54, 1], [52, 2]],
  [[50, 0.5], [50, 0.5], [54, 1], [52, 0.5], [50, 0.5], [47, 1], [45, 1], [47, 0.5], [50, 0.5], [52, 1], [50, 2]],
  [[54, 1.5], [57, 0.5], [59, 1], [57, 1], [54, 1], [55, 0.5], [54, 0.5], [52, 2]],
];

/** 一拍幾秒。100 BPM：散步的速度，不是趕路的速度。 */
const BEAT = 0.6;
/** 往前排多遠，秒。 */
const LOOKAHEAD = 0.3;
/**
 * 整條哼唱的最大音量（在距離衰減與狀態淡入淡出之前）。
 *
 * 參考值：UI 點擊 0.4、腳步 0.35、門 0.26。低頻的正弦類音色聽起來比同振幅的點擊聲小很多，
 * 0.07 在耳機上是「聽得到在哼、但要專心才聽得清旋律」—— 背景音樂永遠在它上面。
 */
const PEAK = 0.07;

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

interface Voice {
  ctx: AudioContext;
  osc: OscillatorNode;
  body: OscillatorNode;
  lfo: OscillatorNode;
  env: GainNode;
  state: GainNode;
  space: GainNode;
  pan: StereoPannerNode;
}

let voice: Voice | null = null;
let owner: string | null = null;

/** 下一個音要從 AudioContext 的哪一刻開始。 */
let cursor = 0;
let phraseIndex = -1;
let noteIndex = 0;
let lastPhrase = -1;
/** 狀態增益目前在往哪個值走，以及是否已經安靜到可以停止排新音。 */
let stateTarget = 0;
let silentSince = 0;

function buildVoice(ctx: AudioContext): Voice {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  const body = ctx.createOscillator();
  body.type = 'sine';
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 5.1;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 7; // cents
  lfo.connect(lfoDepth);
  lfoDepth.connect(osc.detune);
  lfoDepth.connect(body.detune);

  const bodyLevel = ctx.createGain();
  bodyLevel.gain.value = 0.55;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 700;
  lp.Q.value = 0.6;

  const env = ctx.createGain();
  env.gain.value = 0;
  const state = ctx.createGain();
  state.gain.value = 0;
  const space = ctx.createGain();
  space.gain.value = 0;
  const pan = ctx.createStereoPanner();

  osc.connect(lp);
  body.connect(bodyLevel);
  bodyLevel.connect(lp);
  lp.connect(env);
  env.connect(state);
  state.connect(space);
  space.connect(pan);
  pan.connect(ctx.destination);

  const now = ctx.currentTime;
  osc.frequency.setValueAtTime(midiHz(50), now);
  body.frequency.setValueAtTime(midiHz(50), now);
  osc.start(now);
  body.start(now);
  lfo.start(now);
  // 給驗證腳本：哪一個聲道節點是哼唱（遊戲裡其他合成音也會建 panner）。另外記建了幾次，重建
  // 太頻繁就代表拆掉又重建在來回抖。
  npcDebug.humPan = pan;
  npcDebug.humBuilds = ((npcDebug.humBuilds as number) || 0) + 1;
  return { ctx, osc, body, lfo, env, state, space, pan };
}

/** 立刻拆掉整條聲音。不淡出 —— 這條路是給「切到背景 / 靜音 / 卸載」的，那三種都要馬上安靜。 */
function teardown(): void {
  if (!voice) return;
  const v = voice;
  voice = null;
  npcDebug.humPan = null;
  try {
    const now = v.ctx.currentTime;
    v.state.gain.cancelScheduledValues(now);
    v.state.gain.setValueAtTime(0, now);
    v.osc.stop();
    v.body.stop();
    v.lfo.stop();
    v.pan.disconnect();
  } catch (_) { /* already stopped */ }
  phraseIndex = -1;
  noteIndex = 0;
  stateTarget = 0;
}

function nextPhrase(): number {
  let i = Math.floor(Math.random() * PHRASES.length);
  if (i === lastPhrase) i = (i + 1 + Math.floor(Math.random() * (PHRASES.length - 1))) % PHRASES.length;
  lastPhrase = i;
  return i;
}

/** 把游標之後、LOOKAHEAD 之內的音排進去。 */
function schedule(v: Voice): void {
  const now = v.ctx.currentTime;
  // 落後了（剛從背景回來、或剛淡入）：從現在起句，不補唱。
  if (cursor < now) {
    cursor = now + 0.08;
    phraseIndex = -1;
  }
  while (cursor < now + LOOKAHEAD) {
    if (phraseIndex < 0) {
      phraseIndex = nextPhrase();
      noteIndex = 0;
    }
    const phrase = PHRASES[phraseIndex];
    const [pitch, beats] = phrase[noteIndex];
    const t0 = cursor;
    const dur = beats * BEAT;
    const nextNote = phrase[noteIndex + 1];
    const lastOfPhrase = !nextNote;

    if (pitch !== null) {
      const hz = midiHz(pitch);
      // 很短的滑音接到下一個音：哼歌的人不會把每個音切開。
      v.osc.frequency.setTargetAtTime(hz, t0, 0.025);
      v.body.frequency.setTargetAtTime(hz, t0, 0.025);
      v.env.gain.setTargetAtTime(1, t0, 0.045);
      v.env.gain.setTargetAtTime(0.78, t0 + 0.14, 0.25);
      if (lastOfPhrase || nextNote[0] === null) {
        v.env.gain.setTargetAtTime(0, t0 + dur - 0.16, 0.07);
      } else {
        // 同一口氣裡的下一個音：只沉一下，「嗯—嗯」而不是「嗯。嗯。」
        v.env.gain.setTargetAtTime(0.5, t0 + dur - 0.07, 0.03);
      }
    }

    cursor += dur;
    noteIndex++;
    if (lastOfPhrase) {
      // 換氣。
      cursor += 1.2 + Math.random() * 1.2;
      phraseIndex = -1;
    }
  }
}

let hideListening = false;
function onVisibility() {
  if (document.hidden) teardown();
}
let gestureListening = false;
function onFirstGesture() {
  primeSynthAudio();
  removeGestureListeners();
}
function removeGestureListeners() {
  if (!gestureListening) return;
  gestureListening = false;
  window.removeEventListener('pointerdown', onFirstGesture);
  window.removeEventListener('keydown', onFirstGesture);
  window.removeEventListener('touchstart', onFirstGesture);
}

export interface HumFrame {
  /** 目標音量 0..1（狀態決定：走路 1、轉身 0.45、走向設施逐漸降低、操作設施 0）。 */
  level: number;
  /** 淡到那個音量要多久，秒。 */
  fade: number;
  /** 聲源與聽者的水平距離，世界單位。 */
  distance: number;
  /** 左右聲道，-1..1。 */
  pan: number;
  /** 聽者是否在同一個場景裡（玩家在屋外時管家的 Canvas 仍會偶爾 tick）。 */
  audible: boolean;
}

/**
 * 每幀由唱歌的那位呼叫一次。
 *
 * 瀏覽器還不准出聲時（沒有使用者手勢），這裡什麼都不建、也不報錯；管家照樣走他的路。玩家
 * 第一次點擊或按鍵之後 context 解鎖，下一幀自然就開始哼。靜音、分頁在背景、或聽者不在屋裡
 * 時整條聲音拆掉，而不是調小。
 */
export function humTick(who: string, frame: HumFrame): void {
  if (owner !== null && owner !== who) return;
  if (owner === null) {
    owner = who;
    if (!hideListening && typeof document !== 'undefined') {
      hideListening = true;
      document.addEventListener('visibilitychange', onVisibility);
    }
    if (!gestureListening && typeof window !== 'undefined' && !peekSynthAudioContext()) {
      gestureListening = true;
      window.addEventListener('pointerdown', onFirstGesture, { passive: true });
      window.addEventListener('keydown', onFirstGesture);
      window.addEventListener('touchstart', onFirstGesture, { passive: true });
    }
  }

  const ctx = peekSynthAudioContext();
  if (
    !frame.audible || isSfxMuted() || !ctx || ctx.state !== 'running'
    || (typeof document !== 'undefined' && document.hidden)
  ) {
    teardown();
    return;
  }

  const wantsSound = frame.level > 0.001;
  if (!voice) {
    if (!wantsSound) return;
    voice = buildVoice(ctx);
    cursor = 0;
    stateTarget = 0;
  }
  const v = voice;
  const now = ctx.currentTime;

  // 距離衰減與左右：每幀跟著走，時間常數很短，玩家轉鏡頭時不會有拉鍊聲。
  const d = Math.max(0, frame.distance - 1.5);
  const falloff = 1 / (1 + (d / 3.2) * (d / 3.2));
  v.space.gain.setTargetAtTime(PEAK * falloff, now, 0.06);
  v.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, frame.pan)), now, 0.08);

  const target = Math.max(0, Math.min(1, frame.level));
  if (Math.abs(target - stateTarget) > 0.01) {
    stateTarget = target;
    // setTargetAtTime 走到 95% 大約要 3 個時間常數。
    v.state.gain.setTargetAtTime(target, now, Math.max(0.02, frame.fade / 3));
    if (target > 0.001) silentSince = 0;
  }

  if (stateTarget <= 0.001) {
    if (silentSince === 0) silentSince = now;
    // 已經淡完了：停止排新音，並把排好的音收掉。下次再淡入時會從新的一句開始。
    if (now - silentSince > Math.max(0.2, frame.fade)) {
      v.env.gain.cancelScheduledValues(now);
      v.env.gain.setTargetAtTime(0, now, 0.05);
      v.osc.frequency.cancelScheduledValues(now);
      v.body.frequency.cancelScheduledValues(now);
      phraseIndex = -1;
      cursor = 0;
    }
    return;
  }
  schedule(v);
}

/** 唱歌的那位卸載了：交出擁有權並立刻安靜。 */
export function humRelease(who: string): void {
  if (owner !== who) return;
  owner = null;
  teardown();
  removeGestureListeners();
  if (hideListening) {
    hideListening = false;
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

/** 給驗證腳本用：現在喇叭裡有沒有這條聲音、目前狀態增益目標是多少。 */
export function humDebugState(): { active: boolean; owner: string | null; level: number } {
  return { active: voice !== null, owner, level: stateTarget };
}
