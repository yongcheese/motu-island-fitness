/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, Coins, Sparkles, Ticket, Zap } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { rarityStyleVars } from '../../constants/rarity';
import {
  ALL_UTILITY_CARDS,
  describeDuration,
  getOwnedCards,
  remainingMs,
  type UtilityCardDefinition,
  type UtilityCardIconName,
} from '../../constants/utilityCards';
import { CARD_USE_MESSAGES, readLiveEffects } from '../../context/useUtilityCards';
// The app already has exactly one countdown format (`03:41:07`, zero-padded so it does not jitter
// in width). It lives beside the panel that needed it first; a second one here would be a second
// way to write the same duration on two screens the player sees minutes apart.
import { formatCountdown } from '../../constants/dailyLogin';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { RarityAura } from './RarityAura';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from './DesignKit';

/**
 * 功能卡 UI — the one place a card is drawn, wherever it appears.
 *
 * §14 of the brief: a player must be able to tell at a glance that this is NOT a hat, a sofa or a
 * 特殊飾品 — it is something you USE. Four things do that work, and none of them is a colour:
 *
 *  1. **A ticket, not a product card.** A round icon well instead of the catalog's 4:3 rectangle,
 *     and a perforated stub line across the card. Shop cards in this game are all the same
 *     rectangle; this one is a different object. (「change the construction, not the colour」 —
 *     DESIGN_SYSTEM.md.)
 *  2. **The effect is the headline.** 「金幣獲得 ×2」 sits where a price would, in its own pill.
 *     An item card answers 「這是什麼」; a card has to answer 「用了會怎樣」.
 *  3. **A 功能卡 label**, said in words, because the shape only works once the player has learned it.
 *  4. **A duration line**, because 「用了會怎樣」 is incomplete without 「持續多久」.
 *
 * The 稀有度 treatment is the shared one (`.rarity-card` / `RarityAura`), deliberately: a card is
 * graded on the same ladder as everything else, and giving it a private rarity look would be a
 * second grading system to keep in step. What differs is the object it is painted on.
 */

/** Card glyphs, resolved from the definition's `iconName`. All three are honoured — see the type. */
const CARD_ICONS: Record<UtilityCardIconName, typeof Coins> = {
  Coins,
  Sparkles,
  Zap,
};

/**
 * A ticking clock, for anything that counts down.
 *
 * One interval per consumer and no shared store: these are seconds-resolution readouts on panels
 * that are open for a minute at a time, and a global ticker driving every mounted component would
 * be a re-render budget nobody is watching. Returns `Date.now()`, so the caller does the maths in
 * the same units every pure function in this feature takes.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** The card's own glyph, in a ring. Sized for a tile (72) or a dialog (48). */
export function UtilityCardArt({
  card,
  size = 72,
}: {
  card: UtilityCardDefinition;
  size?: number;
}) {
  const Icon = CARD_ICONS[card.iconName] ?? Sparkles;
  return (
    <span
      className="rounded-full bg-white border-2 border-dashed border-island-teal/40 flex items-center justify-center text-island-teal-dark flex-shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2.5} />
    </span>
  );
}

/** 功能卡 / 效果 / 持續時間 — the three chips that say what kind of thing this is. */
export function UtilityCardMeta({ card, className = '' }: { card: UtilityCardDefinition; className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="px-2 py-0.5 bg-island-teal/12 text-island-teal-dark text-[10px] font-black rounded-lg border border-island-teal/25 flex items-center gap-1">
        <Ticket size={10} strokeWidth={3} />
        功能卡
      </span>
      <span className="px-2 py-0.5 bg-island-cream-2 text-island-navy-soft text-[10px] font-black rounded-lg border border-island-line flex items-center gap-1">
        <Clock size={10} strokeWidth={3} />
        {describeDuration(card.duration)}
      </span>
    </div>
  );
}

/**
 * The card itself. Composed rather than configured: a caller passes whatever action belongs on it
 * (購買 in the 限時商店, 使用 in the bag), so one component serves both without a `mode` prop.
 */
export function UtilityCardTile({
  card,
  count,
  action,
  aside,
  badges,
  className = '',
}: {
  card: UtilityCardDefinition;
  /** How many the player holds, shown as a stub count. Omitted where it is not the point. */
  count?: number;
  /** The 購買/使用 control. */
  action?: React.ReactNode;
  /** Anything extra above the action — a price row, a status line. */
  aside?: React.ReactNode;
  /**
   * Context tags from whatever surface is showing the card — 限時, 返場, 本檔限購.
   *
   * They ride directly under the card's own chips rather than down in the stub, because on a
   * limited shelf 「這是限時的」 has to be readable in the same glance as the card's name. The tile
   * does not know what they mean; the shelf does.
   */
  badges?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      // The tier's class rides on the card itself, not only on the aura inside the well — the
      // whole rectangle is graded now (`.rarity-card` in index.css). Same treatment a product
      // card gets, for the same reason the aura is shared: a 稀有 card is lit exactly like a
      // 稀有 hat.
      className={`store-card rarity-card rarity-${card.rarity} p-4 rounded-[1.75rem] border flex flex-col cursor-default ${className}`}
      style={rarityStyleVars(card.rarity)}
    >
      {typeof count === 'number' && count > 0 && (
        <div className="absolute top-3 right-3 bg-island-teal text-white px-2.5 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest z-20">
          ×{count}
        </div>
      )}

      {/* The round well — the shape that separates a card from a product tile. The aura is the
          shared 稀有度 treatment, so a 稀有 card is lit exactly like a 稀有 hat. */}
      <div className="w-full py-4 bg-island-cream-2 rounded-2xl mb-3 flex items-center justify-center relative overflow-hidden border rarity-well">
        <RarityAura rarity={card.rarity} />
        <div className="relative">
          <UtilityCardArt card={card} />
        </div>
      </div>

      <h4 className="text-base font-black text-island-navy tracking-tight leading-tight mb-1.5">{card.name}</h4>
      <UtilityCardMeta card={card} className="mb-2" />
      {badges}

      {/* The effect, where a price would be on a shop card. This is the line the whole tile exists
          to deliver. */}
      <div className="inline-flex items-center gap-1.5 self-start px-2.5 py-1 rounded-xl bg-island-teal text-white text-xs font-black mb-2">
        <Sparkles size={12} strokeWidth={3} />
        {card.effectSummary}
      </div>

      <p className="text-island-navy-soft/70 text-xs font-bold leading-relaxed mb-3 line-clamp-3">
        {card.description}
      </p>

      {/* The stub line. A dashed rule rather than a clip-path notch, on purpose: a clip would eat
          the card's own shadow and its rarity ring (DESIGN_SYSTEM.md, 「A clipped element cannot
          carry its own shadow」). */}
      <div className="mt-auto border-t border-dashed border-island-line pt-3 space-y-2">
        {aside}
        {action}
      </div>
    </div>
  );
}

/**
 * 效果進行中 — the live readout.
 *
 * Renders nothing when nothing is running, so it can be dropped anywhere without a guard at the
 * call site. It is a STATUS and never a control: using a card is done in the bag, and a chip that
 * could be clicked would be a second use path.
 */
export function ActiveEffectChip({ className = '' }: { className?: string }) {
  const { profile } = useApp();
  const now = useNow();
  const effects = readLiveEffects(profile, now);
  if (effects.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {effects.map((live) => {
        const left = remainingMs(live.effect, now);
        return (
          <span
            key={live.effect.activationId}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-island-teal/35 bg-island-teal/12 text-island-navy font-black text-xs"
            title={`${live.name}：${live.summary}`}
          >
            <Sparkles size={13} className="text-island-teal-dark" strokeWidth={2.5} aria-hidden="true" />
            <span>{live.summary}</span>
            <span className="text-island-navy-soft/70 font-bold">
              {left !== null ? formatCountdown(left) : `剩 ${live.usesLeft ?? 0} 次`}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * 我的功能卡 — the bag, and the only place a card is used.
 *
 * Deliberately NOT the shop's inventory drawer. That drawer lists things you own and wear or place;
 * these are things you spend, and the verb on every row is 使用. Cards the player does not hold are
 * still listed, greyed, with where to get one — a bag that hides what you do not have cannot teach
 * anybody that the feature exists.
 */
export function UtilityCardBag() {
  const { profile, useUtilityCard } = useApp();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const owned = useMemo(() => {
    const counts = new Map(getOwnedCards(profile?.utilityCards).map((entry) => [entry.card.id, entry.count]));
    return ALL_UTILITY_CARDS.map((card) => ({ card, count: counts.get(card.id) ?? 0 }));
  }, [profile?.utilityCards]);

  const live = readLiveEffects(profile, now);

  const handleUse = async (card: UtilityCardDefinition) => {
    if (busy) return;
    setBusy(card.id);
    setMessage(null);
    const result = await useUtilityCard(card.id);
    setBusy(null);
    if (result.ok) {
      setMessage(`${card.name} 已使用 — ${card.effectSummary}`);
      return;
    }
    setMessage(CARD_USE_MESSAGES[result.reason]);
  };

  return (
    <div className="space-y-4">
      {live.length > 0 && (
        <div className="rounded-[1.75rem] border border-island-teal/30 bg-island-teal/8 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-island-teal-dark mb-2">
            效果進行中
          </p>
          <div className="space-y-1.5">
            {live.map((effect) => {
              const left = remainingMs(effect.effect, now);
              return (
                <div key={effect.effect.activationId} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-black text-island-navy truncate">
                    {effect.name} · {effect.summary}
                  </span>
                  <span className="text-sm font-black text-island-teal-dark flex-shrink-0">
                    {left !== null ? formatCountdown(left) : `剩 ${effect.usesLeft ?? 0} 次`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {message && (
        <p className="text-xs font-bold text-island-navy-soft bg-island-cream-2 border border-island-line rounded-2xl px-4 py-2.5">
          {message}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {owned.map(({ card, count }) => (
          <UtilityCardTile
            key={card.id}
            card={card}
            count={count}
            className={count === 0 ? 'opacity-60' : ''}
            aside={
              count === 0 ? (
                <p className="text-[11px] font-bold text-island-navy-soft/70">
                  可在限時小攤購買組合包，或從輪盤抽到
                </p>
              ) : null
            }
            action={
              <Button
                variant={count > 0 ? 'primary' : 'ghost'}
                disabled={count === 0 || busy === card.id}
                onClick={() => {
                  playSound(SoundEffect.CLICK);
                  triggerHaptic('light');
                  void handleUse(card);
                }}
                className="w-full py-2.5 text-sm"
              >
                <Zap size={15} strokeWidth={2.75} />
                <span>{count > 0 ? '使用' : '尚未擁有'}</span>
              </Button>
            }
          />
        ))}
      </div>

      {owned.length === 0 && (
        <EmptyState icon={<Ticket size={32} strokeWidth={1.5} />} title="目前沒有任何功能卡" />
      )}

      {/* 模擬輪盤抽獎 / 重置功能卡 used to sit here. They moved to the 管理員測試 console
          (UI/admin/, 商店與經濟) — same real wheel table, same real grant path, but no longer
          behind this bag, which is itself behind the 限時小攤, which is itself behind the
          travelling merchant's schedule. That chain is right for the SHOP and was never meant to
          gate a QA button for the ~20-hour gap between rotations. */}
    </div>
  );
}

/**
 * The bag in a dialog — the shared pop-out, so 「我的功能卡」 is the same panel wherever it is
 * opened from (the shop header, the limited shelf's header).
 *
 * A second copy of this modal in each caller is how the two would drift into having different
 * headers, different z tiers and, eventually, different behaviour.
 */
export function UtilityCardBagModal({
  open,
  onClose,
  zIndexClassName = 'z-modal',
}: {
  open: boolean;
  onClose: () => void;
  /** Override only when the caller lives in its own local z sub-scale (e.g. ShopView). */
  zIndexClassName?: string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <ModalOverlay zIndexClassName={zIndexClassName} onClick={onClose}>
          <ModalShell maxWidthClassName="max-w-2xl" className="max-h-[85vh]">
            <PanelHeader
              icon={<Ticket size={20} strokeWidth={2.5} />}
              title="我的功能卡"
              subtitle="使用後會立刻生效"
              onClose={onClose}
            />
            <div className="p-6 overflow-y-auto custom-scrollbar">
              <UtilityCardBag />
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}

/** The 我的功能卡 button, so the shop and the limited shelf open the bag the same way. */
export function UtilityCardBagButton({
  onClick,
  className = '',
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={() => {
        playSound(SoundEffect.CLICK);
        onClick();
      }}
      className={`h-10 px-3.5 gap-2 rounded-xl bg-white border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0 ${className}`}
    >
      <Ticket size={16} strokeWidth={2.75} />
      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">我的功能卡</span>
    </button>
  );
}
