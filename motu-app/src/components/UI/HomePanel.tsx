/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft, Compass, Home, Move, Package, Paintbrush, Palette, ShoppingBag,
} from 'lucide-react';
import { UserProfile } from '../../types';
import { HOUSE_STYLES, HouseStyleDefinition } from '../../constants/houseStyles';
import { ItemDefinition, getItemById } from '../../constants/items';
import { ResolvedHome } from '../../hooks/usePlayerHome';
import { ANGEL_AVOID } from '../../constants/angelAvoid';
import { QVersionIcon } from '../QVersionIcon';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';
import { IconTile, KeyCap, PanelHeader } from './DesignKit';
import { DrawerSectionDivider, OWNED_DIVIDER, PlacementItemRow, UNOWNED_DIVIDER } from './PlacementCatalog';
import { worldYawToFacingDeg } from './minimap/miniMapCore';

/**
 * 我的家 — the Home's own management surface.
 *
 * ## The problem this exists to fix
 *
 * The Home used to have no SELECTED state, only an EDITING one. `selectHome()` wrote an island
 * draft on the spot, so the single entry point 「我的家」 (a row inside 島上物件, a tool whose own
 * subtitle promises 移動或收回) did four things at once: it hid the house behind its own ghost,
 * closed the list the player was reading, put up the placement dock, and left them owing a
 * 確認/取消 for a change they had not asked to make. A player who wanted to *look* at their house,
 * or repaint it, or turn it a notch, was moving it before they had said anything.
 *
 * Appearance was the sharpest edge of that: 更換外觀 lived on the placement dock as an extra key,
 * i.e. it was reachable only from inside a move — and because `applyHouseStyle` writes
 * immediately while the transform is still a draft, 取消 cancelled the move but kept the new
 * paint. One panel, two different meanings of "confirm".
 *
 * ## What it is instead
 *
 * Selecting the Home now opens *this*, and nothing else happens: the house stays standing, the
 * world is untouched, and the player picks the verb. That is the whole point — this panel is a
 * **state, not an action**.
 *
 *   我的家 (dock tool · 島上物件 row · clicking the house)
 *     └─ 房屋總覽 — what it looks like now, which way the door faces, how many styles are open
 *          ├─ 更換外觀 → the style list, applied in place, never touches position
 *          └─ 移動與轉向 → hands over to the ONE island editing session (drag + R)
 *
 * ## Why 旋轉 is not a third destination
 *
 * The brief asked for 更換外觀 / 移動位置 / 旋轉 as three peers. Position and rotation are one
 * continuous manipulation here, and — more decisively — they are one *validation*: a turned house
 * covers different ground, so a rotate that skipped the draft would skip `isDraftBlocked` and
 * could quietly park a corner of the building on a fence or off the terrain. So they stay one
 * session, the row is named 移動與轉向 rather than 移動位置, and rotation earns its legibility
 * where it was actually missing — the facing is now a readable fact (the dial below, and the same
 * reading on the placement dock) instead of something only discoverable by pressing R.
 *
 * ## Shape
 *
 * Deliberately the same shell as `CatalogDrawer` — right-hand drawer, `max-w-md`, `PanelHeader`,
 * a two-layer body with a back arrow — because it is the third drawer of the same build mode.
 * The overview's action rows are the build dock's tool card, restated: icon tile, label, hint.
 * Nothing here is a new visual language, which is the point of putting it here rather than
 * inventing a house screen.
 */

/** The eight bearings a 45° rotation step can land on, from north, clockwise. */
const COMPASS_POINTS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];

/**
 * Which way the front door points, in the minimap's own north-up frame.
 *
 * Goes through `worldYawToFacingDeg` rather than doing its own trigonometry so the house's stated
 * facing and every marker on the map are the same conversion — a second copy of "which way is
 * north" is exactly the kind of thing that ends up half a turn out.
 */
function facingDegrees(rotation: number): number {
  return ((worldYawToFacingDeg(rotation) % 360) + 360) % 360;
}

/**
 * The door's bearing as a word. Exported because the placement dock says the same thing live
 * while the house is being turned — one reading, so the panel and the dock can never disagree.
 */
export function facingLabel(rotation: number): string {
  return COMPASS_POINTS[Math.round(facingDegrees(rotation) / 45) % 8];
}

/**
 * A dial showing where the front door points. The needle is the DOOR, not the building: a house
 * is symmetric enough from the outside that "which way is it turned" only means anything if you
 * say which end you are talking about.
 */
function HouseCompass({ rotation, size = 68 }: { rotation: number; size?: number }) {
  return (
    <div
      className="relative flex flex-shrink-0 items-center justify-center rounded-full border border-island-line bg-island-cream-2"
      style={{ width: size, height: size }}
    >
      <span className="absolute top-1 text-[8px] font-black leading-none text-island-navy-soft/55">N</span>
      <svg
        viewBox="0 0 40 40"
        aria-hidden="true"
        className="text-island-teal transition-transform duration-300"
        style={{ width: size * 0.72, height: size * 0.72, transform: `rotate(${facingDegrees(rotation)}deg)` }}
      >
        <path d="M20 7 L26.5 21.5 L20 18.5 L13.5 21.5 Z" fill="currentColor" />
        <circle cx="20" cy="26" r="2.4" fill="currentColor" opacity="0.35" />
      </svg>
    </div>
  );
}

/** Whether a style is available to wear — the starter coat is granted, everything else is bought. */
function ownsStyle(profile: UserProfile | null, style: HouseStyleDefinition): boolean {
  return !style.purchasable || !!profile?.inventory?.includes(style.itemId);
}

interface StyleEntry {
  style: HouseStyleDefinition;
  item: ItemDefinition;
  owned: boolean;
}

export function HomePanel({
  home,
  profile,
  onStartTransform,
  onApplyStyle,
  onBuy,
  onClose,
}: {
  home: ResolvedHome;
  profile: UserProfile | null;
  /** 移動與轉向 — hands the Home to the island editing session (useIslandEditor). */
  onStartTransform: () => void;
  onApplyStyle: (styleItemId: string) => void;
  onBuy: (item: ItemDefinition) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<'overview' | 'styles'>('overview');
  // Esc unwinds one layer at a time rather than closing outright, the same way the back arrow
  // does — a player deep in the style list has not asked to leave 我的家.
  useEscapeToClose(() => (view === 'styles' ? setView('overview') : onClose()));

  const styles = useMemo(() => {
    const decorated = HOUSE_STYLES
      .map(style => ({ style, item: getItemById(style.itemId), owned: ownsStyle(profile, style) }))
      .filter((entry): entry is StyleEntry => !!entry.item);
    return {
      owned: decorated.filter(e => e.owned),
      unowned: decorated.filter(e => !e.owned),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.inventory]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      className="absolute inset-0 z-floating-panel flex items-center justify-end bg-island-navy/45 p-4 md:p-8"
    >
      <motion.div
        // Marked as an obstacle so the 小天使 narrates it from beside rather than on top of it,
        // exactly as she does for the catalog drawer. See constants/angelAvoid.ts.
        {...ANGEL_AVOID}
        initial={{ x: 100 }}
        animate={{ x: 0 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="pointer-events-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-island-line bg-island-cream shadow-[0_24px_60px_rgba(38,70,83,0.3)]"
      >
        <PanelHeader
          icon={
            view === 'styles' ? (
              <button
                onClick={() => setView('overview')}
                className="flex h-full w-full items-center justify-center"
                title="返回房屋總覽"
              >
                <ArrowLeft size={20} strokeWidth={2.5} />
              </button>
            ) : (
              <Home size={20} strokeWidth={2.5} />
            )
          }
          title={view === 'styles' ? '更換房屋外觀' : '我的家'}
          subtitle={
            view === 'styles'
              ? '套用後位置、室內格局與家具都會完整保留'
              : '先看看目前的房子，再決定要做什麼'
          }
          onClose={onClose}
        />

        <div
          onTouchMove={(e) => e.stopPropagation()}
          className="no-scrollbar flex-1 space-y-4 overflow-y-auto overscroll-contain bg-island-cream-2/40 p-5 sm:p-6"
          style={{ overflowY: 'auto', scrollbarWidth: 'none' }}
        >
          {view === 'overview' ? (
            <>
              {/* --- What is standing out there right now --------------------------------
                  The panel answers 「我現在的家長什麼樣子」 before it offers a single verb. Teal,
                  the same treatment PlacementItemRow gives an applied style, because that is
                  exactly what this is: the style currently in effect. */}
              <section className="rounded-[1.75rem] border border-island-teal bg-island-teal/6 p-4 sm:p-5">
                <div className="flex items-center gap-4">
                  <IconTile size={84} className="flex-shrink-0 bg-white">
                    <QVersionIcon itemId={home.style.itemId} size={72} />
                  </IconTile>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1 rounded-md border border-island-teal/20 bg-island-teal/10 px-2 py-0.5 text-[9px] font-black text-island-teal-dark">
                      使用中
                    </span>
                    <p className="mt-1.5 truncate text-lg font-black text-island-navy">{home.style.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs font-black leading-relaxed text-island-navy-soft/70">
                      {home.style.description}
                    </p>
                  </div>
                </div>

                {/* Facing, stated. Rotation used to be invisible until the player was already
                    inside a transform session pressing R to find out what it did. */}
                <div className="mt-4 flex items-center gap-4 rounded-[1.25rem] border border-island-line bg-white p-3">
                  <HouseCompass rotation={home.rotation} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-island-navy-soft/70">
                      大門朝向
                    </p>
                    <p className="text-xl font-black text-island-navy">{facingLabel(home.rotation)}</p>
                    <p className="mt-0.5 text-[11px] font-bold leading-relaxed text-island-navy-soft/70">
                      到「移動與轉向」調整，每次轉 45°
                    </p>
                  </div>
                </div>
              </section>

              {/* --- The verbs ----------------------------------------------------------
                  Two, not three, and each says out loud what it will NOT do — because the whole
                  complaint this panel answers is a player being moved when they meant to browse. */}
              <section className="space-y-3">
                <DrawerSectionDivider
                  icon={<Palette size={13} strokeWidth={3} />}
                  label="房屋管理"
                  count={2}
                  owned
                />

                <HomeActionRow
                  icon={<Paintbrush size={24} strokeWidth={2.5} />}
                  label="更換外觀"
                  hint={`${styles.owned.length} 款可以使用 · 不會移動房子`}
                  onClick={() => setView('styles')}
                />

                <HomeActionRow
                  icon={<Move size={24} strokeWidth={2.5} />}
                  label="移動與轉向"
                  hint={
                    <>
                      拖曳搬移，按 <KeyCap size="sm">R</KeyCap> 或旋轉鍵轉 45°
                    </>
                  }
                  onClick={onStartTransform}
                />
              </section>

              <p className="px-2 pb-1 text-center text-[10px] font-bold leading-relaxed text-island-navy-soft/70">
                想佈置屋子裡面的家具，走到門口按「進入我的家」就可以了。
              </p>
            </>
          ) : (
            <>
              {/* --- Layer 2: the wardrobe ---------------------------------------------
                  The same rows, dividers and 購買 path as every other catalog in the game, so
                  「我在哪裡看過這個」 still has one answer. It replaces a modal that listed only
                  what the player already owned — from which the other six houses were invisible. */}
              {styles.owned.length > 0 && (
                <section className="space-y-3">
                  <DrawerSectionDivider {...OWNED_DIVIDER} count={styles.owned.length} owned />
                  {styles.owned.map(entry => (
                    <PlacementItemRow
                      key={entry.style.id}
                      item={entry.item}
                      owned
                      // Own-once, and never standing anywhere: a style is worn, not placed, so
                      // there is no stock to run out of (see PlacementItemRow's `outOfStock`).
                      available={1}
                      applied={home.style.id === entry.style.id}
                      // 毛胚屋 is granted with the Home and its inventory token is spent placing
                      // it, so `getOwnedCount` is 0 forever and StockBadge (which is what draws
                      // 已解鎖 on every other row) renders nothing. Without this the one style
                      // every player has is the one row with no chip at all.
                      tags={entry.style.purchasable ? undefined : (
                        <span className="rounded-md border border-island-line bg-island-cream-2 px-2 py-0.5 text-[9px] font-black text-island-navy-soft/80">
                          初始外觀
                        </span>
                      )}
                      placeLabel="套用"
                      placeIcon={<Paintbrush size={13} strokeWidth={2.5} />}
                      onPlace={() => onApplyStyle(entry.style.itemId)}
                      onBuy={() => onBuy(entry.item)}
                    />
                  ))}
                </section>
              )}

              {styles.unowned.length > 0 && (
                <section className="space-y-3 pt-1">
                  <DrawerSectionDivider {...UNOWNED_DIVIDER} count={styles.unowned.length} />
                  {styles.unowned.map(entry => (
                    <PlacementItemRow
                      key={entry.style.id}
                      item={entry.item}
                      owned={false}
                      available={0}
                      placeLabel="套用"
                      placeIcon={<Paintbrush size={13} strokeWidth={2.5} />}
                      onPlace={() => onApplyStyle(entry.style.itemId)}
                      onBuy={() => onBuy(entry.item)}
                    />
                  ))}
                </section>
              )}

              <p className="flex items-center justify-center gap-1.5 px-4 pb-1 pt-2 text-center text-[10px] font-bold text-island-navy-soft/70">
                <ShoppingBag size={11} strokeWidth={3} />
                商店的「室外 · 房屋外觀」賣的是同一批款式
              </p>
            </>
          )}
        </div>

        {/* 「我現在在編輯什麼」, permanently on screen while this panel is up. A footer strip rather
            than another button: it names the subject, it is not a verb. */}
        <div className="flex items-center gap-2.5 border-t border-island-line bg-island-cream px-5 py-3">
          <Compass size={14} strokeWidth={3} className="flex-shrink-0 text-island-teal" />
          <p className="min-w-0 flex-1 truncate text-[11px] font-black text-island-navy-soft">
            編輯中：我的家 · {home.style.name}
          </p>
          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-island-line bg-island-cream-2 px-2 py-0.5 text-[10px] font-black text-island-navy-soft">
            <Package size={11} strokeWidth={3} />
            {styles.owned.length}/{HOUSE_STYLES.length}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * One verb on the overview.
 *
 * Same anatomy as a build-dock tool card (solid tile, label, hint) so the two read as one family —
 * a player who has already learned the dock has learned this.
 */
function HomeActionRow({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-center gap-4 rounded-[1.5rem] border border-island-line bg-white p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-island-teal hover:shadow-[0_14px_28px_-12px_rgba(42,157,143,0.45)] active:scale-[0.99]"
    >
      <IconTile size={56} solid className="flex-shrink-0 transition-transform duration-300 group-hover:scale-105">
        {icon}
      </IconTile>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black text-island-navy transition-colors group-hover:text-island-teal-dark">
          {label}
        </span>
        <span className="mt-0.5 block text-xs font-bold leading-relaxed text-island-navy-soft/80">
          {hint}
        </span>
      </span>
    </button>
  );
}
