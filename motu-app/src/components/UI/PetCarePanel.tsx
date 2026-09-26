/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Bone, Dog, HeartHandshake, PawPrint, Utensils } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getItemById } from '../../constants/items';
import { getPetFoodsFor } from '../../constants/consumables';
import { equippedPetId, readPetCondition } from '../../context/usePetCare';
import { resolveRestingSpot } from '../../lib/petRestingSpots';
import { PET_HABITAT_KINDS } from '../../constants/petHabitats';
import { PET_SPECIES_TABLE, getPetSpec, getPetSpecies } from '../../constants/pets';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { getAvailableStock } from '../../utils/inventory';
import { QVersionIcon } from '../QVersionIcon';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from './DesignKit';

/**
 * 我的寵物 — the only screen that ever shows the numbers, and the only place a feed is chosen.
 *
 * The brief's §14 is the whole design brief for this file: a player must be able to understand how
 * their companion is doing, and the game must NOT become a survival HUD to tell them. So nothing
 * here is on the island. There is no energy bar over the pet's head, no hunger icon in the corner,
 * no badge on the nav. Out in the world the animal's STATE is its behaviour — how briskly it walks,
 * how often it settles, whether it has taken itself off to its bed — and this panel exists for the
 * moment a player deliberately asks 「牠還好嗎」.
 *
 * The two meters below are therefore the exception that proves the rule: they are behind a button,
 * on a screen the player opened on purpose, and they are the only numeric read-out the feature has.
 *
 * ## Why the empty state still lists the food
 *
 * A player who has never bought 基礎飼料 still sees its card, greyed, with where to get one — the
 * same rule 我的功能卡 follows (UI/UtilityCard.tsx). A bag that hides what you do not have cannot
 * teach anybody that the feature exists.
 */
export function PetCareBag({ onArmed }: { onArmed?: () => void }) {
  const { profile, armPetFeeding, pendingPetFood, cancelPetFeeding } = useApp();
  const home = usePlayerHome(profile);

  /**
   * The clock the panel reads its numbers at.
   *
   * Sampled when the panel opens rather than ticked: nutrition moves by half a percent an hour, so
   * a per-second re-render would be a re-render a second to redraw the same two bars. Re-sampled
   * whenever the profile changes, which is what makes a feed's result appear immediately.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setNow(Date.now()), [profile?.islandState?.pet]);

  const petId = equippedPetId(profile);
  const pet = petId ? getItemById(petId) : undefined;
  const condition = readPetCondition(profile, petId, now);

  const restSpot = useMemo(
    () =>
      resolveRestingSpot({
        placements: profile?.islandPlacements ?? [],
        home,
        islandScale: 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4,
        petItemId: petId,
      }),
    [profile?.islandPlacements, profile?.territoryLevel, home, petId],
  );

  /**
   * What this panel lists — built from the catalog, never from a list of its own, so a second food
   * is one row in constants/items.ts and appears here with no edit (constants/consumables.ts).
   *
   * Narrowed to what the companion out on the island can actually eat (§17). Every row here arms a
   * feed, so a row this animal cannot be given is a button that would be refused — which is exactly
   * the 「買了狗窩想給鳥用，系統跳出錯誤」 shape §5 rules out, in food form.
   *
   * With NO companion out, the shelf is shown whole. There is no animal to be wrong for, and this
   * is also the shop-side screen: a player deciding whether to buy a cat wants to see that cats
   * have food. That is the one difference between this list and the in-world panel's, which is
   * always standing in front of a specific animal (UI/PetInteractionPanel.tsx).
   */
  const foods = useMemo(() => getPetFoodsFor(getPetSpecies(petId)), [petId]);

  const handleArm = (itemId: string) => {
    playSound(SoundEffect.CLICK);
    armPetFeeding(itemId);
    onArmed?.();
  };

  return (
    <div className="space-y-4">
      {petId && pet ? (
        <div className="rounded-[1.75rem] border border-island-line bg-island-cream-2 p-4">
          <div className="flex items-center gap-3 mb-3">
            <QVersionIcon itemId={petId} size={44} />
            <div className="min-w-0">
              <p className="text-sm font-black text-island-navy truncate">{pet.name}</p>
              {/* The BAND, not the number. 「悠閒」 is what the player wants to know; 0.71 is what the
                  behaviour layer wants to know, and only one of them belongs on a card. The species
                  beside it, because everything below this card — the food list, the resting spot —
                  is filtered by it, and a filter the player cannot see is a list with things
                  mysteriously missing from it. */}
              <p className="text-xs font-bold text-island-teal-dark">
                {PET_SPECIES_TABLE[getPetSpecies(petId)!]?.label}・{condition.band.label}
              </p>
            </div>
          </div>
          <p className="text-xs font-bold text-island-navy-soft/80 leading-relaxed mb-3">
            {condition.band.note}
          </p>
          <div className="space-y-2">
            <CareMeter label="營養" value={condition.nutrition} />
            <CareMeter label="活動力" value={condition.activity} />
          </div>
          <p className="text-[11px] font-bold text-island-navy-soft/60 mt-3 flex items-center gap-1.5">
            <PawPrint size={12} strokeWidth={2.5} className="flex-shrink-0" />
            {/* Where it sleeps, said plainly, because it is the one piece of state the player can
                change with a purchase rather than with food. A default spot says so, so 「買一個窩」
                is discoverable from the screen that made you wonder about it. */}
            <span>
              休息位置：{restSpot.label}
              {restSpot.kind
                ? `（${PET_HABITAT_KINDS[restSpot.kind].label}）`
                : `（還沒有自己的窩，商店的「寵物窩」有適合${
                    PET_SPECIES_TABLE[getPetSpecies(petId)!]?.label ?? ''
                  }的款式）`}
            </span>
          </p>
        </div>
      ) : (
        <EmptyState
          icon={<Dog size={28} strokeWidth={2} />}
          title="還沒有寵物在身邊"
          description="先到更衣室帶一隻寵物出場，這裡就會顯示牠的狀態，也才能餵牠。"
          bordered
        />
      )}

      {pendingPetFood && (
        <div className="rounded-2xl border border-island-teal/30 bg-island-teal/8 px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs font-black text-island-teal-dark">
            已選好「{getItemById(pendingPetFood)?.name ?? '飼料'}」，走到寵物旁邊按提示餵牠
          </p>
          <Button variant="ghost" className="px-3 py-1.5 text-xs" onClick={cancelPetFeeding}>
            取消
          </Button>
        </div>
      )}

      <div className="space-y-3">
        {foods.map((food) => {
          const stock = getAvailableStock(profile, food.id);
          const armed = pendingPetFood === food.id;
          return (
            <div
              key={food.id}
              className={`rounded-[1.75rem] border p-4 flex items-center gap-4 transition-colors ${
                armed ? 'border-island-teal bg-island-teal/6' : 'border-island-line bg-white'
              } ${stock === 0 ? 'opacity-60' : ''}`}
            >
              <QVersionIcon itemId={food.id} size={48} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-island-navy truncate">
                  {food.name}
                  <span className="ml-2 text-xs font-black text-island-navy-soft/60 font-mono">×{stock}</span>
                </p>
                <p className="text-[11px] font-bold text-island-teal-dark">
                  {food.consumable?.effectSummary}
                </p>
                <p className="text-[11px] font-bold text-island-navy-soft/70 mt-1 leading-relaxed">
                  {stock > 0 ? food.consumable?.useHint : '目前沒有存貨，可以到商店的寵物分頁購買。'}
                </p>
              </div>
              <Button
                variant={armed ? 'ghost' : 'primary'}
                className="px-4 py-2.5 text-sm flex-shrink-0"
                disabled={stock === 0 || !petId}
                onClick={() => (armed ? cancelPetFeeding() : handleArm(food.id))}
              >
                <Utensils size={15} strokeWidth={2.75} />
                {armed ? '已選擇' : food.consumable?.verb ?? '使用'}
              </Button>
            </div>
          );
        })}
      </div>

      {/* 管理員測試 — 直接設定寵物狀態 used to be a dashed block at the bottom of this sheet. It
          moved to the 管理員測試 console (UI/admin/, 寵物), which also freed it from this panel's
          own gate: 寵物照護 only opens while a companion is out, so the test buttons were
          unreachable in exactly the situation where a tester most wants them. The write path
          (context/usePetCare.ts) and the 「just above the band's floor」 rule came across unchanged. */}
    </div>
  );
}

/**
 * One soft meter.
 *
 * Deliberately not a `StatTile` and deliberately not a percentage in large type: this is the one
 * place in the game a raw 0..1 is shown, and the design intent (§14) is that it reads as 「大概這樣」
 * rather than as a resource being tracked. The number is there in small mono for the player who
 * wants it, and the bar is what everybody else reads.
 */
export function CareMeter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] font-black uppercase tracking-widest text-island-navy-soft/70 w-12 flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 h-2.5 rounded-full bg-island-sand overflow-hidden border border-island-line">
        <div
          className="h-full rounded-full bg-island-teal transition-[width] duration-500"
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <span className="text-[11px] font-black font-mono text-island-navy-soft/70 w-9 text-right flex-shrink-0">
        {pct}%
      </span>
    </div>
  );
}

/**
 * The bag in a dialog — the shared pop-out, so 「我的寵物」 is the same panel wherever it is opened
 * from. Same arrangement as `UtilityCardBagModal`, and for the same reason: a second copy of this
 * modal per caller is how two of them drift into different headers and different behaviour.
 */
export function PetCareModal({
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
          <ModalShell maxWidthClassName="max-w-xl" className="max-h-[85vh]">
            <PanelHeader
              icon={<HeartHandshake size={20} strokeWidth={2.5} />}
              title="我的寵物"
              subtitle="看看牠的狀態，選飼料餵牠"
              onClose={onClose}
            />
            <div className="p-6 overflow-y-auto custom-scrollbar">
              {/* Arming a feed closes the panel: the next step is walking over to the animal, and a
                  dialog left open over the island would be in the way of doing it. */}
              <PetCareBag onArmed={onClose} />
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}

/** The 我的寵物 button, so every surface opens the panel the same way. */
export function PetCareButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  const { profile } = useApp();
  // Hidden entirely with no companion out. This button offers to feed an animal, and offering that
  // to a player who has none is an invitation to a dead end — the shop's 寵物 shelves are the answer
  // to 「我還沒有寵物」, and they are already on the screen this button sits on.
  if (!(profile?.equippedItems ?? []).some((id) => !!getPetSpec(id))) return null;
  return (
    <button
      onClick={() => {
        playSound(SoundEffect.CLICK);
        onClick();
      }}
      className={`h-10 px-3.5 gap-2 rounded-xl bg-white border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0 ${className}`}
    >
      <Bone size={16} strokeWidth={2.75} />
      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">我的寵物</span>
    </button>
  );
}
