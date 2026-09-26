/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The 【管理員測試】 handle — the ONE thing 管理員測試模式 adds to the game screen.
 *
 * ## Where it sits, and why that took two mounts
 *
 * Right edge, as a drawer handle: it is where the panel comes from, and every other edge is
 * already spoken for — 個人資訊卡 and 小地圖 and the signpost column on the left, NavBar and the
 * placement dock along the bottom, ControlsHint and 幸運轉盤 in the bottom-right corner, and the
 * character in the middle, which is non-negotiable.
 *
 * The first version of this was `fixed right-0 top-1/2`, and it was WRONG in a way that only
 * showed up on screen: the 鏡頭遠近轉盤 is a 260px column anchored ~225px above the bottom edge, so
 * on a 1440x900 window its top lands at y=409 and a vertically-centred tab (y=431..469) sat
 * squarely on its ＋ button. A hand-tuned offset would have fixed that one window size and drifted
 * on every other — which is the exact class of bug HudFrame was built to end.
 *
 * So in the island and interior views this is a CHILD of the `mid-right` HUD region, stacked
 * directly above the dial in the same flex column. The grid keeps them apart at every viewport
 * size without either one knowing the other's height. That region is also Admin-only in practice —
 * the dial is its only other occupant — so the two pieces of Admin chrome share one column and
 * take nothing from a normal player, for whom the region is empty.
 *
 * `floating` covers the views where HudFrame is not mounted at all (商店, 設定, 更衣室, 健康,
 * 限時小攤, 健身): those are full-page cards with a 24px page gutter, and the right edge at mid
 * height is bare background there — checked with `elementFromPoint`, not assumed. There is no dial
 * in those views either, so the centred position is free.
 *
 * Both mounts sit the same distance from the right edge — the HUD's own `--hud-inset` token, which
 * the frame supplies as padding in one case and `.admin-console-handle-floating` (index.css)
 * repeats in the other. So the handle is one shape at one distance wherever it appears, lined up
 * with the dial and the 幸運轉盤 rather than reading as two similar buttons.
 *
 * ## Two states, two shapes
 *
 * `closed` is the tab: icon plus the label, set vertically because 管理員測試 is four characters
 * and vertical CJK keeps the handle a sliver of the edge instead of a corner of the game.
 * `minimized` keeps the same silhouette but names the category it will come back to, and carries
 * its own X — the difference between 「put this away for a moment」 and 「I'm done」 is the whole
 * reason both states exist (see AdminTestContext).
 */

import { motion } from 'motion/react';
import { ChevronLeft, FlaskConical, X } from 'lucide-react';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { ADMIN_SECTIONS } from './adminTestSections';
import { useAdminTest } from './AdminTestContext';

const shell =
  'flex flex-col items-center rounded-2xl bg-island-navy/92 backdrop-blur-md border ' +
  'border-island-navy-dark/40 text-white shadow-[0_10px_28px_rgba(38,70,83,0.32)] pointer-events-auto';

export function AdminTestLauncher({ floating = false }: { floating?: boolean }) {
  const { mode, section, open, restore, close } = useAdminTest();

  if (mode === 'open') return null;

  const active = ADMIN_SECTIONS.find((s) => s.id === section) ?? null;
  const position = floating
    ? 'admin-console-handle-floating z-admin-console'
    : 'relative z-hud-toolbar';

  if (mode === 'minimized') {
    return (
      <motion.div
        initial={{ opacity: 0, x: 12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className={`${position} ${shell} gap-1 px-1.5 py-2`}
      >
        <button
          type="button"
          onClick={() => {
            playSound(SoundEffect.CLICK);
            restore();
          }}
          title={active ? `展開管理員測試面板（${active.label}）` : '展開管理員測試面板'}
          aria-label="展開管理員測試面板"
          className="flex flex-col items-center gap-1.5 transition-opacity hover:opacity-80 active:scale-95"
        >
          <ChevronLeft size={13} strokeWidth={2.75} className="flex-shrink-0 opacity-75" />
          <FlaskConical size={13} strokeWidth={2.5} className="flex-shrink-0" />
          <span className="text-[10px] font-black tracking-[0.14em] [writing-mode:vertical-rl] leading-none">
            {active?.label ?? '管理員測試'}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            playSound(SoundEffect.CLICK);
            close();
          }}
          title="關閉管理員測試面板"
          aria-label="關閉管理員測試面板"
          className="w-5 h-5 rounded-md flex items-center justify-center bg-white/12 hover:bg-white/25 transition-colors active:scale-90"
        >
          <X size={11} strokeWidth={3} />
        </button>
      </motion.div>
    );
  }

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      onClick={() => {
        playSound(SoundEffect.CLICK);
        open();
      }}
      title="開啟管理員測試面板"
      aria-label="開啟管理員測試面板"
      className={`${position} ${shell} gap-1.5 px-1.5 py-3 transition-all active:scale-95 hover:bg-island-navy`}
    >
      <FlaskConical size={14} strokeWidth={2.5} className="flex-shrink-0" />
      <span className="text-[10px] font-black tracking-[0.2em] [writing-mode:vertical-rl] leading-none">
        管理員測試
      </span>
    </motion.button>
  );
}
