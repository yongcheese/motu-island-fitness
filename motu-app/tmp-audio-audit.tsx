/**
 * Throwaway harness: MEASURES what the island actually puts out, rather than trusting that a
 * gain of zero is silence.
 *
 * Every AudioContext the app creates gets its `destination` replaced by a tap gain feeding an
 * analyser, so the RMS of everything the audio layer emits can be read back. Each step drives
 * the real settings entry points and reports peak RMS over a real-time window.
 *
 * Results land on `window.__audio` for a CDP read. Delete with tmp-audio-audit.html.
 */

// --- The tap. Installed before anything asks for a context (soundUtils creates its
//     AudioContext lazily inside getSynthAudioContext, never at module scope). ---
const RealAC: typeof AudioContext = window.AudioContext;
let analyser: AnalyserNode | null = null;

const destDescriptor = Object.getOwnPropertyDescriptor(
  (window as any).BaseAudioContext?.prototype ?? RealAC.prototype,
  'destination',
)!;

class TappedAudioContext extends RealAC {
  constructor(...args: any[]) {
    super(...(args as []));
    const realDest = destDescriptor.get!.call(this) as AudioDestinationNode;
    const tap = this.createGain();
    const an = this.createAnalyser();
    an.fftSize = 2048;
    tap.connect(an);
    an.connect(realDest);
    Object.defineProperty(this, 'destination', { value: tap, configurable: true });
    analyser = an;
  }
}
(window as any).AudioContext = TappedAudioContext;
(window as any).webkitAudioContext = TappedAudioContext;

import {
  getSynthAudioContext,
  setAmbienceVolume,
  setAmbienceMuted,
  startBeachSurfAmbience,
  setBeachSurfIntensity,
  startSwimAmbience,
  setSwimActivity,
  stopBeachSurfAmbience,
  stopSwimAmbience,
  playStrokeSplash,
} from './src/lib/soundUtils';
import { configureBackgroundMusic } from './src/lib/backgroundMusic';

const buf = new Float32Array(2048);
function rms(): number {
  if (!analyser) return -1;
  analyser.getFloatTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

/** Peak RMS over `ms` of real time — a bed that only crashes every few seconds needs a window. */
async function peakOver(ms: number): Promise<number> {
  const end = performance.now() + ms;
  let peak = 0;
  while (performance.now() < end) {
    peak = Math.max(peak, rms());
    await new Promise((r) => setTimeout(r, 25));
  }
  return peak;
}

interface Step { name: string; peak: number; expect: 'sound' | 'silence'; ok: boolean }
const results: Step[] = [];
const log = document.getElementById('log')!;

/** Anything under this is inaudible on any speaker; the point of the audit is that it is 0. */
const SILENCE = 1e-4;

/**
 * How long every fade in the audio layer is given to finish before measuring starts.
 *
 * Measuring from the instant of the change would report the FADE, not the result: the surf
 * takes 0.5s to wind down, the swim wash 0.3s, the music's master 0.6s. What the audit is
 * asking is "and then what", so it waits out the longest of those with room to spare and
 * measures only what is left.
 */
const FADE_SETTLE_MS = 1400;

async function step(name: string, expect: 'sound' | 'silence', ms: number, act: () => void) {
  act();
  await new Promise((r) => setTimeout(r, FADE_SETTLE_MS));
  const peak = await peakOver(Math.max(800, ms - FADE_SETTLE_MS));
  const ok = expect === 'silence' ? peak < SILENCE : peak > SILENCE * 10;
  results.push({ name, peak, expect, ok });
  log.textContent = results
    .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(46)} peak=${r.peak.toExponential(3)}  want=${r.expect}`)
    .join('\n');
  (window as any).__audio = { done: false, results };
}

async function run() {
  const ctx = getSynthAudioContext();
  if (!ctx) { log.textContent = 'NO AUDIO CONTEXT'; return; }
  await ctx.resume().catch(() => {});
  log.textContent = `ctx state=${ctx.state} rate=${ctx.sampleRate}\n`;

  // ---- The sea ----------------------------------------------------------
  await step('surf, 海浪環境音 = 1', 'sound', 3500, () => {
    setAmbienceMuted(false);
    setAmbienceVolume(1);
    startBeachSurfAmbience();
    setBeachSurfIntensity(1);
  });
  await step('surf, 海浪環境音 = 0', 'silence', 4000, () => setAmbienceVolume(0));
  await step('surf, slider back to 1 (restarts)', 'sound', 3500, () => {
    setAmbienceVolume(1);
    startBeachSurfAmbience();   // Avatar's frame loop does this every frame
    setBeachSurfIntensity(1);
  });
  await step('surf, 全部靜音', 'silence', 4000, () => setAmbienceMuted(true));
  await step('surf, unmuted (restarts)', 'sound', 3500, () => {
    setAmbienceMuted(false);
    startBeachSurfAmbience();
    setBeachSurfIntensity(1);
  });
  stopBeachSurfAmbience();
  await peakOver(700);

  // ---- The water you swim in -------------------------------------------
  await step('swim wash, 海浪環境音 = 1', 'sound', 2500, () => {
    startSwimAmbience(0.3);
    setSwimActivity(1);
  });
  await step('swim wash, 海浪環境音 = 0', 'silence', 4000, () => setAmbienceVolume(0));
  await step('stroke splash while 海浪環境音 = 0', 'silence', 1200, () => {
    playStrokeSplash(0.4); playStrokeSplash(0.4); playStrokeSplash(0.4);
  });
  await step('swim wash, slider back to 1 (restarts)', 'sound', 2500, () => {
    setAmbienceVolume(1);
    startSwimAmbience(0.3);
    setSwimActivity(1);
  });
  stopSwimAmbience();
  await peakOver(700);

  // ---- The music --------------------------------------------------------
  await step('BGM, 背景音樂 = 0.5', 'sound', 4000, () =>
    configureBackgroundMusic({ source: 'builtin', builtinMood: 'island-dawn', volume: 0.5, muted: false }));
  await step('BGM, 背景音樂 = 0', 'silence', 4200, () => configureBackgroundMusic({ volume: 0 }));
  await step('BGM, back to 0.5', 'sound', 4000, () => configureBackgroundMusic({ volume: 0.5 }));
  await step('BGM, 全部靜音', 'silence', 4200, () => configureBackgroundMusic({ muted: true }));

  // ---- Everything at once, then off ------------------------------------
  await step('sea + music both on', 'sound', 4000, () => {
    configureBackgroundMusic({ muted: false, volume: 0.5 });
    setAmbienceMuted(false);
    setAmbienceVolume(1);
    startBeachSurfAmbience();
    setBeachSurfIntensity(1);
  });
  await step('全部靜音 with both running', 'silence', 4500, () => {
    configureBackgroundMusic({ muted: true });
    setAmbienceMuted(true);
  });

  (window as any).__audio = { done: true, results };
  log.textContent += `\n\n${results.filter((r) => r.ok).length}/${results.length} passed`;
}

run();
