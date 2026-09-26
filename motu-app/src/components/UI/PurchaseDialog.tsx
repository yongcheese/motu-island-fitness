/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { getBalance } from '../../constants/currency';
import { motion } from 'motion/react';
import { Check, Coins, Sparkles, Zap } from 'lucide-react';
import confetti from 'canvas-confetti';
import { useApp } from '../../context/AppContext';
import { ItemDefinition } from '../../constants/items';
import { getItemCategoryLabel } from '../../utils/categoryUtils';
import { getAvailableStock, getOwnedCount, isStackableItem } from '../../utils/inventory';
import { getPlayerXp, getXpRemaining, getXpRequirement, isXpLocked } from '../../utils/unlock';
import {
  FRAGMENTS_TO_UNLOCK,
  canUnlockWithFragments,
  collectsFragments,
  getFragmentCount,
  getRaffleTickets,
  isRepeatableFragmentItem,
} from '../../constants/fragments';
import { playSound, triggerHaptic } from '../../lib/soundUtils';
import { playerBus } from '../../lib/playerBus';
import { getHairSpec } from '../../constants/hair';
import { getPurchaseFx, RarityFxSpec } from '../../constants/rarityFx';
import { getItemRarity } from '../../utils/debugOverrides';
import { isNpcPortrait, NpcPortrait, QVersionIcon } from '../QVersionIcon';
import { HairSpinPreview } from './HairSpinPreview';
import { FragmentMeter, FragmentShard, RaffleTicket } from './FragmentProgress';
import { RarityReveal } from './RarityReveal';
import { Button, IconTile, ModalOverlay, ModalShell, PanelHeader, SCRIM_NEUTRAL } from './DesignKit';

/**
 * The one purchase confirmation in the game.
 *
 * Every buy button — the shop catalog, the outdoor build rail's 購買/再購買, the indoor
 * furniture drawer's not-yet-owned section — opens this same dialog, so the price shown, the
 * balance check, the confirmation copy and the celebration are identical wherever a player
 * spends gold. Buying from where you are standing is then genuinely the same act as buying from
 * the shop, rather than a second, quieter purchase flow that happens to charge the same amount.
 *
 * The write itself belongs to the Shop System (context/useShopActions.ts); this is only its UI.
 *
 * ## The second route
 *
 * An item can also be owned by collecting {@link FRAGMENTS_TO_UNLOCK} of its own 商品碎片
 * (constants/fragments.ts). That is not a second dialog: it is this one, with a different thing being
 * spent — the same preview, the same confirmation, the same celebration. When a stack is full the
 * fragment route is what the dialog offers first, because it costs nothing, and the gold route stays
 * one tap away underneath for a player who would rather keep the fragments for the 抽獎券 that a
 * gold purchase would turn them into.
 */
export function PurchaseDialog({
  item,
  onClose,
  zIndexClassName = 'z-modal',
}: {
  /** The item being bought — `null` closes the dialog. */
  item: ItemDefinition | null;
  onClose: () => void;
  /** Override only when the caller lives in its own local z sub-scale (e.g. ShopView). */
  zIndexClassName?: string;
}) {
  const { profile, purchaseItem, unlockWithFragments } = useApp();
  const [busy, setBusy] = useState(false);
  const [purchased, setPurchased] = useState(false);
  /**
   * The player has chosen to pay gold even though the fragment route is open.
   *
   * Opt-IN rather than opt-out: with a full stack, fragments are free and gold is not, so defaulting
   * to gold would be the shop charging for something already earned. The escape hatch exists because
   * keeping the fragments is a real choice — buying with gold converts them to 抽獎券 (see
   * `fragmentPatchForPurchase`), which a player saving for the 轉盤 may well prefer.
   */
  const [payWithGold, setPayWithGold] = useState(false);
  // Set for 史詩/神話 only. While it is on, the reveal owns when this dialog closes — see
  // handleConfirm.
  const [revealing, setRevealing] = useState(false);

  if (!item) return null;

  const balance = getBalance(profile, 'coins');
  const cannotAfford = balance < item.price;
  // 經驗值-unlocked items (utils/unlock.ts) come through this same dialog: it is still the one
  // place ownership is confirmed, only the thing being spent is training rather than gold — so
  // the readout below swaps currency for XP rather than the flow forking into a second dialog.
  const xpRequired = getXpRequirement(item);
  const xpLocked = isXpLocked(profile, item);
  const ownedCount = getOwnedCount(profile, item.id);
  const stackable = isStackableItem(item.id);
  const hairSpec = getHairSpec(item.id);

  // The tier this purchase celebrates as. ALWAYS a tier — every catalog item is graded
  // (constants/rarity.ts) — which is why the reveal below is gated on `revealing` alone rather
  // than on the item having one. Read through getItemRarity rather than off the item so the
  // ?rarity= debug override reaches the celebration too: 史詩 is sixteen items and 神話 is one, so
  // that URL is still the only practical way to look at either of their reveals.
  const rarity = getItemRarity(item);
  const fx = getPurchaseFx(rarity);

  // The fragment route, and whether this confirmation is currently spending fragments or gold.
  const fragmentsHeld = getFragmentCount(profile, item.id);
  // 「還在收集嗎」, not 「已擁有嗎」. A stackable item keeps collecting after the first copy — see
  // constants/fragments.ts. This is what decides whether the meter below is drawn at all, and it has
  // to be the same predicate the write path uses, or the dialog will offer a route the write refuses
  // (or hide one it would have allowed).
  const stillCollecting = collectsFragments(item.id, ownedCount > 0);
  const fragmentReady = canUnlockWithFragments(profile, item.id, ownedCount > 0);
  const usingFragments = fragmentReady && !payWithGold;

  const close = () => {
    setPurchased(false);
    setBusy(false);
    setRevealing(false);
    setPayWithGold(false);
    onClose();
  };

  // Fires a tier's bursts on canvas-confetti's global canvas. Only the tiers without a reveal
  // come through here; 史詩/神話 hand their bursts to RarityReveal, which owns a canvas that can
  // actually be seen above the reveal's own dim.
  const celebrate = (fx: RarityFxSpec) => {
    for (const burst of fx.confetti) {
      const fire = () => confetti({
        particleCount: burst.particleCount,
        spread: burst.spread,
        colors: burst.colors,
        ticks: burst.ticks,
        startVelocity: burst.startVelocity,
        angle: burst.angle,
        origin: burst.origin ?? { x: 0.5, y: 0.6 },
        shapes: ['circle', 'square'],
        disableForReducedMotion: true,
      });
      if (burst.delay) setTimeout(fire, burst.delay); else fire();
    }
  };

  const handleConfirm = async () => {
    if (busy || purchased) return;
    // The tap's own acknowledgement, deliberately the lightest one available: how hard the phone
    // buzzes for the PURCHASE is graded by tier below, and a heavy thud on the press would land
    // harder than 普通's own celebration and invert the ladder before it started.
    triggerHaptic('light');
    setBusy(true);
    // The two routes differ in exactly one line — what is spent. Everything after it (the tier's
    // haptics, its sounds, its confetti or its reveal) is the same table played back, because owning
    // the item is the same event however it was earned.
    const result = usingFragments
      ? await unlockWithFragments(item.id)
      : await purchaseItem(item.id);
    setBusy(false);
    if (result !== 'ok') return;

    // Everything from here is one row of constants/rarityFx.ts (`fx`) played back. No branch in
    // this function knows a tier name — adding a tier is a row in that table, not an `if` here.
    // `hapticDelayMs` is what lets the reveal tiers thump when the item LANDS rather than when the
    // button was pressed — see constants/rarityFx.ts. It defaults to 0, so every other tier still
    // buzzes on the frame it always did.
    fx.haptic.forEach((strength, i) => {
      const at = (fx.hapticDelayMs ?? 0) + i * fx.hapticGapMs;
      if (at === 0) triggerHaptic(strength);
      else setTimeout(() => triggerHaptic(strength), at);
    });
    for (const sound of fx.sounds) {
      if (sound.delayMs) setTimeout(() => playSound(sound.effect, sound.volume), sound.delayMs);
      else playSound(sound.effect, sound.volume);
    }

    setPurchased(true);
    playerBus.happyReactionCount = (playerBus.happyReactionCount || 0) + 1;

    if (fx.reveal) {
      // No close timer at all: the reveal calls back when it has finished playing. This used to
      // be a flat 1200ms for every purchase, which is most of a second SHORTER than the reveal —
      // the dialog would vanish mid-flash. Swapping in a larger constant would have been the same
      // bug with a better number.
      setRevealing(true);
    } else {
      celebrate(fx);
      if (fx.closeDelayMs !== null) setTimeout(close, fx.closeDelayMs);
    }
  };

  return (
    <>
    {/* Neutral scrim, not the ink one every other modal uses. Two reasons, and the second is the
        one that decided it.
        A purchase is the only modal in the game that can hand straight over to a full-screen
        celebration, and the reveal's ground is neutral black — on the ink scrim the handover was
        a blue screen turning into a dark one, which is a colour change happening at the exact
        moment the player is supposed to be looking at what they bought.
        And it is what the player is looking at for the whole confirmation before that: navy at 45%
        over the cream shop is roughly #9AA5A4, which is a blue-grey wash. It suits a settings panel;
        it does not suit the moment a warm shop is about to give someone a pet. */}
    <ModalOverlay zIndexClassName={zIndexClassName} scrimClassName={SCRIM_NEUTRAL} onClick={close}>
      <ModalShell maxWidthClassName="max-w-sm">
        <PanelHeader
          icon={
            usingFragments
              ? <FragmentShard size={20} />
              : xpRequired > 0
                ? <Zap size={20} strokeWidth={2.5} />
                : <Coins size={20} strokeWidth={2.5} />
          }
          title={usingFragments ? '請確認碎片解鎖' : xpRequired > 0 ? '請確認解鎖獎勵' : '請確認購買商品'}
          subtitle={usingFragments ? 'FRAGMENT UNLOCK' : xpRequired > 0 ? 'XP UNLOCK' : 'STORE PURCHASE'}
          onClose={close}
        />

        <div className="p-6 flex flex-col items-center text-center">
          {/* Hairstyles get the turntable instead of the flat icon. They are the one category
              whose back is as much of the purchase as its front, and the thumbnail only ever
              shows the front. Everything else stays on the icon: a turntable of a hat or a pair
              of trousers would be motion for its own sake. */}
          {hairSpec ? (
            <div className="my-1">
              <HairSpinPreview spec={hairSpec} size={160} />
            </div>
          ) : isNpcPortrait(item.id) ? (
            // 居民填滿整格，跟商店卡上同一張半身照 —— 這裡是玩家決定要不要把這個人請上島的
            // 地方，一顆浮在格子中央的小頭給不了那個決定任何東西。
            <IconTile size={160} className="my-1">
              {/* IconTile 是 flex 置中的定高方格，所以 NpcPortrait 自己的 w-full h-full 就填得滿；
                  不從外面丟 absolute 進去 —— 兩個 position 打架時贏的是樣式表順序（DESIGN_SYSTEM.md）。 */}
              <NpcPortrait itemId={item.id} />
            </IconTile>
          ) : (
            <IconTile size={160} className="my-1">
              <div className="scale-[1.08] flex items-center justify-center">
                <QVersionIcon itemId={item.id} size={110} />
              </div>
            </IconTile>
          )}

          <div className="space-y-3.5 w-full mt-3">
            <div>
              <h4 className="text-lg font-black text-island-navy leading-tight mb-1">{item.name}</h4>
              <span className="text-xs text-island-navy-soft/70 font-bold">
                分類：{getItemCategoryLabel(item.id)}
              </span>
              <p className="text-xs text-island-navy-soft/70 font-medium leading-relaxed mt-1.5 px-2 line-clamp-2">
                {item.description}
              </p>
            </div>

            <div className="bg-island-cream-2 p-4 rounded-2xl border border-island-line space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-island-navy-soft/70">
                <span>{usingFragments ? '目前碎片：' : xpRequired > 0 ? '目前經驗值：' : '目前持有：'}</span>
                <span className="flex items-center gap-1 text-island-navy font-black">
                  {usingFragments ? (
                    <>
                      <FragmentShard size={14} />
                      {fragmentsHeld.toLocaleString()}
                    </>
                  ) : xpRequired > 0 ? (
                    <>
                      <Zap size={14} className="text-island-teal" strokeWidth={2.75} />
                      {getPlayerXp(profile).toLocaleString()}
                    </>
                  ) : (
                    <>
                      <Coins size={14} className="text-island-gold" />
                      {balance.toLocaleString()}
                    </>
                  )}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-island-line pt-2">
                <span className="text-sm font-bold text-island-navy">
                  {usingFragments ? '解鎖需要：' : xpRequired > 0 ? '解鎖條件：' : '購買價格：'}
                </span>
                <div className="flex items-center gap-1 text-base font-black text-island-navy">
                  {usingFragments ? (
                    <>
                      <FragmentShard size={15} />
                      <span>{FRAGMENTS_TO_UNLOCK}</span>
                      <span className="text-xs font-bold text-island-navy-soft/70">碎片 · 不扣金幣</span>
                    </>
                  ) : xpRequired > 0 ? (
                    <>
                      <Zap size={15} className="text-island-teal" strokeWidth={2.75} />
                      <span>{xpRequired}</span>
                      <span className="text-xs font-bold text-island-navy-soft/70">經驗值</span>
                    </>
                  ) : (
                    <>
                      <Coins size={15} className="text-island-gold" />
                      <span>{item.price}</span>
                    </>
                  )}
                </div>
              </div>
              {/* Said outright, because an unlock that costs nothing looks like a missing price. */}
              {xpRequired > 0 && !xpLocked && (
                <div className="flex items-center justify-between border-t border-island-line pt-2 text-xs font-bold text-island-navy-soft/70">
                  <span>已達成解鎖條件</span>
                  <span className="text-island-teal-dark font-black">免費領取，不扣金幣</span>
                </div>
              )}
              {/* 抽獎券 says what the purchase does to the balance it actually pays into. Without
                  this the dialog is silent about where the goods go: the two lines above talk about
                  金幣, the 已擁有 line below cannot fire (a ticket never enters the inventory), and
                  the player is left to trust that a card called 抽獎券 becomes a 抽獎券. */}
              {item.grantsTickets && (
                <div className="flex items-center justify-between border-t border-island-line pt-2 text-xs font-bold text-island-navy-soft/70">
                  <span className="inline-flex items-center gap-1">
                    <RaffleTicket size={13} />
                    目前持有 {getRaffleTickets(profile).toLocaleString()} 張
                  </span>
                  <span className="text-island-navy font-black">
                    購買後 {(getRaffleTickets(profile) + item.grantsTickets).toLocaleString()} 張
                  </span>
                </div>
              )}

              {/* Stackable items say what a second copy buys you, so 再購買 never looks like a
                  mis-tap on something already owned. */}
              {stackable && ownedCount > 0 && (
                <div className="flex items-center justify-between border-t border-island-line pt-2 text-xs font-bold text-island-navy-soft/70">
                  <span>已擁有 {ownedCount} 件</span>
                  <span>可擺放庫存 {getAvailableStock(profile, item.id)} 件</span>
                </div>
              )}

              {/* 商品碎片. Shown whenever this item is still collecting — including at 0 — because
                  this dialog is where a player decides how to get the thing, and 「還有另一條路，你
                  走了多遠」 is part of that decision. On the shelf it would be noise under every
                  card; here it is the answer to the question being asked.

                  The gate used to be `ownedCount === 0`, which hid the meter the moment one copy was
                  owned — on a stackable item that is precisely when the dialog is open to buy the
                  SECOND one, and the fragments being collected are for it. */}
              {stillCollecting && (
                <div className="border-t border-island-line pt-2.5">
                  <FragmentMeter itemId={item.id} />
                </div>
              )}

              {/* What the gold route COSTS beyond the gold, said out loud. Buying now converts the
                  stack (context/useShopActions.ts), and a player who has been collecting deserves to
                  learn that before the write, not from a number that quietly changed afterwards.

                  Not shown for a repeat-buyable item, because there it is no longer TRUE: buying one
                  with gold leaves the stack alone, since it is still valid for the next copy — see
                  `fragmentPatchForPurchase`. The warning and the write are the same rule read twice,
                  so they move together. */}
              {!usingFragments && !fragmentReady && fragmentsHeld > 0 && !isRepeatableFragmentItem(item) && ownedCount === 0 && (
                <div className="flex items-start gap-1.5 border-t border-island-line pt-2 text-[11px] font-bold text-island-navy-soft/70">
                  <FragmentShard size={12} className="mt-0.5 flex-shrink-0" />
                  <span>用金幣購買後，已收集的 {fragmentsHeld} 個碎片會轉換成抽獎券。</span>
                </div>
              )}
            </div>

            {xpLocked ? (
              <div className="bg-island-coral/10 border border-island-coral/25 rounded-xl p-2.5 text-island-coral text-center text-xs font-bold">
                經驗值不足！還差 {getXpRemaining(profile, item)} 經驗值才能解鎖。
              </div>
            ) : cannotAfford && !usingFragments && (
              <div className="bg-island-coral/10 border border-island-coral/25 rounded-xl p-2.5 text-island-coral text-center text-xs font-bold">
                餘額不足！您的金幣數量不足以購買此商品。
              </div>
            )}

            {/* Switching routes. Only ever offered when BOTH are open, and always phrased as what it
                costs rather than as a mode toggle — a player should never have to work out which of
                two states a switch is currently in to know what pressing 確認 will spend. */}
            {fragmentReady && !purchased && (
              <button
                onClick={() => { triggerHaptic('light'); setPayWithGold(v => !v); }}
                className="w-full text-[11px] font-bold text-island-navy-soft/70 hover:text-island-teal-dark underline underline-offset-4 decoration-island-line transition-colors cursor-pointer"
              >
                {usingFragments
                  ? `保留碎片，改用 ${item.price.toLocaleString()} 金幣購買`
                  : `改用 ${FRAGMENTS_TO_UNLOCK} 個碎片免費解鎖`}
              </button>
            )}

            <div className="pt-2 flex gap-3">
              <Button variant="secondary" onClick={close} className="flex-1 py-3 text-sm">
                取消
              </Button>
              <motion.button
                disabled={!purchased && (busy || (cannotAfford && !usingFragments) || xpLocked)}
                animate={purchased ? { scale: [1, 1.15, 1.05, 1.12, 1], transition: { duration: 0.9, ease: 'easeInOut' } } : { scale: 1 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirm}
                className={`flex-1 py-3.5 rounded-xl text-white font-black text-base flex items-center justify-center gap-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none duration-150 cursor-pointer ${
                  purchased ? 'bg-island-gold shadow-[0_10px_24px_rgba(232,170,62,0.35)]' : 'confirm-buy-btn'
                }`}
              >
                {busy && !purchased ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : purchased ? (
                  <>
                    <Sparkles size={16} className="text-white animate-bounce" strokeWidth={3} />
                    <span className="uppercase tracking-wide">{xpRequired > 0 || usingFragments ? '解鎖成功！' : '購入成功！'}</span>
                  </>
                ) : usingFragments ? (
                  <>
                    <FragmentShard size={16} />
                    <span>用碎片解鎖</span>
                  </>
                ) : (
                  <>
                    <Check size={16} strokeWidth={3} />
                    <span>{xpRequired > 0 ? '確認解鎖' : '確認購買'}</span>
                  </>
                )}
              </motion.button>
            </div>
          </div>
        </div>
      </ModalShell>
    </ModalOverlay>

    {/* Rendered as a SIBLING of the dialog, not inside it: the reveal has to cover the dialog it
        was launched from, and a child of `.z-modal`'s stacking context can never out-rank its own
        ancestor no matter what z-index it is given. `.z-reveal` (1500) is the tier that says so —
        see index.css's layer table. */}
    {revealing && (
      <RarityReveal
        item={item}
        rarity={rarity}
        bursts={fx.confetti}
        turns={fx.revealTurns}
        shake={fx.shake}
        onDone={close}
      />
    )}
    </>
  );
}
