/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DEV-ONLY layout harness for AngelGuide's obstacle avoidance. Not part of the
 * game bundle — reached at /angel-fit.html on the dev server only.
 *
 * It mounts the REAL AngelGuide next to obstacle boxes carrying the real
 * geometry classes (the bottom dock / build panel, and the furniture drawer in
 * its top-right pose), then reports the overlap between the guide's painted
 * box and each obstacle. Panel height is swept across the whole range the game
 * can actually produce rather than pinned to one screenshot, so the result
 * covers every tab and every dock rather than the one that happened to be open.
 *
 * Reads its case out of the query string and writes the verdict into
 * document.title + #out, so `msedge --headless --dump-dom` can read it.
 */
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import './index.css';
import { AngelGuide, type AngelGuidePlacement } from './components/UI/AngelGuide';
import { ANGEL_AVOID } from './constants/angelAvoid';

const q = new URLSearchParams(location.search);
const placement = (q.get('placement') || 'island') as AngelGuidePlacement;
const panelH = Number(q.get('panelH') || 0);
const drawer = q.get('drawer') === '1';
/** `avoid=0` withholds the marker, reproducing the pre-fix behaviour for A/B. */
const avoid = q.get('avoid') !== '0';

const STEPS = [
  { title: '建築規劃', body: '要在島上蓋東西囉！上面那排是分類，切一下就能換不同的戶外建築與裝飾。' },
  { title: '挑一個帶走', body: '點卡片或「擺放」按鈕，物件就會出現在島上，按住拖到想要的位置；寫著「庫存不足」的話先按「購買」補一件。' },
];

function rectOverlap(a: DOMRect, b: DOMRect) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? Math.round(w) * Math.round(h) : 0;
}

function Harness() {
  const [out, setOut] = useState('measuring');

  useEffect(() => {
    // Let the entry springs settle before measuring.
    const t = setTimeout(() => {
      // Walk the guide's own structure rather than adding test-only hooks to
      // it: keep-out layer > [canvas, band] > scale wrapper > row > [angel, card].
      const root = document.querySelector('.z-toast');
      const scaleEl = root?.children[1]?.children[0] as HTMLElement | undefined;
      const row = scaleEl?.children[0];
      const angel = row?.children[0];
      const card = row?.children[1];
      if (!scaleEl || !angel || !card) { setOut('FAIL: guide not found'); return; }

      // The guide's painted box = the angel button + the speech card together.
      const a = angel.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const guide = new DOMRect(
        Math.min(a.left, c.left),
        Math.min(a.top, c.top),
        Math.max(a.right, c.right) - Math.min(a.left, c.left),
        Math.max(a.bottom, c.bottom) - Math.min(a.top, c.top),
      );

      const obstacles = document.querySelectorAll('[data-obstacle]');
      const expected = (panelH > 0 ? 1 : 0) + (drawer ? 1 : 0);
      if (obstacles.length !== expected) {
        setOut(`FAIL: ${obstacles.length} obstacles, expected ${expected}`);
        return;
      }
      let worst = 0;
      obstacles.forEach((el) => {
        const o = el.getBoundingClientRect();
        if (o.width <= 0 || o.height <= 0) { worst = -1; return; }
        worst = Math.max(worst, rectOverlap(guide, o));
      });
      if (worst < 0) { setOut('FAIL: obstacle had zero size'); return; }

      const m = getComputedStyle(scaleEl).transform;
      const s = m === 'none' ? 1 : Number(m.replace(/matrix\(([^,]+).*/, '$1'));

      const verdict = worst === 0 ? 'CLEAR' : 'OVERLAP';
      const line = `${verdict} overlap=${worst}px2 scale=${s.toFixed(2)} guide=${Math.round(guide.left)},${Math.round(guide.top)},${Math.round(guide.width)}x${Math.round(guide.height)} vp=${innerWidth}x${innerHeight}`;
      document.title = line;
      setOut(line);
    }, 900);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-sky-500">
      {/* Stand-in for whichever bottom panel is up: BuildModeOverlay's
          build-panel or one of the DockPanels. Same bottom anchoring; height is
          the swept variable. */}
      {/* Geometry is inline rather than Tailwind: this file is not part of the
          scanned game bundle, so arbitrary utilities are not guaranteed to be
          emitted for it — and a class that silently produced height 0 would
          make the harness report a clean pass. The numbers below are the ones
          the real classes resolve to (DockPanel: bottom-4/sm:bottom-10; the
          drawer: p-4/md:p-8, max-w-md = 28rem, max-h-[55vh]). */}
      {panelH > 0 && (
        <div
          {...(avoid ? ANGEL_AVOID : {})}
          data-obstacle=""
          style={{
            position: 'absolute',
            bottom: innerWidth >= 640 ? 40 : 16,
            left: '50%',
            transform: 'translateX(-50%)',
            width: `min(100%, 960px)`,
            height: panelH,
            background: '#FDFBF7',
            border: '1px solid #E1DED4',
            borderRadius: '2rem',
          }}
        />
      )}

      {/* The furniture drawer in its tempPlacement pose. */}
      {drawer && (
        <div
          {...(avoid ? ANGEL_AVOID : {})}
          data-obstacle=""
          style={{
            position: 'absolute',
            top: innerWidth >= 768 ? 32 : 16,
            right: innerWidth >= 768 ? 32 : 16,
            width: `min(calc(100% - ${(innerWidth >= 768 ? 32 : 16) * 2}px), 28rem)`,
            height: '55vh',
            background: '#FDFBF7',
            border: '1px solid #E1DED4',
            borderRadius: '2rem',
          }}
        />
      )}

      <AngelGuide steps={STEPS} placement={placement} onClose={() => {}} />

      <pre id="out" className="absolute left-0 top-0 text-[10px]">{out}</pre>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
