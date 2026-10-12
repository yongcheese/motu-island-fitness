/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useAppPick } from '../context/AppContext';
import { View } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  Check, X, Star, Home, Waves, Map,
  Shell, Flower2, Droplets,
  Palmtree, Flame, Store, Layout, Grid, Sofa, Armchair,
  Tablet, Scroll, Book, Box, RotateCw, Anchor, PawPrint, Sailboat,
} from 'lucide-react';
import { ALL_ITEMS, getItemById } from '../constants/items';
import { DEFAULT_RARITY, rarityStyleVars } from '../constants/rarity';
import { getItemRarity } from '../utils/debugOverrides';
import { useMemo, useState, Suspense } from 'react';
import { MAIN_SECTIONS, getCategoriesFor, getDisplayCategory, getItemCategoryLabel, resolveCategoryId } from '../utils/categoryUtils';
import { ShopView } from './ShopView';
import { QVersionIcon } from './QVersionIcon';
import { EmptyState, IconTile, PortholeFrame, Button } from './UI/DesignKit';
import { CategoryIcon } from './UI/CategoryIcon';
import { CategoryNote, SubCategoryTabs } from './UI/CategoryTabs';
import {
  BackpackTabBar, OwnedKindList, ownedItemsOfKind, type BackpackTabId,
} from './UI/BackpackTabs';
import { UtilityCardBag } from './UI/UtilityCard';
import { PetCareBag } from './UI/PetCarePanel';
import { Canvas } from '@react-three/fiber';
import { tuneRenderer } from '../lib/rendererTuning';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { Avatar, AVATAR_BASE_SCALE } from './Three/Avatar';
import { CosmeticEffectField } from './Three/effects';
import { CompanionPet } from './Three/Pets';
import { StudioBackdrop, StudioFloor } from './Three/StudioFloor';
import { getPetSpec, getPetSpecies } from '../constants/pets';
import { resolveSpecialCosmetics } from '../constants/cosmeticEffects';
import { ownsItem } from '../utils/inventory';
import { SoundEffect, playSound } from '../lib/soundUtils';
import * as THREE from 'three';

const PERSON_CATEGORY_IDS = getCategoriesFor('PERSON').map(c => c.id);

/** The 寵物 rack — this screen's own, which is why it isn't in 人物外觀's row. */
const PET_RACK_ID = 'Pets';
const PET_RACK = getDisplayCategory(PET_RACK_ID);

/** The 寵物飾品 rack. Its items live in the shop's 寵物 section but are a separate equip slot. */
const PET_GEAR_ID = 'PetGear';
const PET_GEAR_RACK = getDisplayCategory(PET_GEAR_ID);

/** Racks shown here: 人物外觀's wearables, then the companion and what it wears. */
const RACKS = [...getCategoriesFor('PERSON'), PET_RACK, PET_GEAR_RACK].filter(
  (rack): rack is NonNullable<typeof rack> => !!rack,
);

/**
 * Whether an item IS a companion animal — not merely something filed under 寵物.
 *
 * Asked of the item ID rather than of its shop category, and that is the load-bearing part: the
 * 寵物 section also sells 寵物飾品, and a category test would class a collar as a pet. It would
 * then share the companion's single-select slot, so putting a bow on the dog would put the DOG
 * away. `getPetSpecies` answers the question that actually matters — is this an animal — from the
 * `pet-<species>-<breed>` id pattern that names one.
 */
const isPetAnimal = (itemId: string) => !!getPetSpecies(itemId);

export function DressingRoomView() {
  const { profile, setCurrentView, setActivePlacementItem, updateProfile } = useAppPick('profile', 'setCurrentView', 'setActivePlacementItem', 'updateProfile');
  // The remembered category is shared with the shop, so it can point at a housing category this
  // screen doesn't show — and at one that no longer exists at all after a catalog change.
  // Narrow it to a wearable category before using it.
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const remembered = resolveCategoryId(localStorage.getItem('last_selected_category'), 'Hats');
    return PERSON_CATEGORY_IDS.includes(remembered) ? remembered : 'Hats';
  });
  const [showShop, setShowShop] = useState(false);

  /**
   * 背包的四個分頁。預設是 `wearable` —— 那就是以前的更衣室，所以路牌按一下看到的畫面沒有變。
   * 見 UI/BackpackTabs.tsx 為什麼分頁是 CategoryKind 的四個值而不是新分類。
   */
  const [activeTab, setActiveTab] = useState<BackpackTabId>('wearable');

  /**
   * 每一頁有幾件，畫在標籤上。
   *
   * 「穿戴」那一格算的是**擁有的可穿戴物件**（包含寵物與寵物飾品，它們也是 wearable），跟底下衣
   * 架顯示的那一格不一樣 —— 標籤講的是整個分頁，不是目前開著的那個衣架。
   */
  const tabCounts = useMemo(
    () => ({
      wearable: ownedItemsOfKind(profile, 'wearable').length,
      placeable: ownedItemsOfKind(profile, 'placeable').length,
      consumable: ownedItemsOfKind(profile, 'consumable').length,
      applied: ownedItemsOfKind(profile, 'applied').length,
    }),
    [profile],
  );

  /** 島上有沒有帶著夥伴 —— 決定「消耗」頁要不要畫寵物照護那一段。 */
  const hasCompanionOut = (profile?.equippedItems ?? []).some((id) => !!getPetSpec(id));

  const getIcon = (item: any) => {
    return <QVersionIcon itemId={item.itemId} size={110} />;
  };

  const ownedItems = ALL_ITEMS
    // Through the Inventory System rather than reading `profile.inventory` directly, so this rack
    // and the shop can never disagree about what is owned — including under the ?unown= test
    // override (utils/debugOverrides.ts).
    .filter(item => ownsItem(profile, item.id))
    // The 寵物 rack holds every companion ANIMAL, not just items filed under the rack's own id:
    // this screen keeps pets in one slot while the shop splits them across 狗/貓/鳥 chips, so
    // matching on "is an animal" is what stops a 柴犬 bought there from vanishing here — and what
    // keeps 寵物飾品, which is sold in the same section, on its own rack instead.
    .filter(item =>
      activeCategory === PET_RACK_ID
        ? isPetAnimal(item.id)
        : item.shopCategory === activeCategory
    )
    .map(item => ({
      itemId: item.id,
      name: item.name,
      category: item.shopCategory,
    }));

  const activeRack = getDisplayCategory(activeCategory);
  const activeCategoryLabel = activeRack?.label ?? '裝扮';

  const isPetRack = activeCategory === PET_RACK_ID;

  /**
   * 這個衣架上的東西，普通商店賣不賣。
   *
   * 空衣架上那顆按鈕的文案是動態組出來的（`前往商店選購${分類名}`），所以它會照著任何一格說出
   * 那句話 —— 包括**特殊飾品**，而那一格的貨在限時小攤。按下去的結果是 ShopView 的
   * `resolveInitialTaxonomy` 丟掉這個 pin（見那裡：非 main-shop 的分類不是有效的 pin），退回
   * `initialSection: 'PERSON'`，也就是**帽子**。玩家按了一顆寫著「前往商店選購特殊飾品」的按鈕，
   * 到了一個沒有特殊飾品、也沒有任何說明的帽子貨架。
   *
   * 修法不是在這裡寫一個 `if (activeCategory === 'SpecialFx')`，那會是第二個記得這件事的地方，
   * 而且下一個限時限定的貨架不會繼承它。分類自己已經宣告了 `channel`（utils/categoryUtils.ts），
   * 所以問的是那一格：不是普通商店的貨，就不要給一顆通往普通商店的按鈕，改講它到底在哪裡賣
   * （`emptyNote`，那個欄位本來就是為了這件事存在的）。
   */
  const soldOutsideMainShop = (activeRack?.channel ?? 'main-shop') !== 'main-shop';

  /**
   * The pet on show beside the character. Equipping is single-select per slot (see
   * handleToggleEquip), so there is at most one — switching 未使用 on for a second dog takes the
   * first one off, which is why this can read the first match rather than reconcile a list.
   */
  const equippedPetId = profile?.equippedItems?.find(id => getPetSpec(id));

  /**
   * The pet's 特殊飾品, so the preview shows the bow on the dog the same way the island will.
   *
   * This is why the pet stands INSIDE the CosmeticEffectField below rather than beside it: the
   * ornaments animate and emit here exactly as they do in play, which is the whole point of a
   * preview — 寵物飾品 used to be the one thing on this screen you had to leave to see.
   */
  const petCosmetics = useMemo(
    () => resolveSpecialCosmetics(profile?.equippedItems ?? [], 'pet'),
    [profile?.equippedItems],
  );

  /**
   * Coming back from the shop lands on whichever category the player ended up
   * browsing there — the shop writes every chip switch to the shared
   * `last_selected_category`. Without this you leave from an empty 鞋子 rack, buy
   * a hat, and return to that same empty rack. Browsing 室內/室外 in the shop
   * leaves this screen alone, since neither is something you can wear.
   */
  const handleShopClose = () => {
    setShowShop(false);
    const browsed = resolveCategoryId(localStorage.getItem('last_selected_category'), activeCategory);
    if (PERSON_CATEGORY_IDS.includes(browsed)) setActiveCategory(browsed);
    // Every 狗/貓/鳥 chip in the shop comes back to the one 寵物 rack, since that is where the
    // thing you just bought is waiting — otherwise you buy a cat and return to the hat shelf.
    // 飾品 is its own rack on this screen, so it comes back to itself.
    else if (browsed === PET_GEAR_ID) setActiveCategory(PET_GEAR_ID);
    else if (getDisplayCategory(browsed)?.mainSection === 'PET') setActiveCategory(PET_RACK_ID);
  };

  /**
   * Wearing is single-select *within a category*: picking a hairstyle takes off
   * whichever hairstyle was already on, rather than stacking a second one.
   *
   * That exclusivity is what the renderer has always assumed. resolveHairSpec
   * (constants/hair.ts) renders the FIRST hair id it finds in equippedItems, so
   * the old arrayUnion toggle — which appended the new style and left the old
   * one in place — changed nothing at all on the avatar: the previously worn
   * style kept winning the lookup. Rebuilding the list here instead of sending
   * an arrayUnion/arrayRemove sentinel is also what lets the write go through
   * updateProfile, which updates local state before it waits on the network.
   *
   * A save left holding several hair ids by the old toggle heals itself the
   * first time its owner picks a hairstyle, since the filter drops every id in
   * the category before the chosen one goes back on.
   */
  const handleToggleEquip = (itemId: string) => {
    if (!profile) return;
    const equipped = profile.equippedItems ?? [];
    const isEquipped = equipped.includes(itemId);
    const category = ALL_ITEMS.find(item => item.id === itemId)?.shopCategory;
    // 寵物 is ONE slot even though the shop splits it across 狗/貓/鳥: the rack shows a single
    // companion and only one can stand beside the character, so bringing out a 柴犬 puts the
    // 臘腸 — or a future cat — away, exactly as a second hat takes off the first.
    //
    // Keyed on "is an ANIMAL" rather than on the 寵物 section, because that section also sells
    // 寵物飾品: on a section test, clipping a bow onto the dog would count as bringing out a
    // different pet and would put the dog itself away.
    const isAnimal = isPetAnimal(itemId);
    const sameSlot = new Set(
      ALL_ITEMS
        .filter(item => (isAnimal ? isPetAnimal(item.id) : item.shopCategory === category))
        .map(item => item.id)
    );

    // Clicking what you're wearing takes it off; clicking anything else swaps it in.
    const nextEquipped = equipped.filter(id => !sameSlot.has(id));
    if (!isEquipped) nextEquipped.push(itemId);

    playSound(SoundEffect.SUCCESS);
    void updateProfile({ equippedItems: nextEquipped });
  };

  return (
    // z-40: local sub-scale — this view is always mounted inside App.tsx's
    // z-game-view wrapper, so it only needs to out-rank its own siblings.
    // See DESIGN_SYSTEM.md's z-index "local sub-scale exception".
    <div className="fixed inset-0 z-40 bg-island-cream-2 overflow-hidden flex">
      {/* Background World Tint */}
      <div className="absolute inset-0 bg-gradient-to-b from-white to-island-cream-2 pointer-events-none" />

      {/* Main Container: Split Layout (Vertical on mobile, horizontal on desktop) */}
      <div className="relative flex flex-col-reverse md:flex-row w-full h-full">
        {/* Left Side: Inventory Panel */}
        <motion.div
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          className="relative w-full md:max-w-xl h-[55%] md:h-full bg-white border-t md:border-r md:border-t-0 border-island-line px-4 md:px-8 pt-16 md:pt-20 pb-6 md:pb-10 flex flex-col z-50 overflow-hidden shadow-[5px_0_30px_rgba(38,70,83,0.04)]"
        >
          {/* Back to Home Button */}
          <button
            onClick={() => setCurrentView(View.HOME)}
            className="absolute top-4 left-4 md:top-6 md:left-8 flex items-center gap-2 px-3.5 py-1.5 md:px-4 md:py-2 bg-white hover:bg-island-cream-2 rounded-2xl text-island-navy-soft border border-island-line transition-all active:scale-95 z-50 group"
          >
            <Home size={18} strokeWidth={3} className="group-hover:scale-110 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">返回遊戲主區</span>
          </button>

          {/* Subtle elegant pattern */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(38,70,83,1) 1px, transparent 1px), linear-gradient(90deg, rgba(38,70,83,1) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

          <header className="flex flex-col gap-4 md:gap-6 mb-4 md:mb-10 relative">
            <div className="flex items-center">
              <div className="flex items-center gap-3 md:gap-5">
                <PortholeFrame size={60} className="shadow-[0_4px_10px_rgba(42,157,143,0.3)]">
                  <div className="w-full h-full bg-island-teal flex items-center justify-center text-white">
                    <Box className="w-6 h-6 md:w-7 md:h-7" strokeWidth={2.5} />
                  </div>
                </PortholeFrame>
                <div>
                  {/* 「背包」，一個名字。
                      ─────────────
                      這個畫面以前自稱「裝備收藏庫」，而路牌上寫的是「更衣室」，商店裡還有一張
                      「我的裝備收納庫」的 banner 通往一個叫「我的收藏裝備」的 modal —— 四個名字，
                      其中兩個指著同一份 profile.inventory。玩家分不出哪個是哪個，因為它們本來就
                      沒有差別。 */}
                  <h2 className="text-2xl md:text-4xl font-black tracking-tight text-island-navy leading-none">背包</h2>
                  <p className="text-[9px] md:text-[10px] font-black text-island-navy-soft uppercase tracking-[0.3em] mt-1.5 md:mt-2">Your Island Backpack</p>
                </div>
              </div>
            </div>

            {/* 四個分頁 —— 穿戴 / 擺放 / 消耗 / 已套用，也就是 CategoryKind 的四個值。
                它們不是新分類：那一格早就是全遊戲判斷「這東西怎麼用」的依據，只是以前只有程式
                看得到。見 UI/BackpackTabs.tsx。 */}
            <BackpackTabBar active={activeTab} onChange={setActiveTab} counts={tabCounts} />

            <div className={`space-y-2.5 w-full ${activeTab === 'wearable' ? '' : 'hidden'}`}>
              {/* Tier 1: this screen only ever manages character items, so the
                  main-section tier is a static label rather than a fake toggle */}
              <div className="flex items-center gap-1.5 text-island-teal-dark">
                <CategoryIcon iconName={MAIN_SECTIONS[0].iconName} size={14} active />
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">{MAIN_SECTIONS[0].label}</span>
              </div>
              {/* Tier 2: sub-category chips */}
              <SubCategoryTabs
                categories={RACKS}
                active={activeCategory}
                onChange={(id) => {
                  setActiveCategory(id);
                  // `last_selected_category` means "where I was in the shop", and the shop has
                  // no 寵物 chip to restore — writing it would reopen the storefront on a
                  // category its row never renders.
                  if (!getDisplayCategory(id)?.standalone) {
                    localStorage.setItem('last_selected_category', id);
                  }
                }}
                className="md:!justify-start"
              />
              {/* Same shelf note as the shop's, so 配件 and 特殊飾品 say the same thing about
                  themselves in both places a player meets them. */}
              <CategoryNote categoryId={activeCategory} className="mx-0" />
            </div>
          </header>

          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
            {/* 擺放 / 已套用 —— 唯讀清單，依貨架分組。沒有動作按鈕是刻意的：東西要放下去得站在
                放得下去的地方，而這裡不是。見 UI/BackpackTabs.tsx。 */}
            {(activeTab === 'placeable' || activeTab === 'applied') && (
              <div className="pb-20">
                <OwnedKindList profile={profile} kind={activeTab} onGoShop={() => setShowShop(true)} />
              </div>
            )}

            {/* 消耗 —— 功能卡與寵物用品終於有了一個不在商店標題列裡的家。
                這兩個背包以前**只能從商店（與限時小攤）的 header 進去**，也就是說一袋買回來的
                飼料，唯一能拿出來餵的地方是另一家店的畫面。 */}
            {activeTab === 'consumable' && (
              <div className="space-y-6 pb-20">
                <section className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-island-line bg-island-cream-2 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-island-navy-soft">
                      功能卡
                    </span>
                    <span className="h-px flex-1 bg-island-line" />
                  </div>
                  <UtilityCardBag />
                </section>

                {/* 只有帶著夥伴才畫 —— 對一個沒有寵物的玩家，這一段是一組沒有對象的餵食按鈕。
                    PetCareBag 自己也擋著，這裡的區塊標題跟著一起收起來。 */}
                {hasCompanionOut && (
                  <section className="space-y-3">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-island-line bg-island-cream-2 px-2.5 py-1 text-[10px] font-black tracking-[0.14em] text-island-navy-soft">
                        我的寵物
                      </span>
                      <span className="h-px flex-1 bg-island-line" />
                    </div>
                    <PetCareBag />
                  </section>
                )}
              </div>
            )}

            <div className={`space-y-3 pb-20 ${activeTab === 'wearable' ? '' : 'hidden'}`}>
              <AnimatePresence mode="popLayout">
                {ownedItems.length === 0 ? (
                  <motion.div
                    key="empty"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="max-w-md mx-auto"
                  >
                    <EmptyState
                      bordered
                      icon={
                        soldOutsideMainShop
                          ? <Sailboat size={32} className="text-island-teal" />
                          : isPetRack
                            ? <PawPrint size={32} className="text-island-teal" />
                            : <Store size={32} className="text-island-teal" />
                      }
                      title={isPetRack ? '還沒有夥伴陪著你' : `還沒有任何${activeCategoryLabel}`}
                      description={
                        // A shelf another storefront owns says where its goods actually come from
                        // (the category's own `emptyNote` — see utils/categoryUtils.ts), because
                        // the 前往商店 line below would be a promise this screen cannot keep.
                        soldOutsideMainShop
                          ? activeRack?.emptyNote ?? `${activeCategoryLabel}不在普通商店販售。`
                          : isPetRack
                            ? '這一格放你帶在身邊的夥伴，商店的寵物區已經有狗狗在等人帶回家了。'
                            : `商店裡還有更多${activeCategoryLabel}，買下就能直接在這裡換上。`
                      }
                      action={
                        // The pet rack gets the same 前往商店 button as every other rack now that
                        // 商店 has a 寵物 section to send the player to — it used to be the one
                        // rack with nowhere to go.
                        //
                        // A limited-shop shelf gets NO button, and that is the fix rather than an
                        // omission: the only honest destination is a merchant who has to be walked
                        // to and who is not always on the island (constants/merchantVisit.ts), so
                        // there is nothing here that could open it. The description above says
                        // where to look; a button that opened the wrong shop said less than nothing.
                        soldOutsideMainShop ? undefined : (
                          <Button
                            variant="primary"
                            onClick={() => setShowShop(true)}
                            className="px-5 py-3 text-xs uppercase tracking-wider"
                          >
                            <Store size={16} strokeWidth={2.5} />
                            {`前往商店選購${activeCategoryLabel}`}
                          </Button>
                        )
                      }
                    />
                  </motion.div>
                ) : (
                  ownedItems.map((item, idx) => {
                    const isEquipped = profile?.equippedItems?.includes(item.itemId);
                    // Every wearable in this drawer carries a tier now (constants/rarity.ts), so
                    // the whole wardrobe reads as one ladder rather than as a graded pet shelf
                    // among plain clothes. Thumbnail form only (`.rarity-chip`), and 使用中 still
                    // out-ranks it for the same reason the furniture drawer's 套用中 does: a STATE
                    // beats a GRADE. That is why `graded` is still a condition — it is about the
                    // equipped state, not about whether the item has a tier.
                    const definition = getItemById(item.itemId);
                    const rarity = definition ? getItemRarity(definition) : DEFAULT_RARITY;
                    const graded = !isEquipped;
                    return (
                      <motion.div
                        layout
                        key={item.itemId}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => handleToggleEquip(item.itemId)}
                        className={`group p-4 rounded-2xl dock-notch border transition-all flex items-center gap-5 cursor-pointer relative ${
                          isEquipped
                            ? 'bg-white border-island-teal shadow-[0_8px_20px_rgba(42,157,143,0.1)]'
                            : graded
                              ? 'rarity-chip bg-white/60 hover:bg-island-cream-2'
                              : 'bg-white/60 border-island-line hover:border-island-teal-light hover:bg-island-cream-2'
                        }`}
                        style={graded ? rarityStyleVars(rarity) : undefined}
                      >
                        <IconTile size={64} active={isEquipped} className="text-island-navy shadow-inner">
                          <div className="flex items-center justify-center transition-transform duration-300 group-hover:scale-110 filter drop-shadow-[0_4px_6px_rgba(0,0,0,0.15)]">
                            <QVersionIcon itemId={item.itemId} size={64} />
                          </div>
                        </IconTile>
                        <div className="flex-1 min-w-0">
                          <h4 className={`font-black text-lg truncate ${isEquipped ? 'text-island-teal-dark' : 'text-island-navy'}`}>
                            {item.name}
                          </h4>
                          <p className={`text-[9px] font-black uppercase tracking-widest mt-0.5 truncate ${isEquipped ? 'text-island-teal' : 'text-island-navy-soft'}`}>
                            {getItemCategoryLabel(item.itemId)}
                          </p>
                        </div>

                        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${
                          isEquipped ? 'bg-island-teal/12 text-island-teal-dark border border-island-teal/25' : 'bg-white text-island-navy-soft border border-island-line group-hover:bg-island-teal group-hover:text-white'
                        }`}>
                          {isEquipped ? '使用中' : '未使用'}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </div>
        </motion.div>

        {/* Right Side: 3D Preview Studio */}
        <div className="flex-1 h-[45%] md:h-full relative flex items-center justify-center overflow-hidden bg-white w-full">
          {/* Studio Backdrop */}
          <div className="absolute inset-0 z-0">
             <div className="absolute inset-0 bg-gradient-to-b from-white to-island-cream-2" />
             {/* Glow */}
             <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-gradient-to-tr from-island-teal/6 via-transparent to-island-teal/6" />
             {/* Soft Grid */}
             <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'linear-gradient(rgba(38,70,83,1) 1px, transparent 1px), linear-gradient(90deg, rgba(38,70,83,1) 1px, transparent 1px)', backgroundSize: '100px 100px' }} />
          </div>

          <div className="w-full h-full relative z-10">
            <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={[1, 2]} onCreated={({ gl }) => tuneRenderer(gl)}>
              <PerspectiveCamera makeDefault position={[0, 0.4, 3.2]} fov={35} />
              <ambientLight intensity={0.6} />

              {/* Studio Key Lights */}
              <pointLight position={[2, 2, 2]} intensity={70} color="#ffffff" />
              <pointLight position={[-2, 2, 2]} intensity={70} color="#ffffff" />
              <pointLight position={[0, 3, 5]} intensity={30} color="#ffffff" />

              {/* Backlight / Rim LIGHT */}
              <spotLight
                position={[0, 6, -4]}
                angle={0.4}
                penumbra={1}
                intensity={400}
                color="#ffffff"
                castShadow
              />

              {/* The graded wall the whole stage stands in — see StudioBackdrop. It is what
                  stops a white bubble, a pale star or an ice halo from being previewed against
                  a white field and disappearing into it. Outside the stage group and outside
                  Suspense: it is the room, it never loads anything, and it must be there on the
                  first frame rather than after the avatar resolves. */}
              <StudioBackdrop />

              <Suspense fallback={null}>
                {/* Special cosmetic effects, so an ornament previews the way it will actually
                    look. Mounted OUTSIDE the stage group on purpose: the pooled particles it
                    renders are world-space, and inside they would be carried 0.85 units down
                    with the stage while their spawn points stayed where the avatar is. */}
                <CosmeticEffectField>
                {/* Stage / Floor */}
                <group position={[0, -0.85, 0]}>
                  {/* The tiled stage, rings included — see Three/StudioFloor.tsx */}
                  <StudioFloor />

                  <group scale={0.5} position={[0, 0, 0]}>
                     <Avatar isInterior={false} />
                     {/* The equipped pet stands on the same stage floor as the character, as a
                         sibling of the avatar rather than a child of it: the avatar's own group
                         carries walk/idle/squash transforms that a companion has no business
                         inheriting. Being a sibling means re-applying AVATAR_BASE_SCALE by hand,
                         which is what puts the dog's height (measured in the avatar's local units
                         against its knee) back in proportion. */}
                     {equippedPetId && (
                       <group scale={AVATAR_BASE_SCALE}>
                         <CompanionPet itemId={equippedPetId} cosmetics={petCosmetics} />
                       </group>
                     )}
                  </group>
                </group>
                </CosmeticEffectField>
              </Suspense>

              <OrbitControls
                enablePan={false}
                enableZoom={false}
                minPolarAngle={Math.PI / 3}
                maxPolarAngle={Math.PI / 1.6}
                // Explicitly off — drei defaults this to TRUE, and this turntable was the one
                // <OrbitControls> in the app still left on that default (the game camera turns it
                // off at CameraController.tsx's enableDamping={false} for the same reason). With
                // damping on, three's dampingFactor 0.05 only closes 5% of the pending rotation
                // per frame: the character visibly trails the cursor during the drag and keeps
                // gliding after you let go. Off, it turns exactly with the pointer and stops dead.
                enableDamping={false}
                // A drag the full height of the canvas = one full turn (OrbitControls rotates
                // `2*PI*rotateSpeed / clientHeight` radians per pixel). The old 0.5 meant a
                // full-height drag only got you halfway round, which read as more sluggishness on
                // top of the damping lag.
                rotateSpeed={1}
                makeDefault
              />
            </Canvas>
          </div>

          {/* Vanity Controls Overlay */}
          <div className="absolute inset-8 border border-island-line/40 pointer-events-none rounded-[4rem] z-20" />
          <div className="absolute inset-0 pointer-events-none z-20">
             {/* Studio Bulbs along the sides */}
             <div className="absolute top-1/2 -translate-y-1/2 left-10 flex flex-col gap-12">
               {[1,2,3,4,5].map(i => (
                 <div key={i} className="relative text-left">
                   <div className="absolute inset-0 blur-[8px] bg-island-teal-light/60 opacity-90" />
                   <div className="w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_15px_rgba(42,157,143,0.5)] border border-island-teal-light z-10 animate-pulse" />
                 </div>
               ))}
             </div>
             <div className="absolute top-1/2 -translate-y-1/2 right-10 flex flex-col gap-12">
               {[1,2,3,4,5].map(i => (
                 <div key={i} className="relative text-left">
                   <div className="absolute inset-0 blur-[8px] bg-island-teal-light/60 opacity-90" />
                   <div className="w-3.5 h-3.5 bg-white rounded-full shadow-[0_0_15px_rgba(42,157,143,0.5)] border border-island-teal-light z-10 animate-pulse" />
                 </div>
               ))}
             </div>
          </div>



        </div>
      </div>

      <AnimatePresence>
        {showShop && (
          // Opened from an empty rack, so it lands on the exact category the
          // player was standing on (帽子 → 商店的帽子) rather than wherever the
          // shared `last_selected_category` happened to leave the shop.
          // initialSection is the floor under that. 寵物 needs its own: the rack's
          // id is standalone, so the shop ignores it as a pin and would drop the
          // player back at 帽子 instead of the 寵物 shelf they asked for.
          <ShopView
            isOverlay
            initialSection={isPetRack || activeCategory === PET_GEAR_ID ? 'PET' : 'PERSON'}
            initialCategory={activeCategory}
            onClose={handleShopClose}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
