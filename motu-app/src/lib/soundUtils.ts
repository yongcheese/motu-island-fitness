/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { sharedSingleton } from './sharedRegistry';

// These used to point at cdn.pixabay.com, which returns 403 on this network
// (verified directly, including pixabay.com's own homepage) - so every
// playSound(SoundEffect.X) call was silently failing the same way
// FOOTSTEP_*/SWIM used to. Now backed by the local Web Audio synthesis below
// (see playUiClick/playUiTick/playUiSuccess/playUiReward/playPetBark), same
// fix already applied to footsteps/swim - no network dependency at all.
export enum SoundEffect {
  CLICK = 'synth:click',
  SUCCESS = 'synth:success',
  REWARD = 'synth:reward',
  /** 每日登入 領取 — coins landing in the balance. See {@link playUiCoin}. */
  COIN = 'synth:coin',
  BARK = 'synth:bark',
  TICK = 'synth:tick',
  // The 稀有度 purchase ladder (constants/rarityFx.ts). Four sounds rather than one played
  // louder: a rarer item should sound like MORE MUSIC, not like the same chime turned up.
  RARE_REVEAL = 'synth:rare-reveal',
  EPIC_REVEAL = 'synth:epic-reveal',
  LEGENDARY_FANFARE = 'synth:legendary-fanfare',
  MYTHIC_FANFARE = 'synth:mythic-fanfare',
}

/**
 * EVERYTHING THE MUTE DEPENDS ON, ONE COPY PER PAGE.
 *
 * The mute is pushed into this module once, by MusicPlayer's effect, and only when `isMuted`
 * changes. A bare `let sfxMuted` therefore only silences the module instance MusicPlayer happened
 * to import — and under the dev server that is not guaranteed to be the only one (see
 * lib/sharedRegistry.ts): after a hot update, a component such as NavBar can be re-executed
 * against a fresh `soundUtils.ts?t=…`, whose flag starts at `false` and is never told otherwise,
 * and which opens its own second AudioContext the first time it plays. Measured on the running
 * island: with 全部靜音 on, a second instance's `playSound(CLICK)` created a new AudioContext and
 * started an oscillator, while the original instance correctly reported muted. That is the
 * 「靜音了，點下方導覽列還是有聲音」 shape exactly — the mute was set, just not in the copy that
 * played the sound.
 *
 * Anchored on the page through sharedSingleton, so every instance reads the same mute, the same
 * 海浪環境音 volume and the same AudioContext. A production bundle only ever has one instance;
 * this makes the dev server agree with it. Bump the key if the shape changes.
 */
const audio = sharedSingleton('audio.mute.v1', () => ({
  sfxMuted: false,
  ambienceMuted: false,
  /** Player's 海浪環境音 setting, 0..1. `setAmbienceVolume` is the single writer. */
  ambienceVolume: 1,
  ctx: null as AudioContext | null,
}));

/**
 * Whether the player has muted the game, pushed here from the one place that already owns
 * "settings → audio" (components/UI/MusicPlayer.tsx).
 *
 * Necessary because {@link playSound} has never read `settings.isMuted` at all — the flag only
 * ever reached the background-music manager, so every UI blip has always played through a mute.
 * That is survivable for a 45ms click and not survivable for the 2.5-second brass fanfare below,
 * which is by a wide margin the loudest and longest sound in the game: a player who has muted
 * the game and then buys a 神話 item would get exactly the thing they turned off.
 *
 * It WAS scoped to the fanfares, on the reasoning that silencing every blip was a behaviour
 * change owed its own pass. This is that pass, and the reason is the one the scoping note did
 * not anticipate: the sounds it left through are not all 45ms blips. Footsteps fire continuously
 * for as long as the player walks, and the doors, the pet and the garden props all answer to
 * things a player does constantly. A muted game that still taps, barks and slides doors is a
 * mute button that did not work, which is exactly what players reported — and the button's own
 * label promises 全部靜音. Everything one-shot now goes through {@link sfxContext}; the
 * continuous ambiences answer to their own gate (see THE AMBIENCE GATE below), which the same
 * setting drives via setAmbienceMuted.
 *
 * Lives in {@link audio} below rather than in a bare `let`, like every other piece of state the
 * mute depends on — see there for why.
 */
export const setSfxMuted = (muted: boolean) => {
  audio.sfxMuted = muted;
};

/**
 * 讀回靜音狀態。給「不是一次性、而是自己排程的聲音」用 —— 河馬管家的哼唱（lib/npcHum.ts）
 * 每幀都要問一次，而它不能走 sfxContext()，因為它要的是「靜音時把整條聲音拆掉」而不只是
 * 「這一聲不出」。
 */
export const isSfxMuted = () => audio.sfxMuted;

/**
 * The AudioContext a ONE-SHOT sound effect may use — null while the game is muted.
 *
 * The single choke point for "may this effect make a sound at all". Every synthesized one-shot
 * already began with `const ctx = getSynthAudioContext(); if (!ctx) return;`, so routing them
 * through this adds the mute to all of them without a second early-return per function that
 * someone has to remember to copy into the next sound they write.
 *
 * NOT for the continuous ambiences (surf, swim wash) or for the splashes that belong to them:
 * those are scaled by 海浪環境音 as well as by the mute, and `ambienceScale()` is where both of
 * those questions are already answered together.
 */
function sfxContext(): AudioContext | null {
  return audio.sfxMuted ? null : getSynthAudioContext();
}

const audioPool: { [key: string]: HTMLAudioElement } = {};

/**
 * Plays a sound effect. SoundEffect enum values are routed to the local Web
 * Audio synthesizers below; any other string is treated as a playable URL
 * (kept for one-off custom sounds outside the enum).
 * @param effect The URL or SoundEffect enum value to play
 * @param volume Volume from 0 to 1
 */
export const playSound = (effect: SoundEffect | string, volume = 0.4) => {
  switch (effect) {
    case SoundEffect.CLICK: playUiClick(volume); return;
    case SoundEffect.TICK: playUiTick(volume); return;
    case SoundEffect.SUCCESS: playUiSuccess(volume); return;
    case SoundEffect.REWARD: playUiReward(volume); return;
    case SoundEffect.COIN: playUiCoin(volume); return;
    case SoundEffect.BARK: playPetBark(volume); return;
    case SoundEffect.RARE_REVEAL: playRareReveal(volume); return;
    case SoundEffect.EPIC_REVEAL: playEpicReveal(volume); return;
    case SoundEffect.LEGENDARY_FANFARE: playLegendaryFanfare(volume); return;
    case SoundEffect.MYTHIC_FANFARE: playMythicFanfare(volume); return;
  }

  // The URL branch answers to the mute too. The enum branch above is already covered - every
  // synthesizer it reaches goes through sfxContext() - but this one bypasses Web Audio entirely,
  // so it needs the question asked here or a custom sound would be the one thing left audible.
  if (audio.sfxMuted) return;

  try {
    let audio: HTMLAudioElement;
    if (audioPool[effect]) {
      audio = audioPool[effect];
      audio.currentTime = 0;
    } else {
      audio = new Audio(effect);
      audioPool[effect] = audio;
    }
    audio.volume = volume;
    audio.play().catch(e => {
      // Ignore "user must interact" errors
      if (e.name !== 'NotAllowedError') {
        console.log('Audio play failed', e);
      }
    });
  } catch (e) {
    console.error('Sound error', e);
  }
};

// --- Synthesized movement audio (Web Audio, no network dependency) ---
// The free CDN clips SoundEffect.FOOTSTEP_*/SWIM point at (cdn.pixabay.com) return
// 403 on a lot of networks/firewalls, which silently kills the sound since
// HTMLAudioElement.play() just rejects and gets swallowed. These fire constantly
// during normal play, so instead of depending on those remote files, synthesize
// them locally with a single shared AudioContext.

export function getSynthAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audio.ctx) {
    audio.ctx = new AudioContextClass();
  }
  if (audio.ctx.state === 'suspended') {
    audio.ctx.resume().catch(() => {});
  }
  return audio.ctx;
}

/**
 * 已經存在的共用 AudioContext，**不會**替你建一個，也不會去 resume。
 *
 * 給「沒有使用者手勢也會一直被呼叫」的聲音用（NPC 的哼唱與挖土聲）：它們每幀都在問，而在
 * 玩家第一次點擊之前就 new 一個 AudioContext，只會換到瀏覽器一句 autoplay 警告和一個永遠
 * suspended 的 context。等玩家自己點過（MusicPlayer / Avatar 的 primeSynthAudio）之後，這裡就
 * 會拿到那個已經解鎖的 context。
 */
export function peekSynthAudioContext(): AudioContext | null {
  return audio.ctx;
}

/** Call from a real user-gesture handler (click/keydown) so the AudioContext isn't blocked by autoplay policy. */
export const primeSynthAudio = () => {
  getSynthAudioContext();
};

// --- 兔子園丁的挖土聲 ---------------------------------------------------------------
//
// 兩個聲音，都刻意很輕：一聲「鏟子吃進土裡」和一串「土塊落地」。它們是場景的質地，不是事件
// 提示 —— 蓋過背景音樂就錯了，所以音量由呼叫端再乘上距離衰減（Three/RabbitGardener.tsx）。
// 只在 AudioContext 已經被玩家解鎖時才出聲（peekSynthAudioContext），靜音時一律不出聲。

let digNoiseBuffer: AudioBuffer | null = null;

function digNoise(ctx: AudioContext): AudioBuffer {
  if (!digNoiseBuffer || digNoiseBuffer.sampleRate !== ctx.sampleRate) {
    const length = Math.floor(ctx.sampleRate * 0.3);
    digNoiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = digNoiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }
  return digNoiseBuffer;
}

/** 可以出聲的 context：已解鎖、正在跑、沒有靜音。三者缺一就是 null。 */
function unlockedSfxContext(): AudioContext | null {
  if (audio.sfxMuted) return null;
  const ctx = audio.ctx;
  return ctx && ctx.state === 'running' ? ctx : null;
}

function noiseGrain(
  ctx: AudioContext, at: number, duration: number, freq: number, q: number, level: number,
) {
  const src = ctx.createBufferSource();
  src.buffer = digNoise(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.linearRampToValueAtTime(level, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  src.connect(bp);
  bp.connect(lp);
  lp.connect(g);
  g.connect(ctx.destination);
  src.start(at, Math.random() * 0.05, duration + 0.02);
}

/** 鏟子插進土裡：一記悶悶的低頻加一小段沙沙的碎土聲。 */
export const playSpadeDig = (volume = 0.12) => {
  const ctx = unlockedSfxContext();
  if (!ctx || volume <= 0.0005) return;
  try {
    const now = ctx.currentTime + 0.005;
    const thud = ctx.createOscillator();
    thud.type = 'sine';
    thud.frequency.setValueAtTime(105, now);
    thud.frequency.exponentialRampToValueAtTime(58, now + 0.1);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.linearRampToValueAtTime(volume * 0.8, now + 0.008);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    thud.connect(tg);
    tg.connect(ctx.destination);
    thud.start(now);
    thud.stop(now + 0.15);
    noiseGrain(ctx, now, 0.16, 620, 0.8, volume * 0.9);
    noiseGrain(ctx, now + 0.05, 0.14, 360, 0.9, volume * 0.55);
  } catch (_) { /* Web Audio error — swallow */ }
};

/** 被拋出去的土塊落地：三四顆很小的沙沙聲，間隔不規則。 */
export const playSoilPatter = (volume = 0.08) => {
  const ctx = unlockedSfxContext();
  if (!ctx || volume <= 0.0005) return;
  try {
    const now = ctx.currentTime + 0.005;
    const grains = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < grains; i++) {
      noiseGrain(
        ctx,
        now + Math.random() * 0.22,
        0.025 + Math.random() * 0.03,
        850 + Math.random() * 800,
        1.1,
        volume * (0.35 + Math.random() * 0.35),
      );
    }
  } catch (_) { /* Web Audio error — swallow */ }
};

// --- Synthesized UI/reward/pet one-shots (Web Audio, no network dependency) ---
// Warm sine/triangle tones rather than bright square/8-bit blips, matching the
// game's soft, healing tone instead of a sharp arcade "beep".

interface BlipNote {
  freq: number;
  delay: number; // seconds after the blip starts
  duration: number;
  /** Gain (relative to volume) of a soft harmonic layered on top for a bell-like warmth. */
  harmonicGain?: number;
  /** The harmonic's frequency as a multiple of freq (2 = one octave up, 3 = an octave + a fifth). */
  harmonicRatio?: number;
  /**
   * Oscillator shape, defaulting to the warm sine every UI sound uses.
   *
   * Only the rarity fanfares set this, and only to `triangle`, for the sustained root underneath
   * the arpeggio: a sine that low reads as a hum with no instrument attached, while a triangle's
   * odd harmonics give it enough edge to read as brass holding a note.
   */
  type?: OscillatorType;
  /** This note's share of the blip's volume (1 = full). For balancing a chord's inner voices. */
  gain?: number;
}

function playBlip(notes: BlipNote[], volume: number) {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const note of notes) {
      const t0 = now + note.delay;
      const stopAt = t0 + note.duration + 0.02;
      const level = volume * (note.gain ?? 1);

      const osc = ctx.createOscillator();
      osc.type = note.type ?? 'sine';
      osc.frequency.setValueAtTime(note.freq, t0);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(level, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + note.duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(stopAt);

      if (note.harmonicGain) {
        const hOsc = ctx.createOscillator();
        hOsc.type = 'sine';
        hOsc.frequency.setValueAtTime(note.freq * (note.harmonicRatio ?? 2), t0);
        const hGain = ctx.createGain();
        hGain.gain.setValueAtTime(0, t0);
        hGain.gain.linearRampToValueAtTime(level * note.harmonicGain, t0 + 0.008);
        hGain.gain.exponentialRampToValueAtTime(0.001, t0 + note.duration * 0.7);
        hOsc.connect(hGain);
        hGain.connect(ctx.destination);
        hOsc.start(t0);
        hOsc.stop(stopAt);
      }
    }
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
}

/** Generic button/toggle/select tap - the game's single most frequent sound. */
export const playUiClick = (volume = 0.4) => {
  playBlip([{ freq: 780, delay: 0, duration: 0.045 }], volume * 0.55);
};

/** Quieter, shorter neutral tick for rapid repeated events (e.g. a rep counter). */
export const playUiTick = (volume = 0.4) => {
  playBlip([{ freq: 1500, delay: 0, duration: 0.02 }], volume * 0.35);
};

/** Two-note gentle rising chime for "done" / confirmation moments. */
export const playUiSuccess = (volume = 0.4) => {
  playBlip([
    { freq: 784, delay: 0, duration: 0.18, harmonicGain: 0.3, harmonicRatio: 2 },
    { freq: 988, delay: 0.1, duration: 0.22, harmonicGain: 0.3, harmonicRatio: 2 },
  ], volume);
};

/** Three-note ascending sparkle arpeggio for purchases/rewards/level-ups. */
export const playUiReward = (volume = 0.4) => {
  playBlip([
    { freq: 659, delay: 0, duration: 0.22, harmonicGain: 0.35, harmonicRatio: 3 },
    { freq: 784, delay: 0.09, duration: 0.24, harmonicGain: 0.35, harmonicRatio: 3 },
    { freq: 988, delay: 0.18, duration: 0.3, harmonicGain: 0.35, harmonicRatio: 3 },
  ], volume);
};

/**
 * 金幣入袋 — the 每日登入 claim, and anything else that pays coins straight into the balance.
 *
 * Deliberately not {@link playUiReward}. That arpeggio is this game's generic "something good
 * happened" and it is already what the shop's cheapest purchase plays; a daily reward borrowing it
 * sounds like a confirmation rather than like being paid. This is the same synth saying a different
 * thing — two bright notes struck 40ms apart with a strong third harmonic, which is what reads as
 * metal rather than as a bell, and then one quieter shimmer above them as the pile settles.
 *
 * About 0.4s in total, so it sits inside the claim animation rather than trailing after it, and
 * mixed lower than the reveal fanfares on purpose: this is a sound the player hears every single
 * day, and the loudest thing in the game has to stay the rarest thing in the game.
 */
export const playUiCoin = (volume = 0.4) => {
  playBlip([
    { freq: 1175, delay: 0, duration: 0.14, harmonicGain: 0.5, harmonicRatio: 3 },
    { freq: 1760, delay: 0.04, duration: 0.16, harmonicGain: 0.45, harmonicRatio: 3 },
    { freq: 2349, delay: 0.13, duration: 0.26, harmonicGain: 0.22, gain: 0.45 },
  ], volume * 0.85);
};

// --- 稀有度 purchase ladder ------------------------------------------------
// Four sounds built by ADDING to playUiReward's three-note arpeggio rather than by writing four
// unrelated cues. A player should hear the same instrument getting more to play as the tier
// climbs, which is what makes the ladder audible as a ladder; four different signature sounds
// would just be four sounds. Everything is synthesized (no audio files anywhere in this repo,
// and the CDN that used to host them is 403 on this network - see the file header).

/** 稀有: the reward arpeggio, plus one bright octave landing on top of it. */
export const playRareReveal = (volume = 0.4) => {
  playUiReward(volume);
  playBlip([{ freq: 1319, delay: 0.3, duration: 0.42, harmonicGain: 0.28, gain: 0.6 }], volume);
};

/** 史詩: the arpeggio, then a rising major triad above it — the first tier that gets a chord. */
export const playEpicReveal = (volume = 0.4) => {
  playUiReward(volume);
  playBlip([
    { freq: 1047, delay: 0.3, duration: 0.5, harmonicGain: 0.3 },
    { freq: 1319, delay: 0.38, duration: 0.5, harmonicGain: 0.3 },
    { freq: 1568, delay: 0.46, duration: 0.62, harmonicGain: 0.3 },
  ], volume * 0.9);
};

/**
 * The fanfare — a sustained triangle-wave root and fifth underneath a rising major arpeggio that
 * lands on a held two-note chord. ~1.5s, and the longest sound in the game.
 *
 * Named for 傳說, which was a tier until the ladder came down to four (constants/rarity.ts).
 * Nothing plays it as its OWN cue any more; it survives as the bed {@link playMythicFanfare} is
 * built on, which is the role it was always doing the most work in.
 *
 * Muted players are checked here rather than in playSound: see {@link setSfxMuted}.
 */
export const playLegendaryFanfare = (volume = 0.4) => {
  if (audio.sfxMuted) return;
  // The brass bed. Started at the same instant as the arpeggio so the first note lands ON a
  // chord instead of arriving over silence.
  playBlip([
    { freq: 196, delay: 0, duration: 1.5, type: 'triangle', gain: 0.55 },
    { freq: 392, delay: 0, duration: 1.4, type: 'triangle', gain: 0.32 },
  ], volume);
  playBlip([
    { freq: 392, delay: 0.05, duration: 0.3, harmonicGain: 0.4 },
    { freq: 494, delay: 0.17, duration: 0.3, harmonicGain: 0.4 },
    { freq: 587, delay: 0.29, duration: 0.34, harmonicGain: 0.4 },
    { freq: 784, delay: 0.41, duration: 0.95, harmonicGain: 0.45 },
  ], volume);
  playBlip([
    { freq: 988, delay: 0.6, duration: 0.85, harmonicGain: 0.3, gain: 0.7 },
    { freq: 1175, delay: 0.6, duration: 0.85, harmonicGain: 0.3, gain: 0.55 },
  ], volume);
};

/**
 * 神話: the fanfare above, then a fast eight-note run climbing two octaves over a lower root.
 *
 * Built as "the fanfare plus something" instead of a bigger fanfare of its own — the same
 * argument as the visual layer budget in constants/rarity.ts. The top of a ladder is recognisable
 * because it contains the rung below it.
 */
export const playMythicFanfare = (volume = 0.4) => {
  if (audio.sfxMuted) return;
  playLegendaryFanfare(volume);
  const run = [1047, 1175, 1319, 1397, 1568, 1760, 1976, 2093];
  playBlip(
    run.map((freq, i) => ({ freq, delay: 0.95 + i * 0.055, duration: 0.3, harmonicGain: 0.35, gain: 0.55 })),
    volume,
  );
  playBlip([{ freq: 147, delay: 0.9, duration: 1.6, type: 'triangle', gain: 0.5 }], volume);
};

/**
 * 轉動音 — the sound of the item spinning in, for the whole of the reveal's arrival.
 *
 * The one SUSTAINED sound in the game, and the reason it is not a {@link SoundEffect} played
 * through {@link playSound}: it lasts as long as the spin does (currently 5.5s), so it has to be
 * STOPPABLE — the player can tap the reveal away, and a whoosh still going over the shop after the
 * overlay is gone is a bug that the enum's fire-and-forget signature cannot express. It returns its
 * own stop handle instead, and components/UI/RarityReveal.tsx — which owns the spin — starts it on
 * mount and stops it on unmount.
 *
 * ## What it is made of
 *
 * A CONTINUOUS bed of filtered noise, with an LFO that slows down riding on top of it. Both halves
 * of that matter, and the first one is a correction: 「旋轉要有種持續的音效持續個兩三秒不是一瞬間」.
 * The modulation used to swing the full way to silence (a 0.5 centre with a ±0.5 depth), which at
 * the low end of the sweep is not a spin, it is two or three separate whooshes with holes between
 * them — the sound stopped existing for most of its own duration. The bed now never drops below
 * ~45% of its level: the noise is unbroken for the whole track and the LFO only makes it SURGE.
 *
 * The surge rate is the RPM. One pass of the item past the listener is one swell, so an LFO
 * falling from 18Hz to 1.4Hz across the track is a 陀螺 winding down — the ear hears the
 * deceleration the eye is watching. A fixed-rate whoosh reads as wind, not as rotation.
 *
 * Under it a triangle sweeping 70→190Hz gives the thing mass and, being unmodulated, is the part
 * that guarantees something is audible at every instant. The bandpass rising and then falling is
 * the 都卜勒 of something coming toward you and settling.
 *
 * Level: it sits under the fanfare but not beneath it. The first version was mixed at half the
 * fanfares and the 神話 brass simply ate it — a sound nobody can hear is not a quiet sound, it is
 * an absent one.
 *
 * ## How it leaves
 *
 * It RETREATS across the back half of the turn rather than stopping partway through it. The
 * sweeps — the bandpass, the pitch, the LFO's deceleration — are all scheduled against
 * `durationMs`, because they describe the real turn and have to stay in step with it; the LEVEL
 * is what moves, ramping down from `fadeFromMs` and reaching silence exactly as the item settles.
 *
 * This replaced a hard stop at `fadeFromMs`, which was an attempt at the same idea —「當已經可以
 * 看到鳳凰 icon 的顏色的時候就可以不用有旋轉的聲音」— and overshot it. Measured, that cut left the
 * last 2.85s of a 7.5s spin at exactly zero, and「旋轉音效不要不見」was that silence: a thing
 * visibly turning with no sound on it does not read as restraint, it reads as broken audio. The
 * ramp keeps both halves of the ask — the whoosh is unmistakably backing off once the colour
 * arrives, and it is never absent while the item is still moving.
 *
 * The window it now covers is also the one where it can actually be heard: 史詩 and 神話 fire
 * their fanfares at delayMs 0 (constants/rarityFx.ts), so the brass is over the FRONT of the spin,
 * not the back.
 *
 * Cutting the sweeps short instead — passing the shorter time as `durationMs` — would sound wrong
 * in a way that is hard to name and easy to hear: the sound would finish its whole deceleration
 * early and be crawling while the picture is still turning.
 *
 * Muted players are checked here, as the fanfares do — see {@link setSfxMuted}.
 *
 * @param durationMs How long the item actually turns for. Drives every sweep, and is when the
 *   level reaches silence and the nodes are freed.
 * @param fadeFromMs When the level STARTS ramping down. Defaults to `durationMs`, i.e. no retreat
 *   at all — the reveal passes the moment the item's colour begins to arrive.
 * @param ctxOverride An {@link OfflineAudioContext} to render into instead of the shared live one.
 *   Test-only, and the reason it exists is that this is the one sound in the game whose bug was
 *   inaudibility: rendering it offline and measuring the envelope is the only way to prove it is
 *   still there in second five. Passing it also bypasses the mute check, since an offline render
 *   makes no noise.
 * @returns A function that fades the sound out over ~120ms and frees the nodes. Safe to call twice.
 */
export const playRevealSpin = (
  volume = 0.4,
  durationMs = 4500,
  fadeFromMs = durationMs,
  ctxOverride?: BaseAudioContext,
): (() => void) => {
  const noop = () => {};
  if (audio.sfxMuted && !ctxOverride) return noop;
  const ctx = ctxOverride ?? getSynthAudioContext();
  if (!ctx) return noop;
  try {
    const now = ctx.currentTime;
    const dur = durationMs / 1000;
    // The retreat: full level until `fadeFrom`, then a straight ramp to silence landing on the
    // settle. Linear rather than exponential on purpose — an exponential ramp does nearly all of
    // its travel in the first moments, which is a hard cut wearing a fade's clothing, and a hard
    // cut is the thing being fixed. A minimum length keeps a caller that passes no `fadeFromMs`
    // (or an out-of-range one) from switching the noise bed off, which clicks.
    const MIN_FADE_S = 0.4;
    const end = dur;
    const fadeFrom = Math.max(0, Math.min(fadeFromMs / 1000, end - MIN_FADE_S));

    // Two seconds of white noise on a loop. Long enough that the loop point is not itself a
    // rhythm — a short buffer looped fast is a buzz at the loop frequency.
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    // The 都卜勒: bright as it rushes in, darkening as it comes to rest.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.5;
    band.frequency.setValueAtTime(300, now);
    band.frequency.exponentialRampToValueAtTime(1700, now + dur * 0.2);
    band.frequency.exponentialRampToValueAtTime(360, now + dur);

    // The body under the noise, rising with the approach.
    const tone = ctx.createOscillator();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(70, now);
    tone.frequency.exponentialRampToValueAtTime(190, now + dur * 0.82);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0, now);
    toneGain.gain.linearRampToValueAtTime(volume * 0.26, now + 0.4);
    toneGain.gain.setValueAtTime(volume * 0.26, now + fadeFrom);
    toneGain.gain.linearRampToValueAtTime(0.0001, now + end);

    // The RPM. One surge per pass, decelerating with the item.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(18, now);
    lfo.frequency.exponentialRampToValueAtTime(1.4, now + dur * 0.9);
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.28;
    // 0.72 ± 0.28, so the quietest instant of a pass is still 45% of the loudest. This is the
    // difference between a continuous sound that pulses and a sound that keeps stopping.
    const chop = ctx.createGain();
    chop.gain.value = 0.72;
    lfo.connect(lfoDepth);
    lfoDepth.connect(chop.gain);

    const bed = ctx.createGain();
    bed.gain.setValueAtTime(0, now);
    bed.gain.linearRampToValueAtTime(volume * 0.62, now + 0.3);
    bed.gain.setValueAtTime(volume * 0.62, now + fadeFrom);
    bed.gain.linearRampToValueAtTime(0.0001, now + end);

    noise.connect(band);
    band.connect(chop);
    chop.connect(bed);
    tone.connect(toneGain);
    toneGain.connect(bed);
    bed.connect(ctx.destination);

    const stopAt = now + end + 0.05;
    noise.start(now);
    tone.start(now);
    lfo.start(now);
    noise.stop(stopAt);
    tone.stop(stopAt);
    lfo.stop(stopAt);

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      try {
        const t = ctx.currentTime;
        bed.gain.cancelScheduledValues(t);
        bed.gain.setValueAtTime(bed.gain.value, t);
        bed.gain.linearRampToValueAtTime(0.0001, t + 0.12);
        noise.stop(t + 0.14);
        tone.stop(t + 0.14);
        lfo.stop(t + 0.14);
      } catch (e) {
        // Already stopped by its own schedule - nothing left to do.
      }
    };
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
    return noop;
  }
};
/**
 * 幸運轉盤的旋轉音 — the flapper ticking over the wheel's pegs.
 *
 * ## Why a ratchet and not a whoosh
 *
 * {@link playRevealSpin} already owns "something is spinning" as a continuous whoosh, and it is the
 * right sound for what it does: an ITEM flying in past the listener. A prize wheel is a different
 * object. What a wheel sounds like is the flapper clacking over one peg after another, and that
 * carries a thing no whoosh can — the RATE IS THE SPEED. The ear counts the wedges going by and
 * hears the wheel run out of momentum a full second before it stops, which is the entire drama of
 * a wheel and the reason nobody has ever built one that goes 「咻」.
 *
 * The face already has the pegs drawn on its bezel (UI/LuckyWheel.tsx), so this is also the sound
 * of something that is visibly there.
 *
 * ## Why the times are handed in
 *
 * `pegTimesMs` comes from {@link wheelPegTimes} (constants/luckyWheel.ts), which walks the SAME
 * easing curve the visual is animated along. This file therefore knows nothing about wedges, turns
 * or bezier control points — it is handed a list of moments and makes a noise at each of them. Any
 * other split ends with the deceleration written down twice, and the failure mode of that is a
 * wheel that is still clacking after it has stopped.
 *
 * ## The tick
 *
 * Two layers, because one is not a clack: a bright band-passed noise burst (the flapper's edge) and
 * a very short low sine under it (the peg's body). Both decay in under 40ms — this fires up to ~55
 * times in 3.6 seconds and anything with a tail turns the fast section into a buzz.
 *
 * Three things vary across the run, and all three are the same idea — the wheel is losing energy:
 *  * the noise band drops 2600 → 1700Hz, so the last clacks are duller;
 *  * the pitch of each tick wobbles ±6%, so 55 of them do not read as one machine tone;
 *  * the level starts LOW and rises. That is backwards physically, and right dramatically: the
 *    opening burst is ~25 ticks a second, where full-level clacks would be a wall of static, while
 *    the last four are a second apart and are what the player is holding their breath through.
 *
 * Everything is scheduled up front on the audio clock, so the rhythm is sample-accurate and cannot
 * be jittered by a slow frame — which matters here more than usual, since the thing it has to stay
 * in step with is a 3D scene rendering behind it.
 *
 * Muted players are checked here, as the fanfares and {@link playRevealSpin} do — see
 * {@link setSfxMuted}.
 *
 * @param pegTimesMs When each peg passes the pointer, in ms from now. See {@link wheelPegTimes}.
 * @param volume 0–1, scaled per tick well below it — see the level ramp above.
 * @param ctxOverride An {@link OfflineAudioContext} to render into instead of the shared live one.
 *   Test-only, and for the same reason playRevealSpin has one: the only way to prove a rhythm is
 *   actually there — and lands where the picture does — is to render it and measure the peaks.
 * @returns A function that silences any tick that has not fired yet and frees the nodes. Safe to
 *   call twice, and the reason the panel can be closed or unmounted mid-spin without leaving a
 *   ghost ratchet clacking over the island.
 */
export const playWheelSpin = (
  pegTimesMs: readonly number[],
  volume = 0.4,
  ctxOverride?: BaseAudioContext,
): (() => void) => {
  const noop = () => {};
  if (audio.sfxMuted && !ctxOverride) return noop;
  const ctx = ctxOverride ?? getSynthAudioContext();
  if (!ctx || pegTimesMs.length === 0) return noop;

  try {
    const now = ctx.currentTime;
    const total = pegTimesMs.length;

    // One buffer of noise, shared by every tick. Regenerating 55 of these would be 55 allocations
    // for the same 60ms of randomness; a BufferSource per tick is the cheap part.
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.06), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const live: { stop: (when?: number) => void }[] = [];

    pegTimesMs.forEach((ms, index) => {
      const t0 = now + ms / 1000;
      // 0 at the first peg, 1 at the last. Every ramp below is written against this rather than
      // against the index, so the shape survives a wheel with a different number of wedges.
      const progress = total > 1 ? index / (total - 1) : 1;
      const level = volume * 0.16 * (0.55 + 0.75 * progress);

      const click = ctx.createBufferSource();
      click.buffer = buffer;
      // ±6% playback rate: the same peg struck at a slightly different angle each time.
      click.playbackRate.value = 0.94 + Math.random() * 0.12;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.setValueAtTime(2600 - 900 * progress, t0);
      band.Q.value = 2.2;

      const clickGain = ctx.createGain();
      clickGain.gain.setValueAtTime(0, t0);
      clickGain.gain.linearRampToValueAtTime(level, t0 + 0.001);
      clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);

      click.connect(band);
      band.connect(clickGain);
      clickGain.connect(ctx.destination);
      click.start(t0);
      click.stop(t0 + 0.05);
      live.push(click);

      // The body under the edge. Without it the tick is a hiss; with it, it is something hitting
      // something. Deliberately even shorter than the noise — a low tone that rings is a drum.
      const body = ctx.createOscillator();
      body.type = 'triangle';
      body.frequency.setValueAtTime(250 - 60 * progress, t0);
      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0, t0);
      bodyGain.gain.linearRampToValueAtTime(level * 0.5, t0 + 0.001);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.022);
      body.connect(bodyGain);
      bodyGain.connect(ctx.destination);
      body.start(t0);
      body.stop(t0 + 0.03);
      live.push(body);
    });

    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      // Stopping a source that has already finished is a no-op; stopping one that has not started
      // yet cancels it. Both are what we want, and neither throws — but a context torn down under
      // us would, so the whole sweep is guarded.
      try {
        const at = ctx.currentTime;
        for (const node of live) node.stop(at);
      } catch (e) {
        // Nodes already gone with their context. Nothing left to silence.
      }
    };
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
    return noop;
  }
};

/**
 * {@link playWheelJackpot} 裡「噹」那一下落在第幾毫秒。
 *
 * 給呼叫端對時用：轉盤的全螢幕揭曉（UI/LuckyWheel.tsx）要讓這一下剛好落在獎品著陸的那一幀，
 * 所以它要知道鈴聲前奏有多長，才能提早這麼多開始播。
 */
export const WHEEL_JACKPOT_HIT_MS = 620;

/**
 * 幸運轉盤 中獎 —— 「叮叮叮叮叮 —— 噹啷～」。
 *
 * 跟 {@link playUiReward} 那串三音琶音刻意分開：那是這個遊戲「有好事發生」的通用聲，商店買最便宜
 * 的東西也是它；轉盤中獎要聽起來像**中獎**，也就是拉霸機那種一串越來越響的鈴聲滾上去，然後一個
 * 大和弦砸下來。
 *
 * 三段：
 *  * **鈴聲滾奏**（0 → {@link WHEEL_JACKPOT_HIT_MS}）—— 兩個高音交替敲，間隔越來越短、音量越來越大，
 *    是在「憋」那一下。泛音比用 3（八度加五度），聽起來是鈴不是笛。
 *  * **噹**（HIT）—— C 大三和弦四個音同時下去，底下墊一顆三角波根音給它重量。
 *  * **啷～**—— 一串往上爬的琶音和最後一點閃光，讓和弦有個尾巴而不是一刀切掉。
 *
 * `grand`（史詩造型）在 HIT 底下多墊一層銅管長音、尾巴多一段快速上行——跟稀有度階梯同一條規則：
 * 越稀有是「更多音樂」，不是同一首開更大聲（見 playRareReveal 那段註解）。
 *
 * 靜音照樣不出聲：全部走 playBlip → sfxContext。
 */
export const playWheelJackpot = (volume = 0.4, grand = false) => {
  if (audio.sfxMuted) return;
  const hit = WHEEL_JACKPOT_HIT_MS / 1000;

  // 鈴聲滾奏：間隔從 62ms 收到 32ms，在 HIT 前一點停下。
  const roll: BlipNote[] = [];
  let t = 0;
  for (let i = 0; i < 14 && t < hit - 0.03; i++) {
    const p = i / 13;
    roll.push({
      freq: i % 2 === 0 ? 1319 : 1568,
      delay: t,
      duration: 0.09,
      harmonicGain: 0.35,
      harmonicRatio: 3,
      gain: 0.22 + 0.38 * p,
    });
    t += 0.062 - 0.03 * p;
  }
  playBlip(roll, volume * 0.7);

  // 噹：C 大三和弦。
  playBlip([
    { freq: 262, delay: hit, duration: 1.2, type: 'triangle', gain: 0.5 },
    { freq: 523, delay: hit, duration: 1.0, harmonicGain: 0.3, gain: 0.42 },
    { freq: 659, delay: hit, duration: 1.0, harmonicGain: 0.3, gain: 0.36 },
    { freq: 784, delay: hit, duration: 1.05, harmonicGain: 0.3, gain: 0.36 },
    { freq: 1047, delay: hit, duration: 1.1, harmonicGain: 0.35, gain: 0.4 },
  ], volume);

  // 啷～：往上爬，最後一點閃光。
  playBlip([
    { freq: 1047, delay: hit + 0.08, duration: 0.28, harmonicGain: 0.3, gain: 0.45 },
    { freq: 1319, delay: hit + 0.14, duration: 0.28, harmonicGain: 0.3, gain: 0.45 },
    { freq: 1568, delay: hit + 0.2, duration: 0.3, harmonicGain: 0.3, gain: 0.45 },
    { freq: 2093, delay: hit + 0.27, duration: 0.6, harmonicGain: 0.25, gain: 0.5 },
    { freq: 2637, delay: hit + 0.42, duration: 0.5, gain: 0.25 },
  ], volume);

  if (grand) {
    playBlip([
      { freq: 196, delay: hit, duration: 1.6, type: 'triangle', gain: 0.5 },
      { freq: 392, delay: hit, duration: 1.5, type: 'triangle', gain: 0.3 },
    ], volume);
    const run = [1047, 1175, 1319, 1568, 1760, 2093, 2349, 2637];
    playBlip(
      run.map((freq, i) => ({ freq, delay: hit + 0.55 + i * 0.05, duration: 0.3, harmonicGain: 0.3, gain: 0.45 })),
      volume,
    );
  }
};

/** Stylized, cartoon-soft "woof" for the pet dog - a noise attack plus a pitch-down sweep. */
export const playPetBark = (volume = 0.4) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const duration = 0.15;

    const bufferSize = Math.floor(ctx.sampleRate * 0.04);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 500;
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume * 0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + 0.04);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + duration);
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'bandpass';
    oscFilter.frequency.value = 550;
    oscFilter.Q.value = 2.5;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(volume * 0.7, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

// --- Synthesized one-shots for the 5 interactive outdoor decorations ---
// Same "no network dependency" Web Audio approach as playPetBark/playFootstepThud
// above - each decoration gets a distinct, soft/cozy timbre so they never get
// confused with each other or with the generic UI blips.

/** Soft creaking wood tone for the swing - a slow pitch-bent triangle wave. */
export const playSwingCreak = (volume = 0.4) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const duration = 0.35;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.linearRampToValueAtTime(180, now + duration * 0.5);
    osc.frequency.linearRampToValueAtTime(240, now + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 1.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume * 0.5, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * Resonant modes of the wooden door leaf, as (frequency, relative gain, decay seconds).
 *
 * These are what make a knock sound like WOOD rather than like a drum or a pitched blip. Two
 * properties matter and both are deliberate:
 *
 *  - The ratios are INHARMONIC (1 : 1.66 : 2.75 : 4.22). A struck plate or bar resonates at
 *    frequencies that are not integer multiples of a fundamental, and that is precisely what
 *    the ear uses to classify a sound as "solid object" instead of "musical note". Snapping
 *    these to a harmonic series immediately turns the knock into a marimba tone.
 *  - Higher modes decay FASTER. Real damping rises with frequency, so the bright content only
 *    exists in the first few milliseconds - that short bright transient on top of a longer
 *    low ring is exactly what is perceived as "crisp".
 *
 * The previous version of this sound was a single triangle oscillator gliding 168 -> 108 Hz,
 * which has neither property: one mode, harmonic content from the waveform alone, and a
 * fundamental far too low to read as anything but a dull thud.
 */
const DOOR_WOOD_MODES: { freq: number; gain: number; decay: number }[] = [
  { freq: 432, gain: 1.0, decay: 0.21 },
  { freq: 716, gain: 0.58, decay: 0.145 },
  { freq: 1188, gain: 0.34, decay: 0.095 },
  { freq: 1824, gain: 0.17, decay: 0.06 },
];

/**
 * One knock on wood: a very short noise transient (the contact "click") followed by the modal
 * ring above.
 *
 * `brightness` scales the contact transient only, and it is the whole reason this is a knob.
 * That transient used to be fixed at 0.42 gain through a 2.2 kHz highpass — all of its energy
 * sat above 2 kHz, which is exactly the band the ear is most sensitive to, and players reported
 * the door as piercing. It is now quieter by default and band-limited at the top (see the
 * lowpass below), so the knock keeps its attack without the ice-pick. A closing door passes an
 * even lower value: a latch settling home has almost no contact click at all.
 *
 * `pitch` scales the modal frequencies. Below 1 the same body of wood reads as heavier and
 * duller, which is what separates the closing thud from the opening knock.
 */
function scheduleWoodKnock(
  ctx: AudioContext,
  at: number,
  volume: number,
  { brightness = 0.18, pitch = 1 }: { brightness?: number; pitch?: number } = {},
) {
  // Contact transient. Only ~14 ms, band-limited rather than merely high-passed, so it
  // contributes edge without any of the top-octave glare - the modes below supply the body.
  const tickDur = 0.014;
  const tickSize = Math.max(1, Math.floor(ctx.sampleRate * tickDur));
  const tickBuf = ctx.createBuffer(1, tickSize, ctx.sampleRate);
  const tickData = tickBuf.getChannelData(0);
  for (let i = 0; i < tickSize; i++) {
    tickData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tickSize, 1.5);
  }
  const tick = ctx.createBufferSource();
  tick.buffer = tickBuf;
  const tickHp = ctx.createBiquadFilter();
  tickHp.type = 'highpass';
  // Down from 2200: the click now starts lower and is capped above, so it reads as wood being
  // struck rather than as a spike of white noise.
  tickHp.frequency.value = 1500;
  const tickLp = ctx.createBiquadFilter();
  tickLp.type = 'lowpass';
  tickLp.frequency.value = 5200;
  const tickGain = ctx.createGain();
  tickGain.gain.value = volume * brightness;
  tick.connect(tickHp);
  tickHp.connect(tickLp);
  tickLp.connect(tickGain);
  tickGain.connect(ctx.destination);
  tick.start(at);
  tick.stop(at + tickDur);

  // Slight per-hit detune so repeated doorways in a row are not audibly the same sample.
  const detune = (0.97 + Math.random() * 0.06) * pitch;

  for (const mode of DOOR_WOOD_MODES) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = mode.freq * detune;
    const g = ctx.createGain();
    // A 1 ms ramp instead of an instant jump. A sine does start at a zero crossing, but the
    // summed modes do not, and that discontinuity was part of the reported harshness. One
    // millisecond is short enough to leave the attack intact.
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(volume * mode.gain * 0.5, at + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, at + mode.decay);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + mode.decay + 0.02);
  }
}

/**
 * The sliding runner shared by the open and close cues.
 *
 * `rise` is what makes the two tell each other apart without either being a new sound: opening
 * sweeps the band up (the leaf accelerating away), closing sweeps it down (the leaf coming back
 * and slowing into its frame). Same material, opposite gesture.
 */
function scheduleDoorSlide(
  ctx: AudioContext,
  at: number,
  volume: number,
  { duration, rise }: { duration: number; rise: boolean },
) {
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    // Only lightly integrated (0.14 vs the swim wash's 0.02), leaving the noise tilted bright
    // rather than brown - a dry wooden runner, not a rumble.
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.14 * white) / 1.14;
    data[i] = lastOut * 3.4;
  }

  const roll = ctx.createBufferSource();
  roll.buffer = buffer;

  const rollFilter = ctx.createBiquadFilter();
  rollFilter.type = 'bandpass';
  rollFilter.Q.value = 1.1;
  const [f0, f1, f2] = rise ? [620, 1350, 840] : [900, 560, 380];
  rollFilter.frequency.setValueAtTime(f0, at);
  rollFilter.frequency.linearRampToValueAtTime(f1, at + duration * 0.45);
  rollFilter.frequency.linearRampToValueAtTime(f2, at + duration);

  const rollGain = ctx.createGain();
  rollGain.gain.setValueAtTime(0.0001, at + 0.02);
  rollGain.gain.linearRampToValueAtTime(volume * 0.3, at + 0.09);
  rollGain.gain.setValueAtTime(volume * 0.3, at + duration * 0.55);
  rollGain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  roll.connect(rollFilter);
  rollFilter.connect(rollGain);
  rollGain.connect(ctx.destination);
  roll.start(at);
  roll.stop(at + duration);
}

/**
 * A door opening: a wooden knock as the leaf breaks free, a light slide as it runs along its
 * track, and a softer wooden tap as it reaches the end of its travel — "tak – shhh – tok",
 * rising.
 *
 * Softened from the original pass on player feedback that it was piercing. The glare was the
 * contact transient (see `scheduleWoodKnock`'s `brightness`), not the level, so the fix was to
 * band-limit and pull down that one 14 ms element rather than to turn the whole cue down.
 */
export const playDoorOpen = (volume = 0.35) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // --- The leaf breaking free of its jamb ---
    scheduleWoodKnock(ctx, now, volume);

    // --- The slide along the track ---
    // Kept deliberately thin and quiet. An earlier pass used a heavy low rumble here, which
    // masked the knock's low modes and swallowed the crispness entirely; the slide only needs
    // to bridge the two knocks, not to be the sound itself.
    scheduleDoorSlide(ctx, now, volume, { duration: 0.34, rise: true });

    // --- The leaf reaching its end stop ---
    // Quieter than the opening knock and slightly later than the slide's peak, so the whole
    // cue reads as one gesture.
    scheduleWoodKnock(ctx, now + 0.3, volume * 0.45);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * A door closing — the counterpart to `playDoorOpen`, and deliberately not a replay of it.
 *
 * Three things separate the two by ear, so a player never has to wonder which one they just
 * heard:
 *   - shape: the open leads with the knock ("tak – shhh – tok"); the close leads with the
 *     slide and lands on the thud ("shhh – thunk"). Attack first vs attack last.
 *   - direction: the slide's band sweeps down here instead of up, tracing a leaf coming back
 *     and slowing into its frame rather than accelerating away.
 *   - weight: the closing thud runs the same wood at 0.72 pitch with almost no contact click,
 *     so it reads as heavier, duller and final.
 *
 * An earlier revision had no close sound at all, on the reasoning that it would fire behind the
 * player and become background clatter. That holds only for a cue as bright as the old open —
 * this one is lower, shorter and quieter, and the callers are edge-triggered through a
 * hysteresis dead band, so it cannot repeat while the player loiters.
 */
export const playDoorClose = (volume = 0.32) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // --- The leaf running back down its track ---
    const slideDur = 0.28;
    scheduleDoorSlide(ctx, now, volume * 0.85, { duration: slideDur, rise: false });

    // --- Seating into the frame ---
    // Lower and duller than either of the open's knocks, with the contact click almost gone:
    // a door coming to rest, not being struck.
    scheduleWoodKnock(ctx, now + slideDur * 0.82, volume * 0.9, { brightness: 0.07, pitch: 0.72 });

    // A short, very quiet low thump under the thud, giving the close a body the open does not
    // have. This is the "it's shut" part of the cue.
    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(190, now + slideDur * 0.82);
    body.frequency.exponentialRampToValueAtTime(96, now + slideDur * 0.82 + 0.16);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now + slideDur * 0.82);
    bodyGain.gain.linearRampToValueAtTime(volume * 0.3, now + slideDur * 0.82 + 0.012);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + slideDur * 0.82 + 0.19);
    body.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    body.start(now + slideDur * 0.82);
    body.stop(now + slideDur * 0.82 + 0.21);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 牆上的電燈開關被撥了一下。
 *
 * 一個翹板開關的聲音是兩下而不是一下，中間隔著大約 20 毫秒：先是撥片脫離它的定位彈簧（一個很
 * 短、很亮的塑膠 tick），然後是彈簧翻過去把撥片撞到另一邊的底（一個更短、更悶、更響的 clack）。
 * 只做後面那一下會變成一個「敲」的聲音；只做前面那一下會變成一個沒有落地的滑鼠點擊。是那個間隔
 * 讓它聽起來像機構在動。
 *
 * 開和關差在第二下的音高：開的時候撥片是往下壓進一個比較淺的位置，落點比較高、比較脆；關的時候
 * 是彈回來，比較低比較鈍。差 15% 剛好是聽得出來、但不會覺得是兩個不同東西的距離 —— 跟
 * playDoorOpen / playDoorClose 用同一個原則。
 *
 * 全程用合成而不是取樣，跟這個檔案裡其他所有聲音一樣；也因此它會經過 sfxContext，靜音的時候
 * 就是不出聲。
 */
export const playLightSwitch = (on: boolean, volume = 0.3) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const pitch = on ? 1 : 0.85;

    // --- 撥片脫離定位：8 毫秒的窄帶噪音，只有邊緣沒有身體 ---
    const tickDur = 0.008;
    const tickSize = Math.max(1, Math.floor(ctx.sampleRate * tickDur));
    const tickBuf = ctx.createBuffer(1, tickSize, ctx.sampleRate);
    const tickData = tickBuf.getChannelData(0);
    for (let i = 0; i < tickSize; i++) {
      tickData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tickSize, 2);
    }
    const tick = ctx.createBufferSource();
    tick.buffer = tickBuf;
    const tickBp = ctx.createBiquadFilter();
    tickBp.type = 'bandpass';
    tickBp.frequency.value = 3200 * pitch;
    tickBp.Q.value = 1.1;
    const tickGain = ctx.createGain();
    tickGain.gain.value = volume * 0.32;
    tick.connect(tickBp);
    tickBp.connect(tickGain);
    tickGain.connect(ctx.destination);
    tick.start(now);
    tick.stop(now + tickDur);

    // --- 撞到底：噪音的身體 + 一個很短的音高下滑，那是塑膠殼被敲到的共鳴 ---
    const clackAt = now + 0.021;
    const clackDur = 0.05;
    const clackSize = Math.max(1, Math.floor(ctx.sampleRate * clackDur));
    const clackBuf = ctx.createBuffer(1, clackSize, ctx.sampleRate);
    const clackData = clackBuf.getChannelData(0);
    for (let i = 0; i < clackSize; i++) {
      clackData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / clackSize, 3.5);
    }
    const clack = ctx.createBufferSource();
    clack.buffer = clackBuf;
    const clackBp = ctx.createBiquadFilter();
    clackBp.type = 'bandpass';
    clackBp.frequency.value = 1400 * pitch;
    clackBp.Q.value = 0.9;
    const clackGain = ctx.createGain();
    clackGain.gain.value = volume * 0.55;
    clack.connect(clackBp);
    clackBp.connect(clackGain);
    clackGain.connect(ctx.destination);
    clack.start(clackAt);
    clack.stop(clackAt + clackDur);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(900 * pitch, clackAt);
    body.frequency.exponentialRampToValueAtTime(330 * pitch, clackAt + 0.045);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, clackAt);
    bodyGain.gain.linearRampToValueAtTime(volume * 0.34, clackAt + 0.002);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, clackAt + 0.05);
    body.connect(bodyGain);
    bodyGain.connect(ctx.destination);
    body.start(clackAt);
    body.stop(clackAt + 0.06);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** A few random crackling pops for the campfire flare-up - filtered noise bursts. */
export const playCampfireCrackle = (volume = 0.4) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const popCount = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < popCount; i++) {
      const t0 = now + Math.random() * 0.5;
      const dur = 0.03 + Math.random() * 0.03;
      const bufferSize = Math.floor(ctx.sampleRate * dur);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let s = 0; s < bufferSize; s++) {
        data[s] = (Math.random() * 2 - 1) * (1 - s / bufferSize);
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1800 + Math.random() * 1200;
      filter.Q.value = 1.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volume * (0.4 + Math.random() * 0.3), t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(t0);
      noise.stop(t0 + dur);
    }
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** Bright ascending two-note chime for the telescope's star-spotting moment. */
export const playTelescopeChime = (volume = 0.4) => {
  playBlip([
    { freq: 880, delay: 0, duration: 0.16, harmonicGain: 0.4, harmonicRatio: 2 },
    { freq: 1318.5, delay: 0.1, duration: 0.28, harmonicGain: 0.4, harmonicRatio: 2 },
  ], volume);
};

/** A few quick rising high-pitched blips for the birdhouse's chirp. */
export const playBirdChirp = (volume = 0.4) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const chirps = [0, 0.09, 0.17];
    chirps.forEach((delay, i) => {
      const t0 = now + delay;
      const dur = 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const baseFreq = 1600 + i * 120;
      osc.frequency.setValueAtTime(baseFreq, t0);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, t0 + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume * 0.5, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** Coin-drop "plink" plus a soft splash for the wishing well. */
export const playWellSplash = (volume = 0.4) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    // Coin plink
    const plink = ctx.createOscillator();
    plink.type = 'sine';
    plink.frequency.setValueAtTime(1400, now);
    plink.frequency.exponentialRampToValueAtTime(700, now + 0.12);
    const plinkGain = ctx.createGain();
    plinkGain.gain.setValueAtTime(volume * 0.5, now);
    plinkGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    plink.connect(plinkGain);
    plinkGain.connect(ctx.destination);
    plink.start(now);
    plink.stop(now + 0.16);

    // Splash noise
    const splashDelay = 0.18;
    const t0 = now + splashDelay;
    const dur = 0.25;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let s = 0; s < bufferSize; s++) {
      data[s] = (Math.random() * 2 - 1) * Math.pow(1 - s / bufferSize, 1.5);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume * 0.6, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(t0);
    noise.stop(t0 + dur);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

export type FootstepTerrain = 'grass' | 'sand' | 'wood' | 'stone';

const FOOTSTEP_TONE: Record<Exclude<FootstepTerrain, 'grass'>, { filterFreq: number; q: number; duration: number; knockFreq?: number }> = {
  sand: { filterFreq: 1300, q: 0.6, duration: 0.15 },
  wood: { filterFreq: 900, q: 1.2, duration: 0.09, knockFreq: 180 },
  stone: { filterFreq: 2200, q: 2.5, duration: 0.07, knockFreq: 320 },
};

/**
 * One footfall on grass: 窸窸窣窣, not a knock.
 *
 * Grass had a FOOTSTEP_TONE entry like every other surface - one exponentially decaying noise
 * burst through a bandpass at 700Hz. That recipe cannot sound like grass no matter how its three
 * numbers are tuned, and players heard the island's whole outdoors as "walking on planks", which
 * is a fair description of what it was: 700Hz IS the woody register (the wood entry sits 200Hz
 * away at 900Hz), and a single smooth decay is the envelope of something SOLID being struck.
 *
 * A footfall on grass is neither. Its energy is up in the 2-6kHz hiss of dry blades sliding past
 * each other, and its envelope is not one event but dozens of tiny ones - which is what the ear
 * is actually identifying when it calls a sound "grass". So this synthesizes the mechanism:
 *
 *  - a GRANULAR rustle - a few dozen short noise grains scattered across the step, each with its
 *    own decay, summed into one buffer. The flutter between grains is the 窸窣; smooth it into a
 *    single burst and it becomes a knock again regardless of filtering.
 *  - a soft attack, because grass compresses before it hisses. The instant attack of the shared
 *    recipe is the sound of a hard surface refusing to yield.
 *  - a low body thump well under the rustle, so the step still has a foot's weight behind it
 *    without the tonal knock that says "board" (the deliberate difference from the wood entry,
 *    which keeps its 180Hz sine - wood is unchanged by this pass, by request).
 */
const playGrassStep = (ctx: AudioContext, volume: number) => {
  const now = ctx.currentTime;
  const sr = ctx.sampleRate;
  const duration = 0.2 + Math.random() * 0.07;
  const length = Math.max(1, Math.floor(sr * duration));

  const buffer = ctx.createBuffer(1, length, sr);
  const data = buffer.getChannelData(0);

  // Scatter the grains over the first ~85% of the step, biased towards the start (the blades
  // nearest the sole give first). Each is 3-15ms of noise under its own square decay.
  const grainCount = 18 + Math.floor(Math.random() * 12);
  for (let g = 0; g < grainCount; g++) {
    const start = Math.floor(Math.pow(Math.random(), 0.7) * length * 0.85);
    const grainLength = Math.max(2, Math.floor(sr * (0.003 + Math.random() * 0.012)));
    const amp = 0.35 + Math.random() * 0.65;
    for (let i = 0; i < grainLength && start + i < length; i++) {
      data[start + i] += (Math.random() * 2 - 1) * Math.pow(1 - i / grainLength, 2) * amp;
    }
  }

  // Whole-step envelope over the grain bed: ~10ms of give, then a long tail.
  let peak = 0;
  for (let i = 0; i < length; i++) {
    const t = i / length;
    data[i] *= Math.min(1, t / 0.045) * Math.pow(1 - t, 1.6);
    const mag = Math.abs(data[i]);
    if (mag > peak) peak = mag;
  }
  // Grains overlap by chance, so the summed peak varies run to run - normalize it, or one
  // unlucky step in twenty lands twice as loud as its neighbours.
  if (peak > 0) {
    const norm = 1 / peak;
    for (let i = 0; i < length; i++) data[i] *= norm;
  }

  const noise = ctx.createBufferSource();
  noise.buffer = buffer;

  // Everything below ~1.2kHz is where the woodiness lived; drop it and lift the hiss band.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 1250 * (0.94 + Math.random() * 0.12);
  highpass.Q.value = 0.6;

  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3400 * (0.9 + Math.random() * 0.2);
  presence.Q.value = 0.9;
  presence.gain.value = 5;

  // And a ceiling. Without it the grains stay white above the highpass, which measured as 63% of
  // the step's energy above 7kHz - a centroid of 11kHz, which is the sound of an aerosol can,
  // not a lawn. Grass rustle lives in a BAND (~1.3-7kHz); the sizzle above it has to go.
  const ceiling = ctx.createBiquadFilter();
  ceiling.type = 'lowpass';
  ceiling.frequency.value = 7000;
  ceiling.Q.value = 0.7;

  const rustleGain = ctx.createGain();
  // The buffer carries its own envelope, so this is a flat level with a short tail-out.
  rustleGain.gain.setValueAtTime(volume * 0.6, now);
  rustleGain.gain.setValueAtTime(volume * 0.6, now + duration * 0.85);
  rustleGain.gain.linearRampToValueAtTime(0, now + duration);

  noise.connect(highpass);
  highpass.connect(presence);
  presence.connect(ceiling);
  ceiling.connect(rustleGain);
  rustleGain.connect(ctx.destination);
  noise.start(now);
  noise.stop(now + duration);

  // Body: lowpassed noise, not a tone. Soil gives a dull compression, not a pitch.
  const bodyDuration = 0.07;
  const bodyLength = Math.max(1, Math.floor(sr * bodyDuration));
  const bodyBuffer = ctx.createBuffer(1, bodyLength, sr);
  const bodyData = bodyBuffer.getChannelData(0);
  for (let i = 0; i < bodyLength; i++) {
    bodyData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bodyLength, 2.5);
  }
  const body = ctx.createBufferSource();
  body.buffer = bodyBuffer;
  const bodyFilter = ctx.createBiquadFilter();
  bodyFilter.type = 'lowpass';
  bodyFilter.frequency.value = 260;
  bodyFilter.Q.value = 0.8;
  const bodyGain = ctx.createGain();
  // Lowpassing white noise this hard throws away most of its amplitude, so the gain that gets the
  // body audible looks absurd next to the rustle's - at volume * 2.2 it measured as 0.2% of the
  // step's spectrum, i.e. not there at all.
  bodyGain.gain.setValueAtTime(volume * 13, now);
  bodyGain.gain.exponentialRampToValueAtTime(0.001, now + bodyDuration);
  body.connect(bodyFilter);
  bodyFilter.connect(bodyGain);
  bodyGain.connect(ctx.destination);
  body.start(now);
  body.stop(now + bodyDuration);
};

/**
 * Plays one synthesized footstep tap for the given terrain: a short decaying
 * noise burst shaped by a bandpass filter, plus (for wood/stone) a quick tonal
 * "knock" layered on top for a more percussive feel. Grass takes its own path -
 * see {@link playGrassStep}.
 */
export const playFootstepThud = (terrain: FootstepTerrain, volume = 0.35) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    if (terrain === 'grass') {
      playGrassStep(ctx, volume);
      return;
    }
    const now = ctx.currentTime;
    const tone = FOOTSTEP_TONE[terrain];

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * tone.duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      const decay = Math.pow(1 - i / bufferSize, 2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = tone.filterFreq * (0.92 + Math.random() * 0.16);
    filter.Q.value = tone.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + tone.duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + tone.duration);

    if (tone.knockFreq) {
      const knockDuration = tone.duration * 0.6;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = tone.knockFreq;
      const oscGain = ctx.createGain();
      oscGain.gain.setValueAtTime(volume * 0.5, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + knockDuration);
      osc.connect(oscGain);
      oscGain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + knockDuration);
    }
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 「放不下」的否決音 — a short sawtooth buzz falling 150Hz → 80Hz.
 *
 * Lives here rather than in Three/PlacementGhost.tsx, where it was, because of the two things that
 * version got wrong by being outside this file. It opened `new AudioContext()` on EVERY refusal:
 * a browser allows a page about six of those, so a player who nudged a sofa into a wall half a
 * dozen times exhausted the quota and every later `new AudioContext()` threw - which takes the
 * whole game's audio down, not just the buzz. And, being its own context, it never passed through
 * {@link sfxContext}, so it was one of the sounds a muted game still made.
 */
export const playPlacementError = (volume = 0.3) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.3);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * Builds a looping buffer of brown-ish noise (a leaky integrator over white noise,
 * so energy skews toward low frequencies instead of the harsher flat hiss of pure
 * white noise) - shared by the swim ambience below and the ocean-wave texture in
 * ambientMusic.ts, since both want the same "water wash" base texture.
 */
export function createBrownNoiseBuffer(ctx: AudioContext, seconds: number, gainScale = 3.2): AudioBuffer {
  const bufferSize = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * gainScale;
  }
  return buffer;
}

// ===========================================================================
// THE AMBIENCE GATE — one scale over every continuous water/outdoor sound.
// ===========================================================================
//
// WHAT THIS IS FOR. Everything below that runs CONTINUOUSLY rather than answering a single
// action — the beach surf, the swim wash, and the splashes that belong to the water rather
// than to the UI — is multiplied by `ambienceScale()`. That is the whole contract: if the
// scale is 0, the sea makes no sound at all, anywhere.
//
// WHY IT IS A GATE AND NOT JUST A MULTIPLIER. Turning a gain down is not the same as being
// off, and the difference is audible. These beds were faded with `setTargetAtTime`, which
// approaches its target exponentially and never actually arrives; the surf's crash scheduler
// and the swim's splash/bubble intervals also kept firing on their own timers, feeding fresh
// noise bursts into a bus that was merely quiet. A player who had dragged 海浪環境音 to zero
// was still being served a sea — quieter, but there. So at zero the ambience is now TORN DOWN
// rather than turned down, and `start*Ambience` refuses to start.
//
// Coming back is automatic and needs no bookkeeping here: Avatar's frame loop calls
// `startBeachSurfAmbience()` / `startSwimAmbience()` every frame while the player is outdoors
// or in the water (both are no-ops while already running), so the first frame after the scale
// leaves zero rebuilds whichever bed belongs to where the player is standing.

/*
 * `audio.ambienceVolume` is the player's 海浪環境音 setting; `audio.ambienceMuted` is the master
 * mute, mirrored from `settings.isMuted`. Both live in the shared {@link audio} state at the top
 * of this file.
 *
 * The ambience used to ignore it entirely, on the reasoning that muting the MUSIC should not
 * silence the sea. That is a fair distinction and it survives — as the 海浪環境音 slider,
 * which is the control that means "less sea". What it cannot survive as is a speaker button
 * that says the sound is off while the sea keeps rolling: a mute that leaves something
 * playing is not a mute. Both states are still reachable, just through the control that
 * actually names them (slider to 0 for a silent sea with music, music volume to 0 for a
 * silent island with waves).
 */

/**
 * The scale every continuous ambience multiplies into its gain. Exactly 0 means silent, and
 * callers treat that as "do not exist" rather than "be quiet" — see the note above.
 */
export const ambienceScale = () => (audio.ambienceMuted ? 0 : audio.ambienceVolume);

/** True when nothing that counts as ambience may be audible. */
const ambienceSilenced = () => ambienceScale() <= 0;

/**
 * Applies the current scale to whatever is already running, and tears down anything that the
 * scale has just silenced. Called by both writers so neither has to know what the other set.
 */
function applyAmbienceScale(): void {
  if (ambienceSilenced()) {
    stopBeachSurfAmbience();
    stopSwimAmbience();
    return;
  }
  const ctx = getSynthAudioContext();
  if (!ctx) return;
  try {
    if (beachSurf) {
      beachSurf.master.gain.setTargetAtTime(surfGainFor(beachSurf.intensity), ctx.currentTime, 0.08);
    }
    if (swimAmbience) {
      swimAmbience.gain.gain.setTargetAtTime(swimGainFor(swimAmbience), ctx.currentTime, 0.08);
    }
  } catch (_) { /* Web Audio error — swallow */ }
}

/**
 * Sets the player's ambience volume, 0..1, and applies it to anything already playing.
 *
 * The live re-apply matters: `setBeachSurfIntensity` early-outs unless the *intensity* moved,
 * so without this a player dragging the slider while standing still on the beach would hear
 * nothing change until they walked.
 */
export const setAmbienceVolume = (volume: number) => {
  audio.ambienceVolume = Math.min(1, Math.max(0, volume));
  applyAmbienceScale();
};

/** Mirrors `settings.isMuted` into the ambience layer. See `ambienceMuted`. */
export const setAmbienceMuted = (muted: boolean) => {
  if (audio.ambienceMuted === muted) return;
  audio.ambienceMuted = muted;
  applyAmbienceScale();
};

// --- Synthesized swimming ambience (continuous, Web Audio) ---
// Enhanced with multiple layers for a natural water experience:
//   Layer 1: Base brown-noise water wash with dual-LFO for organic movement
//   Layer 2: Periodic random splash bursts (bandpass noise) simulating arm strokes
//   Layer 3: Subtle bubble chirps (rapid frequency-sweeping sine pops)

interface SwimAmbienceNodes {
  /** Base water-wash noise source */
  source: AudioBufferSourceNode;
  /** Continuous white-water "churn" layer, faded in/out with activity */
  churn: AudioBufferSourceNode;
  /** Gain for the churn layer - setSwimActivity() drives it (0 while floating) */
  churnGain: GainNode;
  /** Primary slow LFO wobbling the lowpass cutoff */
  lfo: OscillatorNode;
  /** Secondary faster LFO adding a ripple texture to the base wash */
  lfo2: OscillatorNode;
  /** Lowpass shaping the wash - base frequency retargeted by setSwimActivity() */
  filter: BiquadFilterNode;
  /** Master gain for the entire swim ambience */
  gain: GainNode;
  /** Interval ID for the periodic splash scheduler */
  splashInterval: ReturnType<typeof setInterval>;
  /** Interval ID for the periodic bubble scheduler */
  bubbleInterval: ReturnType<typeof setInterval>;
  /** Volume passed to startSwimAmbience - activity scales relative to this */
  baseVolume: number;
  /**
   * 0 = idly floating on the surface (calm lapping), 1 = actively stroking
   * (energetic splashes). Read by the splash/bubble schedulers each tick and
   * applied to the wash gain/filter by setSwimActivity().
   */
  activity: number;
}
let swimAmbience: SwimAmbienceNodes | null = null;

/**
 * Schedules a single short "splash" burst: white noise through a bandpass filter
 * with randomised center frequency and attack/decay, giving each splash a unique
 * character — some are sharp slaps, others are softer whooshes.
 *
 * `soft` switches to a "lap" variant used while idly floating: lower, longer,
 * much quieter — water gently slapping against a body at rest rather than an
 * arm breaking the surface.
 */
function scheduleSplash(ctx: AudioContext, masterGain: GainNode, volume: number, soft = false) {
  try {
    const now = ctx.currentTime;
    // Randomise splash character. Durations lean long and attacks soft on purpose:
    // short sharp noise taps on a rhythm read as FOOTSTEPS, not water - every
    // burst here must stay a "shhh-wash", never a "tap".
    const duration = soft
      ? 0.14 + Math.random() * 0.18                  // laps: 140–320 ms, languid
      : 0.16 + Math.random() * 0.2;                  // strokes: 160–360 ms, washy
    const filterFreq = soft
      ? 500 + Math.random() * 900                    // laps: 0.5–1.4 kHz, watery thunk
      : 1500 + Math.random() * 1900;                 // strokes: 1.5–3.4 kHz center
    const filterQ = 0.3 + Math.random() * 0.8;
    const splashVol = volume * (soft
      ? 0.08 + Math.random() * 0.1                   // laps: barely-there
      : 0.25 + Math.random() * 0.35);                // strokes: 25–60% of master

    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      // Soft swelling attack + smooth decay envelope baked into the buffer
      const t = i / bufSize;
      const env = t < 0.2
        ? t / 0.2                                   // gentle 20% attack
        : Math.pow(1 - (t - 0.2) / 0.8, 1.5);      // smooth decay
      d[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filterFreq;
    bp.Q.value = filterQ;

    // Add a subtle highpass to cut low rumble and keep splashes "sparkly".
    // Laps sit lower (0.5–1.4 kHz), so their highpass must sit below that band
    // or it would swallow the whole sound.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = soft ? 250 : 800;
    hp.Q.value = 0.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(splashVol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);

    src.connect(bp);
    bp.connect(hp);
    hp.connect(g);
    g.connect(masterGain);
    src.start(now);
    src.stop(now + duration);
  } catch (_) { /* Web Audio error — swallow */ }
}

/**
 * Schedules a single "bubble pop": a very short sine oscillator that sweeps
 * rapidly upward in pitch (like a tiny air bubble surfacing and popping).
 */
function scheduleBubble(ctx: AudioContext, masterGain: GainNode, volume: number) {
  try {
    const now = ctx.currentTime;
    const duration = 0.03 + Math.random() * 0.06;    // 30–90 ms
    const startFreq = 300 + Math.random() * 400;      // 300–700 Hz
    const endFreq = startFreq * (2 + Math.random());   // sweep up 2–3×
    const bubbleVol = volume * (0.08 + Math.random() * 0.12); // very subtle

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration * 0.7);

    const g = ctx.createGain();
    g.gain.setValueAtTime(bubbleVol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + duration);
  } catch (_) { /* Web Audio error — swallow */ }
}

/**
 * Starts a multi-layered swimming ambience:
 *
 * **Layer 1 — Water wash**: Brown-ish noise through a lowpass filter with two
 * LFOs wobbling the cutoff at different rates, so the wash "breathes" like
 * actual ocean water — slow swells overlaid with faster ripple texture.
 *
 * **Layer 2 — Splash bursts**: Every 300–800 ms a randomised short noise burst
 * fires through a bandpass + highpass chain, simulating the irregular splashes
 * of arms breaking the water surface while swimming.
 *
 * **Layer 3 — Bubble pops**: Every 200–600 ms a tiny sine chirp sweeps upward
 * and dies, mimicking air bubbles surfacing.
 *
 * All three layers are pure Web Audio synthesis — zero network dependency.
 * Safe to call repeatedly — a no-op while already running.
 */
export const startSwimAmbience = (volume = 0.22) => {
  const ctx = getSynthAudioContext();
  // Silenced ambience does not get built. Avatar calls this every frame while the player is in
  // the water, so raising the setting again starts it on the very next frame.
  if (!ctx || swimAmbience || ambienceSilenced()) return;

  try {
    const source = ctx.createBufferSource();
    source.buffer = createBrownNoiseBuffer(ctx, 2);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    filter.Q.value = 0.6;

    // Primary slow LFO — broad "wave swell" feel (≈ 7 s cycle)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 350;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    // Secondary faster LFO — smaller "ripple" texture (≈ 1.5 s cycle)
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.65;
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 120;
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(filter.frequency);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    // Starts at full activity, matching the `activity: 1` the node record is built with below.
    gain.gain.linearRampToValueAtTime(volume * ambienceScale(), ctx.currentTime + 0.5);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    // ── Layer 1b: White-water churn (continuous while actively stroking) ──
    // Brighter white-noise froth layered over the low wash - the constant
    // aerated-water sound that surrounds a swimmer mid-stroke. Its gain starts
    // at 0 and is driven entirely by setSwimActivity(), so an idle back-float
    // stays calm while active swimming gets a rich full-spectrum water bed.
    const churnSeconds = 1.5;
    const churnSize = Math.floor(ctx.sampleRate * churnSeconds);
    const churnBuf = ctx.createBuffer(1, churnSize, ctx.sampleRate);
    const churnData = churnBuf.getChannelData(0);
    for (let i = 0; i < churnSize; i++) {
      churnData[i] = Math.random() * 2 - 1;
    }
    const churn = ctx.createBufferSource();
    churn.buffer = churnBuf;
    churn.loop = true;

    const churnFilter = ctx.createBiquadFilter();
    churnFilter.type = 'bandpass';
    churnFilter.frequency.value = 1800;
    churnFilter.Q.value = 0.4;
    // Ride the same ripple LFO as the wash so the froth breathes with it
    lfo2Gain.connect(churnFilter.frequency);

    const churnGain = ctx.createGain();
    churnGain.gain.value = 0;

    // Routed through the master gain so stopSwimAmbience()'s fade-out covers the
    // churn too (activity scaling both here and on the master is intentional -
    // it makes the froth die off faster than the wash as the swimmer settles).
    churn.connect(churnFilter);
    churnFilter.connect(churnGain);
    churnGain.connect(gain);

    source.start();
    churn.start();
    lfo.start();
    lfo2.start();

    // ── Layer 2: Periodic splash bursts ──
    // Fires at random intervals (300–800 ms) for natural irregularity. Each tick
    // consults the current activity level: while actively swimming it produces the
    // sharp stroke-splash clusters; while idly floating most ticks are skipped and
    // the ones that fire become soft low "laps" of water against the body.
    const splashInterval = setInterval(() => {
      if (!swimAmbience) return;
      const activity = swimAmbience.activity;
      if (activity < 0.35) {
        // Idle float: sparse, gentle lapping only
        if (Math.random() < 0.45) scheduleSplash(ctx, gain, volume, true);
        return;
      }
      scheduleSplash(ctx, gain, volume);
      // ~30% chance of a second splash 40–100 ms later (double-splash cluster)
      if (Math.random() < 0.3) {
        setTimeout(() => scheduleSplash(ctx, gain, volume), 40 + Math.random() * 60);
      }
      // ~10% chance of a third splash for a bigger "stroke" feel
      if (Math.random() < 0.1) {
        setTimeout(() => scheduleSplash(ctx, gain, volume), 100 + Math.random() * 80);
      }
    }, 300 + Math.random() * 500);

    // ── Layer 3: Subtle bubble pops ──
    const bubbleInterval = setInterval(() => {
      if (!swimAmbience) return;
      // Bubbles thin out while floating still (nothing churning the water)
      if (swimAmbience.activity < 0.35 && Math.random() < 0.65) return;
      scheduleBubble(ctx, gain, volume);
      // ~40% chance of a quick second bubble (bubbles tend to come in small groups)
      if (Math.random() < 0.4) {
        setTimeout(() => scheduleBubble(ctx, gain, volume), 50 + Math.random() * 100);
      }
    }, 200 + Math.random() * 400);

    swimAmbience = { source, churn, churnGain, lfo, lfo2, filter, gain, splashInterval, bubbleInterval, baseVolume: volume, activity: 1 };
  } catch (e) {
    // Web Audio unavailable/blocked — fail silently like the rest of the audio layer
  }
};

/**
 * The swim wash's gain: how hard the swimmer is working, scaled by the player's setting.
 *
 * Idle float keeps ~40% of the active wash volume — present but calm. The ambience scale is
 * folded in HERE rather than at the two call sites, so `setSwimActivity` and the settings
 * writer cannot end up disagreeing about which of the two most recently won.
 */
const swimGainFor = (nodes: SwimAmbienceNodes) =>
  nodes.baseVolume * (0.4 + 0.6 * nodes.activity) * ambienceScale();

/** Fades out and tears down the swim ambience started by startSwimAmbience(). Safe to call when not running. */
export const stopSwimAmbience = () => {
  if (!swimAmbience) return;
  const { source, churn, lfo, lfo2, gain, splashInterval, bubbleInterval } = swimAmbience;
  const ctx = getSynthAudioContext();
  swimAmbience = null;

  // Stop splash/bubble schedulers immediately
  clearInterval(splashInterval);
  clearInterval(bubbleInterval);

  if (!ctx) {
    try { source.stop(); churn.stop(); lfo.stop(); lfo2.stop(); } catch (e) { /* already stopped */ }
    return;
  }

  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + 0.3);
  setTimeout(() => {
    try { source.stop(); churn.stop(); lfo.stop(); lfo2.stop(); } catch (e) { /* already stopped */ }
  }, 350);
};

/**
 * Blends the running swim ambience between "idly floating" (0) and "actively
 * stroking" (1): the wash gets quieter and muffled toward 0, and the splash/
 * bubble schedulers (which read `activity` each tick) switch to sparse gentle
 * laps. Safe to call every frame — cheap early-outs when nothing changed.
 */
export const setSwimActivity = (activity: number) => {
  if (!swimAmbience) return;
  const a = Math.min(1, Math.max(0, activity));
  if (Math.abs(a - swimAmbience.activity) < 0.02) return;
  swimAmbience.activity = a;
  const ctx = getSynthAudioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    swimAmbience.gain.gain.cancelScheduledValues(now);
    swimAmbience.gain.gain.setTargetAtTime(swimGainFor(swimAmbience), now, 0.25);
    // Muffle the wash toward idle (the LFOs stay connected — they wobble around
    // whatever base value the frequency AudioParam holds)
    swimAmbience.filter.frequency.setTargetAtTime(480 + 370 * a, now, 0.3);
    // White-water churn rides activity directly: full froth mid-stroke,
    // silent while floating still
    swimAmbience.churnGain.gain.setTargetAtTime(0.85 * a, now, 0.3);
  } catch (_) { /* Web Audio error — swallow */ }
};

/**
 * One-shot splash for a single freestyle arm entry — fired by the avatar in
 * sync with the stroke cycle (each time a hand pierces the surface), so the
 * splashes land ON the beat of the animation instead of at random.
 *
 * Deliberately noise-only: an earlier version layered a low sine "plunk" under
 * the spray, but a short percussive thump repeating on the stroke beat reads as
 * FOOTSTEPS, not water. Pure filtered noise with a soft attack stays
 * unmistakably liquid. Also reused (quiet) as the wading slosh for walking
 * through ankle-deep shallows.
 */
export const playStrokeSplash = (volume = 0.3) => {
  const ctx = getSynthAudioContext();
  // Water, not UI: it answers a stroke rather than running continuously, but what it is made
  // of is the sea, so it answers to 海浪環境音 like the rest of it. A silenced ocean that still
  // splashes every time an arm goes in is the same broken promise the beds used to make.
  if (!ctx || ambienceSilenced()) return;
  try {
    const now = ctx.currentTime;

    // Spray: bandpassed noise burst, long and washy with a gradual swell — a
    // "shhh-WASH" rather than anything percussive
    const duration = 0.28 + Math.random() * 0.16;
    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      const t = i / bufSize;
      const env = t < 0.22 ? t / 0.22 : Math.pow(1 - (t - 0.22) / 0.78, 1.5);
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300 + Math.random() * 1100;
    bp.Q.value = 0.4 + Math.random() * 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(bp); bp.connect(g); g.connect(ctx.destination);
    src.start(now); src.stop(now + duration);

    // Wash tail: a delayed, darker noise swell — the water closing back over the
    // hand. Starts ~80 ms in, sweeps its lowpass downward as the bubbles settle.
    const tailDelay = 0.08;
    const tailDur = 0.24 + Math.random() * 0.12;
    const tailSize = Math.max(1, Math.floor(ctx.sampleRate * tailDur));
    const tailBuf = ctx.createBuffer(1, tailSize, ctx.sampleRate);
    const td = tailBuf.getChannelData(0);
    for (let i = 0; i < tailSize; i++) {
      const t = i / tailSize;
      const env = t < 0.3 ? t / 0.3 : Math.pow(1 - (t - 0.3) / 0.7, 1.4);
      td[i] = (Math.random() * 2 - 1) * env;
    }
    const tail = ctx.createBufferSource();
    tail.buffer = tailBuf;
    const tailLp = ctx.createBiquadFilter();
    tailLp.type = 'lowpass';
    tailLp.frequency.setValueAtTime(1600, now + tailDelay);
    tailLp.frequency.exponentialRampToValueAtTime(500, now + tailDelay + tailDur);
    const tailGain = ctx.createGain();
    tailGain.gain.setValueAtTime(volume * 0.6, now + tailDelay);
    tailGain.gain.exponentialRampToValueAtTime(0.001, now + tailDelay + tailDur);
    tail.connect(tailLp); tailLp.connect(tailGain); tailGain.connect(ctx.destination);
    tail.start(now + tailDelay); tail.stop(now + tailDelay + tailDur);
  } catch (_) { /* Web Audio error — swallow */ }
};

/**
 * One-shot plunge for crossing the shoreline. `intensity` scales the size:
 * ~0.55 for wading in (deep whoomph + spray + foam tail), ~0.2 for stepping
 * back out (light drippy slosh).
 */
export const playWaterEntrySplash = (intensity = 0.5) => {
  const ctx = getSynthAudioContext();
  // Sea sound, so it follows the sea's setting — see playStrokeSplash.
  if (!ctx || ambienceSilenced()) return;
  try {
    const now = ctx.currentTime;
    const i = Math.min(1, Math.max(0, intensity));
    const vol = 0.18 + 0.4 * i;

    // Deep plunge body: sine sweep down, bigger with intensity
    const plunge = ctx.createOscillator();
    plunge.type = 'sine';
    plunge.frequency.setValueAtTime(220 + 120 * i, now);
    plunge.frequency.exponentialRampToValueAtTime(70, now + 0.18 + 0.15 * i);
    const plungeGain = ctx.createGain();
    plungeGain.gain.setValueAtTime(vol * 0.7, now);
    plungeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25 + 0.2 * i);
    plunge.connect(plungeGain); plungeGain.connect(ctx.destination);
    plunge.start(now); plunge.stop(now + 0.25 + 0.2 * i);

    // Spray burst: noise through a lowpass that sweeps down as the splash settles
    const duration = 0.3 + 0.3 * i;
    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let j = 0; j < bufSize; j++) {
      const t = j / bufSize;
      const env = t < 0.05 ? t / 0.05 : Math.pow(1 - (t - 0.05) / 0.95, 1.5);
      d[j] = (Math.random() * 2 - 1) * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, now);
    lp.frequency.exponentialRampToValueAtTime(600, now + duration);
    const sprayGain = ctx.createGain();
    sprayGain.gain.setValueAtTime(vol, now);
    sprayGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(lp); lp.connect(sprayGain); sprayGain.connect(ctx.destination);
    src.start(now); src.stop(now + duration);

    // Foam fizz tail (only meaningful on bigger plunges)
    if (i > 0.35) {
      const fizzDur = 0.5;
      const fizzSize = Math.max(1, Math.floor(ctx.sampleRate * fizzDur));
      const fizzBuf = ctx.createBuffer(1, fizzSize, ctx.sampleRate);
      const fd = fizzBuf.getChannelData(0);
      for (let j = 0; j < fizzSize; j++) {
        const t = j / fizzSize;
        fd[j] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2);
      }
      const fizz = ctx.createBufferSource();
      fizz.buffer = fizzBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2800;
      const fizzGain = ctx.createGain();
      fizzGain.gain.setValueAtTime(0.0001, now);
      fizzGain.gain.linearRampToValueAtTime(vol * 0.35, now + 0.08);
      fizzGain.gain.exponentialRampToValueAtTime(0.001, now + fizzDur);
      fizz.connect(hp); hp.connect(fizzGain); fizzGain.connect(ctx.destination);
      fizz.start(now); fizz.stop(now + fizzDur);
    }
  } catch (_) { /* Web Audio error — swallow */ }
};

// --- Synthesized beach surf ambience (continuous, Web Audio) ---
// Heard while standing on the dry sand strip, before touching the water:
//   Layer 1: Deep surf rumble — brown noise through a low lowpass with a very
//            slow LFO, the distant "roar" of the sea.
//   Layer 2: Periodic wave crashes — every few seconds a noise swell rises,
//            breaks bright, and decays into a highpassed foam hiss.
// Loudness follows the player's distance to the waterline via
// setBeachSurfIntensity(), so the sea grows louder as you approach it.

interface BeachSurfNodes {
  bed: AudioBufferSourceNode;
  bedLfo: OscillatorNode;
  master: GainNode;
  /** Current 0..1 intensity — also scales each scheduled crash */
  intensity: number;
  /** Timeout handle for the next scheduled wave crash */
  crashTimer: ReturnType<typeof setTimeout> | null;
}
let beachSurf: BeachSurfNodes | null = null;

/**
 * Peak master gain the intensity=1 surf reaches. Deliberately assertive: the surf
 * shares its spectral band with the sand footstep thuds, and at lower gains the
 * footsteps completely masked it while walking - "the sea goes silent when I
 * move". It must stay clearly audible THROUGH footsteps on the beach.
 */
const SURF_MAX_GAIN = 0.5;

/**
 * Current surf gain for a given closeness-to-water intensity, after the player's own scale.
 * See THE AMBIENCE GATE above for where that scale comes from and why 0 means torn down.
 */
const surfGainFor = (intensity: number) => SURF_MAX_GAIN * intensity * ambienceScale();

/**
 * One breaking wave: a noise swell with a baked rise-then-decay envelope whose
 * bandpass sweeps up as the wave gathers and breaks, then back down as it
 * dissipates — followed by a delayed highpassed foam hiss riding on top.
 */
function scheduleSurfCrash(ctx: AudioContext, master: GainNode, intensity: number) {
  try {
    const now = ctx.currentTime;
    const duration = 2.0 + Math.random() * 1.0;      // 2–3 s per breaker
    const riseFrac = 0.22 + Math.random() * 0.12;    // how much of it is the gathering swell
    const crashVol = (0.5 + Math.random() * 0.3) * (0.35 + 0.65 * intensity);

    const bufSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      const t = i / bufSize;
      const env = t < riseFrac
        ? Math.pow(t / riseFrac, 1.6)                // slow gathering swell
        : Math.pow(1 - (t - riseFrac) / (1 - riseFrac), 1.5); // long wash-out
      d[i] = (Math.random() * 2 - 1) * env;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.5;
    const breakTime = now + duration * riseFrac;
    bp.frequency.setValueAtTime(650, now);
    bp.frequency.exponentialRampToValueAtTime(2100, breakTime); // brightens as it breaks
    bp.frequency.exponentialRampToValueAtTime(750, now + duration); // darkens washing out

    const g = ctx.createGain();
    g.gain.setValueAtTime(crashVol, now);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(now); src.stop(now + duration);

    // Foam hiss: starts right at the break point, fizzles over ~60% of the wave
    const foamDur = duration * 0.6;
    const foamSize = Math.max(1, Math.floor(ctx.sampleRate * foamDur));
    const foamBuf = ctx.createBuffer(1, foamSize, ctx.sampleRate);
    const fd = foamBuf.getChannelData(0);
    for (let i = 0; i < foamSize; i++) {
      const t = i / foamSize;
      fd[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.8);
    }
    const foam = ctx.createBufferSource();
    foam.buffer = foamBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const foamGain = ctx.createGain();
    foamGain.gain.setValueAtTime(crashVol * 0.4, breakTime);
    foam.connect(hp); hp.connect(foamGain); foamGain.connect(master);
    foam.start(breakTime); foam.stop(breakTime + foamDur);
  } catch (_) { /* Web Audio error — swallow */ }
}

/** Chains the next crash at a random 2.5–5 s interval - frequent enough that a
 *  breaker is almost always audible somewhere in its swell/wash cycle. */
function scheduleNextSurfCrash(ctx: AudioContext) {
  if (!beachSurf) return;
  beachSurf.crashTimer = setTimeout(() => {
    if (!beachSurf) return;
    scheduleSurfCrash(ctx, beachSurf.master, beachSurf.intensity);
    scheduleNextSurfCrash(ctx);
  }, 2500 + Math.random() * 2500);
}

/**
 * Starts the beach surf ambience (rumble bed + recurring wave crashes).
 * Safe to call repeatedly — a no-op while already running. Loudness is
 * controlled separately via setBeachSurfIntensity().
 */
export const startBeachSurfAmbience = () => {
  const ctx = getSynthAudioContext();
  // Same rule as the swim bed: at zero scale the surf is not built at all, and Avatar's frame
  // loop rebuilds it the moment the setting comes back up. See THE AMBIENCE GATE.
  if (!ctx || beachSurf || ambienceSilenced()) return;
  try {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.connect(ctx.destination);

    // Layer 1: deep rumble bed (brown noise, slow-breathing lowpass)
    const bufferSeconds = 2.5;
    const bufferSize = Math.floor(ctx.sampleRate * bufferSeconds);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.2;
    }
    const bed = ctx.createBufferSource();
    bed.buffer = buffer;
    bed.loop = true;

    const bedFilter = ctx.createBiquadFilter();
    bedFilter.type = 'lowpass';
    bedFilter.frequency.value = 420;
    bedFilter.Q.value = 0.5;

    // Very slow swell LFO (~14 s cycle) so the roar breathes like a real sea
    const bedLfo = ctx.createOscillator();
    bedLfo.frequency.value = 0.07;
    const bedLfoGain = ctx.createGain();
    bedLfoGain.gain.value = 150;
    bedLfo.connect(bedLfoGain);
    bedLfoGain.connect(bedFilter.frequency);

    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.65;

    bed.connect(bedFilter);
    bedFilter.connect(bedGain);
    bedGain.connect(master);

    bed.start();
    bedLfo.start();

    beachSurf = { bed, bedLfo, master, intensity: 0, crashTimer: null };

    // Layer 2: first crash arrives quickly so stepping onto the beach answers
    // with a breaker almost immediately, then settles into the slow rhythm.
    beachSurf.crashTimer = setTimeout(() => {
      if (!beachSurf) return;
      scheduleSurfCrash(ctx, beachSurf.master, beachSurf.intensity);
      scheduleNextSurfCrash(ctx);
    }, 300 + Math.random() * 500);
  } catch (e) {
    // Web Audio unavailable/blocked — fail silently like the rest of the audio layer
  }
};

/**
 * Sets how loud the surf is, 0..1 — driven by how close the player stands to
 * the waterline. Ramped smoothly; safe to call every frame (early-outs when
 * the value hasn't meaningfully changed).
 */
export const setBeachSurfIntensity = (intensity: number) => {
  if (!beachSurf) return;
  const i = Math.min(1, Math.max(0, intensity));
  if (Math.abs(i - beachSurf.intensity) < 0.02) return;
  beachSurf.intensity = i;
  const ctx = getSynthAudioContext();
  if (!ctx) return;
  try {
    beachSurf.master.gain.setTargetAtTime(surfGainFor(i), ctx.currentTime, 0.3);
  } catch (_) { /* Web Audio error — swallow */ }
};

/** Fades out and tears down the beach surf ambience. Safe to call when not running. */
export const stopBeachSurfAmbience = () => {
  if (!beachSurf) return;
  const { bed, bedLfo, master, crashTimer } = beachSurf;
  const ctx = getSynthAudioContext();
  beachSurf = null;

  if (crashTimer) clearTimeout(crashTimer);

  if (!ctx) {
    try { bed.stop(); bedLfo.stop(); } catch (e) { /* already stopped */ }
    return;
  }

  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setValueAtTime(master.gain.value, now);
  master.gain.linearRampToValueAtTime(0, now + 0.5);
  setTimeout(() => {
    try { bed.stop(); bedLfo.stop(); } catch (e) { /* already stopped */ }
  }, 550);
};

/**
 * Triggers a device vibration/haptic feedback if supported.
 * @param type 'light' | 'medium' | 'heavy' | 'double' | number
 */
export const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'double' | number = 'light') => {
  if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
    try {
      if (type === 'light') {
        window.navigator.vibrate(15);
      } else if (type === 'medium') {
        window.navigator.vibrate(35);
      } else if (type === 'heavy') {
        window.navigator.vibrate(60);
      } else if (type === 'double') {
        window.navigator.vibrate([20, 50, 20]);
      } else if (typeof type === 'number') {
        window.navigator.vibrate(type);
      }
    } catch (e) {
      // Ignore
    }
  }
};


/* ==========================================================================================
 * 物件互動音效（Object Interaction Animation System）
 *
 * constants/objectAnimations.ts 裡的每一列可以宣告 `sound: { on, off }`，由
 * Three/objectAnimation.tsx 在**狀態邊緣**播放 —— 也就是東西真的動起來的那一刻，而不是按鍵的
 * 那一刻。這是「Player Animation 與 Object Animation 同步」聽覺上的那一半：手還沒碰到把手，就
 * 不該先聽到門。
 *
 * 全部是合成的，跟這個檔案裡其他所有聲音一樣，所以走 sfxContext()、靜音時就是不出聲，也不需要
 * 任何額外的資產。每一個都刻意短、刻意輕：這些聲音會在玩家整理房間的時候連續響很多次。
 * ======================================================================================== */

/**
 * 一段窄帶噪音。這幾個新音效的共用材料 —— 抽屜的木頭摩擦、瓦斯的嘶聲、水流，本質上都是
 * 「一段被濾波器塑形過的噪音」，差別只在頻段、包絡和長度。
 */
function scheduleShapedNoise(
  ctx: AudioContext,
  at: number,
  volume: number,
  {
    duration,
    type = 'bandpass',
    from,
    to,
    q = 1,
    attack = 0.02,
  }: {
    duration: number;
    type?: BiquadFilterType;
    from: number;
    to: number;
    q?: number;
    attack?: number;
  },
) {
  const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buf = ctx.createBuffer(1, size, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.linearRampToValueAtTime(volume, at + Math.min(attack, duration * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(at);
  src.stop(at + duration);
}

/** 抽屜拉出／推回 —— 木頭在木頭裡滑，尾巴上一個很輕的停格。 */
export const playDrawerSlide = (volume = 0.24) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleShapedNoise(ctx, now, volume * 0.5, {
      duration: 0.26, from: 520, to: 300, q: 1.4, attack: 0.05,
    });
    // 滑到底的那一下。比開門的敲擊低、幾乎沒有接觸的脆聲 —— 抽屜是停下來，不是被敲。
    scheduleWoodKnock(ctx, now + 0.22, volume * 0.5, { brightness: 0.06, pitch: 0.82 });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 點火。
 *
 * 兩個部分，順序就是真的點火的順序：先是壓電點火器的「喀」，然後才是瓦斯被點著的那一聲低頻
 * 「噗」。只做後者會像有人在吹氣；只做前者會像在按一個沒接上的開關。
 */
export const playGasIgnite = (volume = 0.3) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    // 點火器的喀噠：8 毫秒，只有邊沒有身體。
    scheduleShapedNoise(ctx, now, volume * 0.55, {
      duration: 0.008, type: 'highpass', from: 2600, to: 2600, attack: 0.001,
    });
    // 瓦斯被點著：一個往下掃的寬頻噗聲。
    scheduleShapedNoise(ctx, now + 0.05, volume * 0.42, {
      duration: 0.2, type: 'lowpass', from: 900, to: 240, attack: 0.012,
    });
    // 點著之後留下來的那一點嘶聲，很快收掉 —— 持續的火焰聲不在這裡，因為爐子可以開著很久，
    // 一個一直響的音源會變成噪音（而且要管生命週期）。
    scheduleShapedNoise(ctx, now + 0.09, volume * 0.14, {
      duration: 0.55, from: 1700, to: 1100, q: 0.8, attack: 0.06,
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 熄火 —— 旋鈕轉回去的一聲，加上火焰斷掉的那一小口氣。 */
export const playGasOff = (volume = 0.24) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleShapedNoise(ctx, now, volume * 0.45, {
      duration: 0.01, type: 'highpass', from: 2200, to: 2200, attack: 0.001,
    });
    scheduleShapedNoise(ctx, now + 0.02, volume * 0.2, {
      duration: 0.16, type: 'lowpass', from: 700, to: 200, attack: 0.02,
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 水流開始。
 *
 * 一段帶通噪音就是水，重點在包絡：前 0.12 秒把頻寬拉開（水衝出來），中段維持，尾端收掉。
 * 這裡刻意只做「開始的那一下」而不是持續音 —— 水龍頭是 `run` 行為，2.8 秒就自己關掉，
 * 一個要跟著開關的長音源等於一個要管的生命週期，而這整套系統的設計目標就是不要有那種東西。
 */
export const playWaterRun = (volume = 0.26) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleShapedNoise(ctx, now, volume * 0.5, {
      duration: 0.9, from: 900, to: 1500, q: 0.6, attack: 0.12,
    });
    // 打在盆底的那一層低頻，讓水聽起來有落點。
    scheduleShapedNoise(ctx, now + 0.06, volume * 0.3, {
      duration: 0.7, type: 'lowpass', from: 600, to: 380, attack: 0.15,
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 家電開關 —— 一個乾淨的塑膠按鍵，收音機和其他有電源鍵的東西共用。 */
export const playApplianceClick = (volume = 0.24) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleShapedNoise(ctx, now, volume * 0.6, {
      duration: 0.012, type: 'bandpass', from: 1900, to: 1500, q: 3, attack: 0.001,
    });
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(320, now);
    body.frequency.exponentialRampToValueAtTime(180, now + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(volume * 0.3, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    body.connect(g);
    g.connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.1);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 微波爐完成 —— 兩聲同音高的短「叮」，這是這個聲音唯一會被認出來的特徵。 */
export const playMicrowaveDing = (volume = 0.26) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [0, 0.17].forEach((offset) => {
      const at = now + offset;
      [1, 2.02].forEach((mult, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 1046 * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.linearRampToValueAtTime(volume * (i === 0 ? 0.34 : 0.12), at + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.26);
      });
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 家具吃到重量 —— 木頭的一聲短嘎吱。
 *
 * 跟 `playSwingCreak` 分開，因為那個是承重的繩索與橫樑（長、低、有身體），這個是一張椅子被坐上
 * 去的瞬間（短、乾、幾乎只有一個泛音）。用同一個會讓每張餐椅聽起來都像鞦韆。
 */
export const playFurnitureCreak = (volume = 0.2) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    // 往上滑一點點：木頭被壓緊的時候接縫的音高是升的。
    osc.frequency.setValueAtTime(148, now);
    osc.frequency.linearRampToValueAtTime(196, now + 0.13);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(volume * 0.32, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);
    osc.connect(filter);
    filter.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/* ==========================================================================================
 * 互動回饋音效 —— 坐墊、居民的招呼聲、寵物的碗與玩具
 *
 * 跟上面那一組同一個原則：短、輕、合成，走 sfxContext()。這一組會在「玩家跟某個東西相處」的
 * 時候反覆響（坐下又起來、跟園丁聊好幾句、丟好幾次球），所以每一個的音量都壓在 UI 點擊之下，
 * 目標是「有感但不吵」，不是「每一下都在宣告」。
 * ======================================================================================== */

/**
 * 坐進有軟墊的東西 —— 布料被壓下去的一口悶氣。
 *
 * 沙發、床墊沒有木頭可以嘎吱，所以它們以前是完全無聲的：坐墊肉眼看得到在下陷，耳朵卻什麼都沒
 * 聽到。這一聲是低頻、帶一點布料摩擦的噪音，長度跟坐墊下陷的時間差不多。起身（`on = false`）
 * 用同一種材料但更輕、更短、往上掃 —— 空氣被吸回坐墊裡。
 */
export const playCushionSettle = (on: boolean, volume = 0.22) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (on) {
      scheduleShapedNoise(ctx, now, volume * 0.55, {
        duration: 0.32, type: 'lowpass', from: 520, to: 160, attack: 0.04,
      });
      // 布面的那一點點摩擦，讓它聽起來是布而不是一口氣。
      scheduleShapedNoise(ctx, now + 0.02, volume * 0.12, {
        duration: 0.22, from: 2400, to: 1500, q: 0.7, attack: 0.05,
      });
    } else {
      scheduleShapedNoise(ctx, now, volume * 0.3, {
        duration: 0.2, type: 'lowpass', from: 200, to: 460, attack: 0.05,
      });
    }
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 居民的一聲招呼 —— 兩三個像哼歌一樣的短音，音高由呼叫端給。
 *
 * 不做人聲、也不做任何可以被聽成字的東西：這個遊戲的角色不說話，說話的是泡泡裡的字。所以
 * 「誰在打招呼」只靠音高和節奏分辨 —— 兔子是高而快的兩聲，河馬是低而慢的一聲半。音高與音符
 * 數量是資料（constants/npcSocial.ts 的 `voice`），這個函式只負責把它們唱出來。
 */
export const playNpcVoice = (
  voice: { readonly pitch: number; readonly notes: readonly number[]; readonly gap: number },
  volume = 0.2,
) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    voice.notes.forEach((semitone, i) => {
      const at = now + i * voice.gap;
      const freq = voice.pitch * Math.pow(2, semitone / 12);
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq * 0.94, at);
      // 往上滑一點：像是嘴巴張開的那一下，而不是一個正弦波的嗶。
      osc.frequency.exponentialRampToValueAtTime(freq, at + 0.05);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq * 3.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(volume * 0.42, at + 0.018);
      g.gain.exponentialRampToValueAtTime(0.0001, at + voice.gap * 0.95 + 0.06);
      osc.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + voice.gap + 0.1);
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 把碗放到地上 —— 陶碗碰到草地的一聲短而圓的「叩」，加上飼料落進碗裡的沙沙聲。 */
export const playBowlSet = (volume = 0.22) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleWoodKnock(ctx, now, volume * 0.55, { brightness: 0.05, pitch: 1.35 });
    scheduleShapedNoise(ctx, now + 0.08, volume * 0.22, {
      duration: 0.3, from: 3200, to: 2000, q: 0.9, attack: 0.03,
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 吃東西的一口 —— 一小段很輕的碎裂噪音。吃飯期間每一口點一次，所以它必須非常小聲。 */
export const playPetMunch = (volume = 0.12) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    scheduleShapedNoise(ctx, now, volume * 0.5, {
      duration: 0.06, from: 2200, to: 1300, q: 1.6, attack: 0.004,
    });
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/**
 * 玩具球落地彈起 —— 一個往下掃的短音。`strength` 0..1，第二、第三下彈跳用更小的值，
 * 所以一顆球落地的聲音是「咚、咚、咚」越來越輕，而不是三下一樣大。
 */
export const playToyBounce = (strength = 1, volume = 0.2) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const s = Math.max(0.05, Math.min(1, strength));
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260 + 90 * s, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(volume * 0.5 * s, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};

/** 貓的一聲短喵 —— 往上再往下的一個母音，壓得很輕。狗有 playPetBark，鳥有 playBirdChirp。 */
export const playCatMew = (volume = 0.22) => {
  const ctx = sfxContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.09);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.3);
    const formant = ctx.createBiquadFilter();
    formant.type = 'bandpass';
    formant.frequency.setValueAtTime(1100, now);
    formant.frequency.linearRampToValueAtTime(1600, now + 0.1);
    formant.frequency.linearRampToValueAtTime(900, now + 0.3);
    formant.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(volume * 0.5, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(formant);
    formant.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.34);
  } catch (e) {
    // Web Audio unavailable/blocked - fail silently like the rest of the audio layer
  }
};
