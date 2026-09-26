/**
 * Throwaway harness: MEASURES each footstep surface instead of trusting the numbers in
 * FOOTSTEP_TONE. Renders one footfall per terrain through an OfflineAudioContext and reports
 * loudness, band split, spectral centroid and envelope granularity (how many separate little
 * peaks the step is made of - the "windowsill" of 窸窸窣窣).
 *
 * soundUtils caches one AudioContext at module scope, so each terrain gets a FRESH module
 * instance via a cache-busted dynamic import; that lets every step render into its own offline
 * context. Results land on window.__foot for a CDP read. Delete with tmp-footstep-audit.html.
 */

const SR = 48000;
const RENDER_SECONDS = 0.8;

type Metrics = {
  terrain: string;
  peak: number;
  rms: number;
  durationMs: number;
  centroidHz: number;
  bands: { sub: number; low: number; mid: number; hiss: number; air: number };
  envelopePeaks: number;
};

// --- radix-2 FFT (in-place, real input) ---
function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function analyse(terrain: string, x: Float32Array): Metrics {
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < x.length; i++) {
    const m = Math.abs(x[i]);
    if (m > peak) peak = m;
    sumSq += x[i] * x[i];
  }

  // Audible length: last sample above 2% of peak.
  let last = 0;
  for (let i = x.length - 1; i >= 0; i--) {
    if (Math.abs(x[i]) > peak * 0.02) { last = i; break; }
  }

  // Summed magnitude spectrum over hann-windowed 2048 frames covering the whole step.
  const N = 2048;
  const spec = new Float64Array(N / 2);
  for (let off = 0; off + N <= Math.max(N, last + 1); off += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      re[i] = (x[off + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) spec[k] += Math.hypot(re[k], im[k]);
  }

  let total = 0;
  let weighted = 0;
  const bands = { sub: 0, low: 0, mid: 0, hiss: 0, air: 0 };
  for (let k = 1; k < N / 2; k++) {
    const hz = (k * SR) / N;
    const mag = spec[k];
    total += mag;
    weighted += mag * hz;
    if (hz < 300) bands.sub += mag;
    else if (hz < 1200) bands.low += mag;
    else if (hz < 2500) bands.mid += mag;
    else if (hz < 7000) bands.hiss += mag;
    else bands.air += mag;
  }
  const pct = (v: number) => Math.round((v / (total || 1)) * 1000) / 10;

  // Envelope granularity: smooth |x| over 1.5ms, count local maxima above 15% of the envelope
  // peak. One smooth decay -> 1. A bed of grains -> many.
  // Measured on the FIRST DIFFERENCE of the signal, i.e. through a crude 6dB/oct highpass: the
  // low body thump is one big smooth hump that otherwise sets the peak the 15% is taken from and
  // hides the very grain flutter this is here to count.
  const w = Math.floor(SR * 0.0015);
  const env: number[] = [];
  for (let i = 1; i + w < last + 1; i += w) {
    let s = 0;
    for (let j = 0; j < w; j++) s += Math.abs(x[i + j] - x[i + j - 1]);
    env.push(s / w);
  }
  const envPeak = Math.max(...env, 0);
  let peaks = 0;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > envPeak * 0.15) peaks++;
  }

  return {
    terrain,
    peak: Math.round(peak * 1000) / 1000,
    rms: Math.round(Math.sqrt(sumSq / (last + 1)) * 10000) / 10000,
    durationMs: Math.round(((last + 1) / SR) * 1000),
    centroidHz: Math.round(weighted / (total || 1)),
    bands: { sub: pct(bands.sub), low: pct(bands.low), mid: pct(bands.mid), hiss: pct(bands.hiss), air: pct(bands.air) },
    envelopePeaks: peaks,
  };
}

async function renderStep(terrain: string, bust: string): Promise<Metrics> {
  const ctx = new OfflineAudioContext(1, Math.floor(SR * RENDER_SECONDS), SR);
  // soundUtils does `new AudioContextClass()` - hand it this offline context instead.
  (window as any).AudioContext = function () { return ctx; } as any;
  (window as any).webkitAudioContext = (window as any).AudioContext;

  const mod = await import(/* @vite-ignore */ `/src/lib/soundUtils.ts?fresh=${bust}`);
  mod.playFootstepThud(terrain, terrain === 'sand' ? 0.24 : 0.35);
  const rendered = await ctx.startRendering();
  return analyse(terrain, rendered.getChannelData(0));
}

(async () => {
  const out: Metrics[] = [];
  const terrains = ['grass', 'grass', 'grass', 'sand', 'wood', 'stone'];
  for (let i = 0; i < terrains.length; i++) {
    try {
      out.push(await renderStep(terrains[i], `${Date.now()}-${i}`));
    } catch (e: any) {
      out.push({ terrain: `${terrains[i]} FAILED: ${e?.message ?? e}` } as any);
    }
  }
  (window as any).__foot = out;
  const el = document.getElementById('log');
  if (el) el.textContent = out.map(m => JSON.stringify(m)).join('\n');
})();
