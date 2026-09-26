/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 【管理員測試】 — the single entrance to every test-only control in the game.
 *
 * ## What this replaced
 *
 * Switching 管理員測試模式 on used to change SEVEN screens at once. A quick-supply row appeared
 * inside the player's own profile card; a zoom dial appeared on the right edge of the island; the
 * shop grew a 清空裝備 button next to its wallet and a 重製 button inside the collection drawer;
 * 帳號中心 gained four stacked developer panels; the pet care sheet grew a row of state buttons;
 * the 功能卡 bag grew two more; and 設定 grew an extra switch. None of them announced themselves,
 * several of them sat inside chrome a player uses constantly, and the only way to find out what
 * existed was to flip the switch and go looking for what had changed.
 *
 * Now the switch adds exactly one thing to the screen: an edge tab. Everything else lives behind
 * it, in categories (adminTestSections.tsx).
 *
 * This file is the PANEL. The handle that opens it is AdminTestLauncher.tsx, which has the write-up
 * on where an edge tab can and cannot go on this screen.
 *
 * ## Why a side panel and not a modal
 *
 * 「測試時仍能看到遊戲」 is the requirement, so this deliberately has no scrim and no backdrop: a
 * modal overlay would dim the very thing the panel exists to let you watch, and swallow the clicks
 * that drive it. The island keeps rendering, keeps taking WASD, and keeps being clickable while the
 * panel is open. On a 1440px window the panel is 21rem — under a quarter of the width — and it is
 * pinned to the right edge, which is the side the game has the least on.
 *
 * On a phone it becomes a bottom sheet instead of a narrow column, because a 320px side panel on a
 * 390px screen is not a side panel, it is a full-screen modal with a sliver of game showing. See
 * `.admin-console-panel` in index.css for the four tiers.
 *
 * ## Information architecture: list first, category second
 *
 * The panel opens on a table of CONTENTS — six category cards, each naming what is inside it —
 * rather than on the controls themselves. That is the whole point: the complaint this replaced was
 * that turning the mode on produced a screen of unexplained buttons and no answer to
 * 「有哪些類型的測試功能」. Panel → 分類 → 功能, never all of it at once.
 *
 * ## Open / minimize / close
 *
 * Three states, not two, because a tester working through 家具 + NPC + 動畫 puts the panel away and
 * picks it up constantly:
 *
 *   closed     the handle alone. Reopening starts at the category list.
 *   minimized  the handle, naming the category still loaded; restoring returns to that screen.
 *   open       the panel.
 *
 * ## Isolation
 *
 * Both this and the launcher are mounted inside `<AdminOnly>` in App.tsx, which returns `null` —
 * not a hidden element — when 管理員測試模式 is off. Nothing here is mounted, no effect is
 * registered, no keyboard listener is attached and no context work happens for a normal player.
 * The 3D scene, the HUD and every game view are byte-for-byte what they were before this existed.
 */

import { useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight, FlaskConical, Minus, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { HAS_DEBUG_OVERRIDE } from '../../../utils/debugOverrides';
import { AdminStatePill } from './AdminTestKit';
import { ADMIN_SECTIONS } from './adminTestSections';
import { useAdminTest } from './AdminTestContext';

/**
 * The front page: what kinds of test functions exist.
 *
 * Cards rather than a flat button list, because the brief's complaint was precisely
 * 「Button Button Button 全部排列在一起」. Each card names the category, says in one line what it is
 * for, and lists the controls inside it — so the answer to 「有哪些類型的測試功能」 is legible
 * without opening anything.
 */
function AdminSectionList({ onPick }: { onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {ADMIN_SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          onClick={() => onPick(section.id)}
          className="w-full text-left rounded-[1.5rem] border border-island-line bg-white/70 hover:bg-white hover:border-island-teal/45 transition-all active:scale-[0.99] p-3.5 group"
        >
          <div className="flex items-start gap-2.5">
            <span className="w-9 h-9 rounded-2xl bg-island-teal/12 border border-island-teal/30 text-island-teal-dark flex items-center justify-center flex-shrink-0">
              {section.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13px] font-black text-island-navy leading-tight truncate">
                  {section.label}
                </h4>
                <span className="flex items-center gap-1 flex-shrink-0 text-island-navy-soft/60 group-hover:text-island-teal-dark transition-colors">
                  <span className="text-[10px] font-black tabular-nums">{section.entries.length}</span>
                  <ChevronRight size={13} strokeWidth={2.75} />
                </span>
              </div>
              <p className="text-[10px] font-bold text-island-navy-soft/85 leading-snug mt-1">
                {section.tagline}
              </p>
              {/* The contents, spelled out. This is the line that makes the front page a table of
                  contents instead of a menu — a tester looking for 「重置功能卡」 finds the word
                  itself here rather than having to guess which category owns it. */}
              <p className="text-[9px] font-bold text-island-navy-soft/60 leading-snug mt-1.5">
                {section.entries.join('・')}
              </p>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** The always-visible strip under the header: what is switched on right now, across categories. */
function AdminStatusStrip() {
  const { settings } = useApp();
  const { showZoomDial } = useAdminTest();

  return (
    <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5 border-b border-island-line bg-island-cream-2/70">
      <AdminStatePill tone="on">測試模式啟用中</AdminStatePill>
      <AdminStatePill tone={settings?.adminOwnAllItems ? 'on' : 'off'}>
        全部商品{settings?.adminOwnAllItems ? '已開' : '未開'}
      </AdminStatePill>
      <AdminStatePill tone={showZoomDial ? 'on' : 'off'}>
        轉盤{showZoomDial ? '顯示' : '隱藏'}
      </AdminStatePill>
      {/* Only when it is actually doing something — a permanent 「未使用」 chip for a URL parameter
          nobody typed would be noise on the one strip that has to stay scannable. The full
          read-out lives in 商店與經濟. */}
      {HAS_DEBUG_OVERRIDE && <AdminStatePill tone="warn">網址覆寫生效中</AdminStatePill>}
    </div>
  );
}

export function AdminTestConsole() {
  const { mode, section, close, minimize, openSection } = useAdminTest();

  const active = useMemo(
    () => ADMIN_SECTIONS.find((s) => s.id === section) ?? null,
    [section],
  );

  const handleClose = useCallback(() => {
    playSound(SoundEffect.CLICK);
    close();
  }, [close]);

  /**
   * Escape steps BACK one level before it closes, so a tester deep in a category is not thrown all
   * the way out by the key they were using to leave a dialog. It is only armed while the panel is
   * open — closed and minimized states leave Escape to whatever else on screen wants it.
   */
  const handleEscape = useCallback(() => {
    if (section) {
      openSection(null);
      return;
    }
    close();
  }, [section, openSection, close]);
  useEscapeToClose(handleEscape, mode === 'open');

  return (
    <AnimatePresence>
      {mode === 'open' && (
        <motion.aside
          key="panel"
          initial={{ opacity: 0, x: 24, y: 24 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          exit={{ opacity: 0, x: 24, y: 24 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          role="dialog"
          aria-label="管理員測試面板"
          /* No scrim, deliberately. A modal backdrop would dim exactly the thing the panel exists
             to let you keep watching, and would swallow the clicks that drive the game — the whole
             point is that the island stays live and playable beside the panel. */
          className="admin-console-panel z-admin-console flex flex-col bg-island-cream border border-island-line shadow-[0_24px_60px_rgba(38,70,83,0.28)] overflow-hidden pointer-events-auto"
        >
          <header className="flex items-center gap-2 px-3.5 py-3 border-b border-island-line bg-island-navy text-white flex-shrink-0">
            {active ? (
              <button
                type="button"
                onClick={() => {
                  playSound(SoundEffect.CLICK);
                  openSection(null);
                }}
                title="回到分類列表"
                aria-label="回到分類列表"
                className="w-7 h-7 rounded-xl bg-white/12 hover:bg-white/22 flex items-center justify-center transition-colors active:scale-90 flex-shrink-0"
              >
                <ChevronLeft size={15} strokeWidth={3} />
              </button>
            ) : (
              <span className="w-7 h-7 rounded-xl bg-white/12 flex items-center justify-center flex-shrink-0">
                <FlaskConical size={14} strokeWidth={2.5} />
              </span>
            )}

            <div className="min-w-0 flex-1">
              <h3 className="text-[13px] font-black leading-tight truncate">
                {active ? active.label : '管理員測試'}
              </h3>
              <p className="text-[9px] font-bold text-white/60 leading-tight truncate">
                {active ? active.tagline : `${ADMIN_SECTIONS.length} 個分類・僅在管理員測試模式下存在`}
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                playSound(SoundEffect.CLICK);
                minimize();
              }}
              title="收合成小按鈕（保留目前分類）"
              aria-label="收合管理員測試面板"
              className="w-7 h-7 rounded-xl bg-white/12 hover:bg-white/22 flex items-center justify-center transition-colors active:scale-90 flex-shrink-0"
            >
              <Minus size={15} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={handleClose}
              title="關閉（下次從分類列表開始）"
              aria-label="關閉管理員測試面板"
              className="w-7 h-7 rounded-xl bg-white/12 hover:bg-island-coral/70 flex items-center justify-center transition-colors active:scale-90 flex-shrink-0"
            >
              <X size={15} strokeWidth={3} />
            </button>
          </header>

          <AdminStatusStrip />

          {/* `[&>*]:flex-shrink-0` 是這一行唯一不明顯的地方，而它不是裝飾：這是一個 `flex flex-col`
              的捲動容器，而 flex item 預設 `flex-shrink: 1`。少了它，內容比容器高的時候瀏覽器不會
              讓容器捲動，而是把**每一個分區壓扁**到剛好塞進去 —— 每一張卡都被裁掉大約一半，而且因為
              分區自己是 `overflow-hidden`，被裁掉的那一半不會留下任何痕跡：看起來就像那些控制項沒有
              被寫出來。六個分類全都比面板高，所以這件事在每一個分類上都會發生。 */}
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 flex flex-col gap-2.5 [&>*]:flex-shrink-0">
            {active ? <active.Body /> : <AdminSectionList onPick={(id) => {
              playSound(SoundEffect.CLICK);
              openSection(id);
            }} />}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
