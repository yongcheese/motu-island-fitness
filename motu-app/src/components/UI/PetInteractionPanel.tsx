/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ChevronLeft, Hand, Home, PawPrint, ShoppingBag, Utensils, Volleyball } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { getItemById } from '../../constants/items';
import { getPetFoodsFor } from '../../constants/consumables';
import { PET_HABITAT_KINDS } from '../../constants/petHabitats';
import { getPetSpecies, PET_SPECIES_TABLE } from '../../constants/pets';
import { equippedPetId, readPetCondition } from '../../context/usePetCare';
import { resolveRestingSpot } from '../../lib/petRestingSpots';
import { usePlayerHome } from '../../hooks/usePlayerHome';
import { getAvailableStock } from '../../utils/inventory';
import { playerBus } from '../../lib/playerBus';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { QVersionIcon } from '../QVersionIcon';
import { Button, EmptyState, ModalOverlay, ModalShell, PanelHeader } from './DesignKit';
import { CareMeter } from './PetCarePanel';

/**
 * 寵物互動面板 — what opens when the player walks up to their companion and presses the prompt.
 *
 * This is the brief's §14–§19 in one component, and it exists because the old feeding flow was
 * inside-out. Feeding used to start in a menu: open 我的寵物, pick a food, ARM it, walk to the
 * animal, press E. Five steps, three of them before you were anywhere near the pet, and the food
 * had to be chosen before you could see how hungry it was.
 *
 * The flow now starts where the player is already looking:
 *
 *   走近寵物 → [E] 與寵物互動 → 這個面板 → 餵食 → 選一種食物 → 完成
 *
 * ## What it deliberately is not
 *
 * It is NOT opened by proximity. §16 is explicit, and it is right: a panel that appears because you
 * walked past your dog is a panel that appears while you are trying to walk past your dog. Being
 * near the animal produces one small floating badge (UI/InteractionPrompt.tsx); this only opens
 * because the player asked it to.
 *
 * It is also not a second 我的寵物 (UI/PetCarePanel.tsx). That one is the shop-side screen — the
 * place to browse everything you could feed, including what you do not own — and it is where
 * arming a food for later still lives. This is the in-world one: the animal is in front of you, so
 * everything here acts on it immediately and everything you cannot do right now is absent.
 *
 * ## Which animal
 *
 * The one the prompt was pointing at, read off the bus (`playerBus.petTargetId`) at the moment the
 * panel opens and held for as long as it is open. Not re-read per render, and NOT resolved from the
 * profile: with more than one companion out, 「the pet」 is not a thing the profile can answer — the
 * only component that knows which animal the player walked up to is the one drawing it. That is
 * §21, and it is one field rather than a targeting system.
 */
export function PetInteractionPanel() {
  const { profile, currentView, setCurrentView } = useApp();
  const home = usePlayerHome(profile);

  /** The animal this panel is about, or null when it is closed. Opening captures it once. */
  const [petItemId, setPetItemId] = useState<string | null>(null);
  /** `home` — name, state, what you can do. `feed` — the food list. Never both at once. */
  const [view, setView] = useState<'home' | 'feed'>('home');
  const [busy, setBusy] = useState(false);
  /**
   * The clock the meters are read at. Sampled on open and whenever the save changes, never ticked —
   * 營養 moves by half a percent an hour, so a running timer would be a re-render a second to redraw
   * the same two bars. Same rule UI/PetCarePanel.tsx follows.
   */
  const [now, setNow] = useState(() => Date.now());

  const close = useCallback(() => {
    setPetItemId(null);
    setView('home');
  }, []);

  useEffect(() => {
    const onInteract = () => {
      // The prompt's target first; the equipped companion as a fallback for any caller that opened
      // this without one in reach (there is none today, and a panel that opened empty would be a
      // dead end if one appeared).
      const target = playerBus.petTargetId ?? equippedPetId(profile);
      if (!target) return;
      playSound(SoundEffect.CLICK);
      setPetItemId(target);
      setView('home');
      setNow(Date.now());
    };
    window.addEventListener('pet-interact', onInteract);
    return () => window.removeEventListener('pet-interact', onInteract);
  }, [profile]);

  // A feed, an unequip or a purchase all land here as a new profile; re-reading the clock is what
  // makes the meters show the result of what just happened.
  useEffect(() => setNow(Date.now()), [profile?.islandState?.pet, profile?.inventory]);

  // Leaving the island closes it. A panel about an animal standing on the grass has nothing to say
  // from inside the house or the shop.
  useEffect(() => {
    if (currentView !== View.HOME) close();
  }, [currentView, close]);

  // The pet being put away while its panel is open — the one way this can be left pointing at an
  // animal that is no longer there.
  useEffect(() => {
    if (petItemId && !(profile?.equippedItems ?? []).includes(petItemId)) close();
  }, [petItemId, profile?.equippedItems, close]);

  const pet = petItemId ? getItemById(petItemId) : undefined;
  const species = getPetSpecies(petItemId);
  const speciesDef = species ? PET_SPECIES_TABLE[species] : undefined;
  const condition = readPetCondition(profile, petItemId, now);

  const restSpot = useMemo(
    () =>
      resolveRestingSpot({
        placements: profile?.islandPlacements ?? [],
        home,
        islandScale: 1 + ((profile?.territoryLevel ?? 1) - 1) * 0.4,
        petItemId,
      }),
    [profile?.islandPlacements, profile?.territoryLevel, home, petItemId],
  );

  /**
   * What this animal can be given, right now — §17's whole requirement, as one filter.
   *
   * Two narrowings, in this order and for different reasons. `getPetFoodsFor(species)` is
   * COMPATIBILITY: a dog is never shown birdseed, whether or not the player owns any, because
   * offering it and then refusing it is worse than never offering it. The stock filter is
   * POSSESSION: a food the player has run out of is not a choice, it is a disappointment — and the
   * empty state below is a better answer to 「我沒有食物」 than a list of greyed-out rows.
   *
   * (我的寵物 makes the opposite call and shows what you do not own, greyed, with where to get it.
   * That is a shop-side screen whose job includes teaching what exists; this one is a player
   * standing next to a hungry animal.)
   */
  const foods = useMemo(() => {
    if (!species) return [];
    return getPetFoodsFor(species).filter((food) => getAvailableStock(profile, food.id) > 0);
  }, [species, profile]);

  const handleFeed = useCallback(
    async (foodId: string) => {
      if (!petItemId || busy) return;
      setBusy(true);
      try {
        // Dispatched rather than written here, exactly as the E key and the floating badge do it:
        // the write, the sound, the 進食 animation and the toast all belong to the component that
        // owns feeding (UI/PetFeeding.tsx). A panel that called `feedPet` itself would be a second
        // place that has to remember to start the animation and say what happened.
        window.dispatchEvent(
          new CustomEvent('pet-feed', { detail: { itemId: foodId, petItemId } }),
        );
        triggerHaptic('light');
        close();
      } finally {
        setBusy(false);
      }
    },
    [petItemId, busy, close],
  );

  const handlePet = useCallback(() => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    window.dispatchEvent(new CustomEvent('start-pet-dog'));
    close();
  }, [close]);

  /**
   * 陪牠玩. Dispatched rather than started here, for the reason feeding is: the animal on the island
   * (Three/IslandPet.tsx) is the only thing that knows its species — and so whether it fetches,
   * pounces or swoops — and which way its owner is facing when the toy leaves the hand.
   */
  const handlePlay = useCallback(() => {
    if (!petItemId) return;
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    window.dispatchEvent(new CustomEvent('pet-play', { detail: { petItemId } }));
    close();
  }, [petItemId, close]);

  const goToShop = useCallback(() => {
    playSound(SoundEffect.CLICK);
    // The same steer 更衣室 uses to send a player to the right rack (DressingRoomView): the shop
    // restores `last_selected_category` on open, so writing it is how one screen deep-links
    // another without the storefront growing a prop for every caller.
    localStorage.setItem('last_selected_category', 'PetSupplies');
    close();
    setCurrentView(View.SHOP);
  }, [close, setCurrentView]);

  const open = !!petItemId && !!pet && currentView === View.HOME;

  return (
    <AnimatePresence>
      {open && (
        <ModalOverlay onClick={close}>
          <ModalShell maxWidthClassName="max-w-md" className="max-h-[80vh]">
            <PanelHeader
              icon={
                view === 'feed' ? (
                  <Utensils size={20} strokeWidth={2.5} />
                ) : (
                  <PawPrint size={20} strokeWidth={2.5} />
                )
              }
              title={view === 'feed' ? `餵${pet!.name}` : pet!.name}
              subtitle={
                view === 'feed'
                  ? `只顯示${speciesDef?.label ?? ''}吃得到的食物`
                  : `${speciesDef?.label ?? '寵物'}・${condition.band.label}`
              }
              onClose={close}
            />

            <div className="p-5 md:p-6 overflow-y-auto custom-scrollbar">
              {view === 'home' ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-island-cream-2 border border-island-line flex items-center justify-center flex-shrink-0">
                      <QVersionIcon itemId={petItemId!} size={52} />
                    </div>
                    <p className="text-xs font-bold text-island-navy-soft/80 leading-relaxed min-w-0">
                      {condition.band.note}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <CareMeter label="營養" value={condition.nutrition} />
                    <CareMeter label="活動力" value={condition.activity} />
                  </div>

                  {/* 休息處 — said here because this is where the player is standing when they
                      wonder about it, and because it is the one piece of this animal's state that a
                      purchase changes rather than food. A default spot says so plainly, so 「牠該有
                      個自己的窩」 is discoverable from the screen that made you ask. */}
                  <div className="rounded-2xl border border-island-line bg-island-cream-2 px-4 py-3 flex items-start gap-2.5">
                    <Home size={14} strokeWidth={2.75} className="text-island-teal-dark flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-island-navy">休息處：{restSpot.label}</p>
                      <p className="text-[11px] font-bold text-island-navy-soft/70 leading-relaxed mt-0.5">
                        {restSpot.kind
                          ? PET_HABITAT_KINDS[restSpot.kind].note
                          : `還沒有專屬的休息處，商店的「寵物窩」有適合${speciesDef?.label ?? '牠'}的款式。`}
                      </p>
                    </div>
                  </div>

                  {/* Three actions, laid out as a grid so they share the width evenly at every size
                      and wrap to one column on a narrow phone. No absolute positioning anywhere in
                      this panel — see §22. */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <Button
                      variant="primary"
                      className="px-4 py-3 text-sm"
                      onClick={() => {
                        playSound(SoundEffect.CLICK);
                        setView('feed');
                      }}
                    >
                      <Utensils size={16} strokeWidth={2.75} />
                      餵食
                    </Button>
                    <Button variant="secondary" className="px-4 py-3 text-sm" onClick={handlePet}>
                      <Hand size={16} strokeWidth={2.75} />
                      摸摸{speciesDef?.companionNoun ?? '牠'}
                    </Button>
                    <Button variant="secondary" className="px-4 py-3 text-sm" onClick={handlePlay}>
                      <Volleyball size={16} strokeWidth={2.75} />
                      陪牠玩
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {foods.length === 0 ? (
                    // §18 — never an empty feeding list. What the player is missing is said in
                    // their own terms, and the way out is offered without being taken for them:
                    // this opens the right shelf, it does not buy anything.
                    <EmptyState
                      icon={<Utensils size={28} strokeWidth={2} />}
                      title={`目前沒有適合${speciesDef?.label ?? '這隻寵物'}的食物`}
                      description={`${pet!.name}吃得到的飼料與零食都在商店的「寵物用品」裡，買了會放進背包，走回來就能餵牠。`}
                      action={
                        <Button variant="primary" className="px-5 py-2.5 text-sm" onClick={goToShop}>
                          <ShoppingBag size={15} strokeWidth={2.75} />
                          前往商店
                        </Button>
                      }
                    />
                  ) : (
                    foods.map((food) => {
                      const stock = getAvailableStock(profile, food.id);
                      return (
                        <div
                          key={food.id}
                          className="rounded-2xl border border-island-line bg-white p-3 flex items-center gap-3"
                        >
                          <QVersionIcon itemId={food.id} size={44} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-island-navy truncate">
                              {food.name}
                              <span className="ml-2 text-xs font-black text-island-navy-soft/60 font-mono">
                                ×{stock}
                              </span>
                            </p>
                            <p className="text-[11px] font-bold text-island-teal-dark">
                              {food.consumable?.effectSummary}
                            </p>
                          </div>
                          <Button
                            variant="primary"
                            className="px-4 py-2.5 text-sm flex-shrink-0"
                            disabled={busy}
                            onClick={() => void handleFeed(food.id)}
                          >
                            {food.consumable?.verb ?? '餵食'}
                          </Button>
                        </div>
                      );
                    })
                  )}

                  <Button
                    variant="ghost"
                    className="w-full px-4 py-2.5 text-xs"
                    onClick={() => {
                      playSound(SoundEffect.CLICK);
                      setView('home');
                    }}
                  >
                    <ChevronLeft size={14} strokeWidth={3} />
                    返回
                  </Button>
                </div>
              )}
            </div>
          </ModalShell>
        </ModalOverlay>
      )}
    </AnimatePresence>
  );
}
