/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Check, Coins, Lock, PackageOpen, ShoppingBag, Sparkles } from 'lucide-react';
import { getBalance } from '../../constants/currency';
import { useApp } from '../../context/AppContext';
import { ItemDefinition } from '../../constants/items';
import { getAvailableStock, getOwnedCount, isStackableItem } from '../../utils/inventory';
import { getXpRemaining, getXpRequirement, isXpLocked } from '../../utils/unlock';
import { canUnlockWithFragments, getRaffleTickets } from '../../constants/fragments';
import { getItemById } from '../../constants/items';
import { FragmentShard, RaffleTicket } from './FragmentProgress';
import { Button } from './DesignKit';

/**
 * The two pieces of shop vocabulary every catalog surface shares.
 *
 * The shop grid, the outdoor build rail and the indoor furniture drawer all lay their cards out
 * differently — a big product tile, a compact rail tile, a wide list row — but a player must be
 * able to read "how many do I have left" and "what does another cost" the same way in all three.
 * Those two answers live here, so a new surface gets them right by using them rather than by
 * re-deriving counts and re-writing the copy.
 */

/**
 * Live stock readout. Placeable items show what is left to put down (stock is `owned − placed`,
 * see utils/inventory.ts); applied items (floors, walls, house appearances) just say 已解鎖,
 * because owning one is the whole story. Not-yet-owned items render nothing — the buy button
 * beside them already says so.
 */
export function StockBadge({ itemId, className = '' }: { itemId: string; className?: string }) {
  const { profile } = useApp();

  // 抽獎券 reports the BALANCE it pays into, not an inventory count — buying one adds to
  // `raffleTickets` and puts nothing in the backpack (constants/items.ts's `grantsTickets`), so
  // `getOwnedCount` is 0 for it forever and the badge below would never appear. 「我手上有幾張」
  // is the only question this card can be asked, and this is the one place every catalog surface
  // asks it.
  const tickets = getItemById(itemId)?.grantsTickets;
  if (tickets) {
    const held = getRaffleTickets(profile);
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-lg border border-island-gold/35 bg-island-gold/12 px-2 py-0.5 text-[10px] font-black text-island-navy ${className}`}
        title="目前持有的抽獎券。買下後直接加進這個數字，不會放進背包"
      >
        <RaffleTicket size={11} />
        持有 {held.toLocaleString()} 張
      </span>
    );
  }

  const owned = getOwnedCount(profile, itemId);
  if (owned === 0) return null;

  if (!isStackableItem(itemId)) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-lg border border-island-teal/20 bg-island-teal/10 px-2 py-0.5 text-[10px] font-black text-island-teal-dark ${className}`}>
        <Check size={11} strokeWidth={3} />
        已解鎖
      </span>
    );
  }

  const available = getAvailableStock(profile, itemId);
  const isEmpty = available === 0;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-black ${
        isEmpty
          ? 'border-island-line bg-island-cream-2 text-island-navy-soft/70'
          : 'border-island-teal/20 bg-island-teal/10 text-island-teal-dark'
      } ${className}`}
      title={isEmpty ? '已全部擺放，再購買一個才能繼續擺放' : undefined}
    >
      <PackageOpen size={11} strokeWidth={2.75} />
      庫存 {available}
      <span className="opacity-60">/ 已擁有 {owned}</span>
    </span>
  );
}

/**
 * Buy action. Reads 購買 the first time and 再購買 afterwards for anything that stacks, which is
 * what lets a player who wants a second fountain say so from wherever they noticed they wanted
 * it. Own-once items disable themselves once owned instead of offering a purchase that would be
 * refused.
 *
 * An 經驗值-unlocked item (utils/unlock.ts) takes the same button rather than a separate one: it
 * states the requirement while it is locked and turns into 免費解鎖 once the player reaches it, so
 * every card on the shelf still answers "what do I do with this" in the same place.
 *
 * 碎片解鎖 (constants/fragments.ts) is the same story a third time. Once a stack is full the button
 * says so INSTEAD of quoting a gold price, and — this is the part that matters — it stops being
 * disabled by 金幣不足: a player who collected 200 fragments has earned the item outright, and a
 * greyed-out button would be the shop refusing something it is not charging for. The gold route is
 * still offered inside the dialog for anyone who would rather keep the fragments.
 */
export function BuyButton({
  item,
  onClick,
  className = '',
}: {
  item: ItemDefinition;
  onClick: () => void;
  className?: string;
}) {
  const { profile } = useApp();
  const owned = getOwnedCount(profile, item.id) > 0;
  const stackable = isStackableItem(item.id);
  const cannotAfford = getBalance(profile, 'coins') < item.price;
  const alreadyOwnedOnce = owned && !stackable;
  const xpRequired = getXpRequirement(item);
  const locked = isXpLocked(profile, item);
  const fragmentReady = canUnlockWithFragments(profile, item.id, owned);

  return (
    <Button
      variant={alreadyOwnedOnce || locked ? 'ghost' : 'primary'}
      disabled={alreadyOwnedOnce || locked || (cannotAfford && !fragmentReady)}
      onClick={onClick}
      title={
        locked
          ? `還差 ${getXpRemaining(profile, item)} 經驗值才能解鎖`
          : fragmentReady
            ? '碎片已集滿，可免費解鎖'
            : cannotAfford
              ? '金幣不足'
              : undefined
      }
      className={`gap-1.5 ${className}`}
    >
      {alreadyOwnedOnce ? (
        <>
          <Check size={14} strokeWidth={3} />
          <span>已擁有</span>
        </>
      ) : locked ? (
        <>
          <Lock size={14} strokeWidth={3} />
          <span>需 {xpRequired} 經驗值</span>
        </>
      ) : xpRequired > 0 ? (
        <>
          <Sparkles size={14} strokeWidth={2.75} />
          <span>免費解鎖</span>
        </>
      ) : fragmentReady ? (
        <>
          <FragmentShard size={14} />
          <span>碎片解鎖</span>
        </>
      ) : (
        <>
          <ShoppingBag size={14} strokeWidth={2.75} />
          <span>{owned ? '再購買' : '購買'}</span>
          <span className="inline-flex items-center gap-0.5 opacity-90">
            <Coins size={12} className="text-island-gold" />
            {item.price}
          </span>
        </>
      )}
    </Button>
  );
}
