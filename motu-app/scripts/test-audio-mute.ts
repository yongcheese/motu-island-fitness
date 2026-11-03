/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 全部靜音 —— 靜音必須是「整頁一份」，不是「剛好被 MusicPlayer 匯入的那一份模組」才有。
 *
 * Run with `npm run test:audio-mute`. Same tsx-script style as the other `test:*` checks.
 *
 * ## What it is guarding
 *
 * The report was 「已經開啟靜音，點下方導覽列的按鈕還是有聲音」. Every playback path in
 * lib/soundUtils.ts already asked the mute — and on a clean page load the nav really is silent —
 * but the answer lived in a bare module-level `let`, set once by MusicPlayer's effect. Under the dev
 * server a hot update can hand a component (NavBar, after an edit) a SECOND instance of soundUtils
 * (`soundUtils.ts?t=…`), whose flag starts at `false` and is never told otherwise. Measured on the
 * running island with 全部靜音 on: that second instance's `playSound(CLICK)` opened a brand-new
 * AudioContext and started an oscillator, while the original instance reported muted.
 *
 * §1 reproduces that exactly — a second instance, forced with a query string, plays while the first
 * instance is the one that was muted — and fails on the old code. §2 checks unmute comes back through
 * the same path, §3 that the BGM engine started by one instance is the one another instance stops.
 */

/* ---------------------------------------------------------------------------------------------- *
 * A Web Audio stand-in that counts what would have been audible.
 * ---------------------------------------------------------------------------------------------- */

const counts = { contexts: 0, sourcesStarted: 0, mediaPlays: 0 };

/** A node / AudioParam that accepts anything — the sounds only need it not to throw. */
function anyNode(): any {
  const fn = function () { /* callable */ };
  return new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'start') return () => { counts.sourcesStarted++; };
      if (prop === 'value' || prop === 'currentTime') return 0;
      if (prop === Symbol.toPrimitive) return () => 0;
      return anyNode();
    },
    set: () => true,
    apply: () => anyNode(),
  });
}

class FakeAudioContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = anyNode();
  constructor() { counts.contexts++; }
  resume() { return Promise.resolve(); }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(Math.max(1, Math.floor(length)));
    return { length: data.length, sampleRate, duration: data.length / sampleRate, getChannelData: () => data };
  }
}
// Every other create*() — oscillators, gains, filters, panners, convolvers — is an anyNode().
const fakeProto = FakeAudioContext.prototype as any;
for (const name of [
  'createOscillator', 'createGain', 'createBiquadFilter', 'createBufferSource', 'createStereoPanner',
  'createConvolver', 'createDynamicsCompressor', 'createDelay', 'createWaveShaper', 'createPanner',
  'createChannelMerger', 'createChannelSplitter', 'createConstantSource',
]) {
  fakeProto[name] = () => anyNode();
}

class FakeAudio {
  currentTime = 0;
  volume = 1;
  constructor(public src: string) {}
  play() { counts.mediaPlays++; return Promise.resolve(); }
}

(globalThis as any).window = globalThis;
(globalThis as any).AudioContext = FakeAudioContext;
(globalThis as any).Audio = FakeAudio;

/* ---------------------------------------------------------------------------------------------- */

let failures = 0;
let checks = 0;

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (condition) {
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  }
}

/** Sounds started (synth + media) while running `play`. */
function audibleDuring(play: () => void): number {
  const before = counts.sourcesStarted + counts.mediaPlays;
  play();
  return counts.sourcesStarted + counts.mediaPlays - before;
}

/**
 * The SECOND instances, the way the dev server handed one to a hot-updated component. Non-literal
 * specifiers so tsc does not try to resolve the query; the cast restores the real module type.
 */
const COPY_SOUND = '../src/lib/soundUtils.ts?instance=hmr-copy';
const COPY_MUSIC = '../src/lib/ambientMusic.ts?instance=hmr-copy';

async function main(): Promise<void> {
  // THE MUTED SIDE — imported exactly as MusicPlayer imports it.
  const original = await import('../src/lib/soundUtils');
  const music = await import('../src/lib/ambientMusic');
  const copy = (await import(COPY_SOUND)) as typeof import('../src/lib/soundUtils');
  const musicCopy = (await import(COPY_MUSIC)) as typeof import('../src/lib/ambientMusic');

  // =============================================================================================
  // §1 — muted once, muted everywhere.
  // =============================================================================================
  console.log('\n=== §1 the mute MusicPlayer sets is the mute every instance plays under ===');

  ok('the copy really is a second module instance (the condition the bug needed)',
    copy !== original && copy.playSound !== original.playSound);

  // What MusicPlayer does when settings.isMuted is true.
  original.setSfxMuted(true);
  original.setAmbienceMuted(true);

  ok('the copy reads the mute the original was given', copy.isSfxMuted() === true);
  ok('the copy reads the ambience as silenced too', copy.ambienceScale() === 0,
    `ambienceScale() = ${copy.ambienceScale()}`);

  const muted = [
    ['playSound(CLICK) — the NavBar tap', () => copy.playSound(copy.SoundEffect.CLICK)],
    ['playSound(REWARD)', () => copy.playSound(copy.SoundEffect.REWARD)],
    ['playSound(MYTHIC_FANFARE)', () => copy.playSound(copy.SoundEffect.MYTHIC_FANFARE)],
    ['playSound(<url>) — the HTMLAudioElement branch', () => copy.playSound('/custom.mp3')],
    ['playDoorOpen', () => copy.playDoorOpen()],
    ['playFootstepThud', () => copy.playFootstepThud('grass')],
    ['startBeachSurfAmbience', () => copy.startBeachSurfAmbience()],
    ['startSwimAmbience', () => copy.startSwimAmbience()],
    ['playWaterEntrySplash', () => copy.playWaterEntrySplash()],
  ] as const;
  for (const [name, play] of muted) {
    const n = audibleDuring(play);
    ok(`muted: ${name} from the copy makes no sound`, n === 0, `${n} source(s) started`);
  }
  for (const [name, play] of [
    ['playSound(CLICK)', () => original.playSound(original.SoundEffect.CLICK)],
    ['playSound(REWARD)', () => original.playSound(original.SoundEffect.REWARD)],
  ] as const) {
    const n = audibleDuring(play);
    ok(`muted: ${name} from the original makes no sound`, n === 0, `${n} source(s) started`);
  }

  // =============================================================================================
  // §2 — unmuting comes back through the same path, and there is only one AudioContext.
  // =============================================================================================
  console.log('\n=== §2 unmute restores sound, on one shared AudioContext ===');

  original.setSfxMuted(false);
  original.setAmbienceMuted(false);
  ok('the copy sees the unmute', copy.isSfxMuted() === false && copy.ambienceScale() > 0);
  ok('unmuted: playSound(CLICK) from the copy is audible again',
    audibleDuring(() => copy.playSound(copy.SoundEffect.CLICK)) > 0);
  ok('unmuted: playSound(CLICK) from the original is audible again',
    audibleDuring(() => original.playSound(original.SoundEffect.CLICK)) > 0);
  ok('both instances play through the SAME AudioContext',
    copy.getSynthAudioContext() === original.getSynthAudioContext() && counts.contexts === 1,
    `${counts.contexts} AudioContext(s) constructed`);

  // Re-mute and re-check, so the toggle is proven in both directions.
  original.setSfxMuted(true);
  ok('re-muted: playSound(CLICK) from the copy is silent again',
    audibleDuring(() => copy.playSound(copy.SoundEffect.CLICK)) === 0);
  original.setSfxMuted(false);

  // =============================================================================================
  // §3 — one BGM engine, whichever instance touches it.
  // =============================================================================================
  console.log('\n=== §3 the BGM one instance started is the one another instance stops ===');

  ok('the music copy really is a second module instance', musicCopy !== music);

  const started = audibleDuring(() => music.startAmbientMusic('island-dawn', 0.5));
  ok('the original starts the mood', started > 0, `${started} source(s) started`);

  const second = audibleDuring(() => musicCopy.startAmbientMusic('island-dawn', 0.5));
  ok('the copy asked for the same mood does NOT start a second BGM over it', second === 0,
    `${second} source(s) started`);

  musicCopy.stopAmbientMusic();
  const restarted = audibleDuring(() => music.startAmbientMusic('island-dawn', 0.5));
  ok('the copy\'s stop reached the mood the original started (it builds afresh afterwards)',
    restarted > 0, `${restarted} source(s) started`);
  music.stopAmbientMusic();

  console.log(`\n${checks - failures}/${checks} checks passed`);
  // The stopped engine leaves a teardown timer behind; nothing else is pending.
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
