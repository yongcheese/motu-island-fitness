/**
 * Throwaway: renders the 轉動音 offline and prints its envelope, so「是不是持續的」can be answered
 * with numbers instead of by asking someone to listen.
 *
 * The reveal's whoosh is the one sound whose failure mode is being INAUDIBLE — masked by the
 * fanfare, or gated to silence between passes — and neither of those shows up in a screenshot or
 * in a headless run (no audio device). So: run the real `playRevealSpin` into an
 * OfflineAudioContext, render it, and measure the RMS of every 100ms window. A continuous sound
 * has no window near zero.
 *
 * Open http://localhost:3000/tmp-spinsound.html, or read `window.__spinEnvelope` over CDP.
 * Delete once the sound is signed off.
 */
import { playRevealSpin } from './src/lib/soundUtils';
import { REVEAL_COLOUR_RISE_MS, REVEAL_SETTLE_MS } from './src/constants/rarityFx';

const DURATION_MS = REVEAL_SETTLE_MS;
/** The sound is supposed to be GONE from here on. Measured below, not assumed. */
const END_MS = REVEAL_COLOUR_RISE_MS;
const RENDER_MS = 8200;
const RATE = 44100;
const WINDOW_MS = 100;

const ctx = new OfflineAudioContext(1, Math.floor((RENDER_MS / 1000) * RATE), RATE);
playRevealSpin(0.55, DURATION_MS, END_MS, ctx);

ctx.startRendering().then(buffer => {
  const data = buffer.getChannelData(0);
  const rows: Array<{ ms: number; rms: number; peak: number }> = [];
  for (let ms = 0; ms < RENDER_MS; ms += WINDOW_MS) {
    const from = Math.floor((ms / 1000) * RATE);
    const to = Math.min(data.length, Math.floor(((ms + WINDOW_MS) / 1000) * RATE));
    let sum = 0;
    let peak = 0;
    for (let i = from; i < to; i++) {
      sum += data[i] * data[i];
      if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
    }
    rows.push({ ms, rms: Math.sqrt(sum / (to - from)), peak });
  }

  const body = rows.filter(r => r.ms >= 400 && r.ms <= END_MS - 500);
  const tail = rows.filter(r => r.ms >= END_MS + 100);
  const loudestTail = tail.reduce((a, b) => (a.rms > b.rms ? a : b));
  const quietest = body.reduce((a, b) => (a.rms < b.rms ? a : b));
  const loudest = body.reduce((a, b) => (a.rms > b.rms ? a : b));

  (window as unknown as { __spinEnvelope?: unknown }).__spinEnvelope = {
    rows,
    quietest,
    loudest,
    loudestTail,
    // The number the complaint was about: how deep the holes between passes go.
    ratio: quietest.rms / loudest.rms,
  };

  document.body.style.font = '12px ui-monospace, monospace';
  document.body.style.whiteSpace = 'pre';
  document.body.textContent = [
    `duration ${DURATION_MS}ms, rendered ${RENDER_MS}ms`,
    `sound ends at ${END_MS}ms (colour rise); spin runs to ${DURATION_MS}ms`,
    `quietest window in the body: ${quietest.ms}ms rms=${quietest.rms.toFixed(4)}`,
    `loudest  window in the body: ${loudest.ms}ms rms=${loudest.rms.toFixed(4)}`,
    `loudest window AFTER the end: ${loudestTail.ms}ms rms=${loudestTail.rms.toFixed(4)}`,
    `floor/peak ratio: ${(quietest.rms / loudest.rms).toFixed(3)}`,
    '',
    ...rows.map(r => `${String(r.ms).padStart(5)}ms  rms=${r.rms.toFixed(4)}  peak=${r.peak.toFixed(4)}  ${'#'.repeat(Math.round(r.rms * 300))}`),
  ].join('\n');
});
