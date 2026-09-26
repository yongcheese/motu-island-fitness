import { useEffect, useState, useMemo, useRef } from 'react';
import { getBalance } from '../constants/currency';
import {
  Coins, Check, Box, X, Store, ShoppingBag, ArrowLeft, Lock, Zap, Sparkles,
} from 'lucide-react';
import { View } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { ALL_ITEMS, ItemDefinition } from '../constants/items';
import { MAIN_SHOP_CATALOG } from '../constants/distribution';
import { getHouseStyleByItemId } from '../constants/houseStyles';
import { playSound, SoundEffect, triggerHaptic } from '../lib/soundUtils';
import {
  MainSection, getDisplayCategory, getFirstShopCategoryId, getShopCategoriesFor,
  getShopMainSections,
  isApplyOnOwnCategory, resolveCategoryId,
} from '../utils/categoryUtils';
import { getOwnedCount } from '../utils/inventory';
import { getXpRequirement, isXpLocked } from '../utils/unlock';
import { rarityStyleVars } from '../constants/rarity';
import { getItemRarity } from '../utils/debugOverrides';
import { getFurnitureSeries } from '../constants/furnitureModels';
import { isNpcPortrait, NpcPortrait, QVersionIcon } from './QVersionIcon';
import { RarityAura } from './UI/RarityAura';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useDirectWheelScroll } from '../hooks/useScrollIsolation';
import { Button, CurrencyChip, EmptyState, PanelHeader } from './UI/DesignKit';
import { CategoryNote, MainSectionTabs, SubCategoryTabs, SubGroupFilter } from './UI/CategoryTabs';
import { getSpecialCosmetic } from '../constants/cosmeticEffects';
import { BuyButton, StockBadge } from './UI/ItemStock';
import { FragmentMeter, RaffleTicketChip } from './UI/FragmentProgress';
import { PurchaseDialog } from './UI/PurchaseDialog';

import { ActiveEffectChip, UtilityCardBagButton, UtilityCardBagModal } from './UI/UtilityCard';
import { PetCareButton, PetCareModal } from './UI/PetCarePanel';
import { PetSpeciesFilter, defaultSpeciesFilter, type PetSpeciesFilterValue } from './UI/PetSpeciesFilter';
import { itemSuitsSpecies } from '../lib/petCompatibility';
import { getPetSpecies } from '../constants/pets';
import { equippedPetId } from '../context/usePetCare';


// Shared close-button chrome used wherever we need a close X grouped next to
// other header content (i.e. anywhere PanelHeader's own onClose slot isn't
// enough because there's a CurrencyChip/reset button that also needs to sit
// in the header row).
const headerCloseBtnClass = "w-10 h-10 rounded-xl bg-white border border-island-line hover:border-island-coral hover:text-island-coral text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0";

// Overlay mode's variant of the same chrome: a labelled 返回 rather than a bare
// X, because there it doesn't dismiss a dialog — it walks back to the host view
// (the dressing room) that is still sitting underneath.
const headerBackBtnClass = "h-10 px-3.5 gap-2 rounded-xl bg-white border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0";

const LAST_CATEGORY_KEY = 'last_selected_category';
const DEFAULT_CATEGORY = 'Hats';

/**
 * 這家店攤開來有多寬。
 *
 * 1000px 是「一段文字讀起來最舒服的寬度」，而這個畫面裡沒有一段文字 —— 它是一個商品格狀清單，
 * 而格狀清單在寬螢幕上該做的事是多排一欄，不是留兩條各 220px 的空白。所以殼跟著斷點長大，商品
 * 格也跟著多開欄（見下方 grid 的註解），兩者是同一個決定的兩半：只加欄不加寬會把卡削瘦，只加寬
 * 不加欄會把卡撐胖，兩邊都比現在難看。
 *
 * 寫成一個常數而不是在兩個分支各貼一次：全螢幕商店和更衣室裡的 overlay 商店是同一家店，寬度不
 * 一致的那一天不會有人發現，因為沒有人會把兩條路並排開著看。
 */
const SHOP_SHELL_WIDTH = 'w-full max-w-[1000px] xl:max-w-[1340px] 2xl:max-w-[1560px] mx-auto';

/**
 * The section tabs 商店 shows. Computed once at module load — the taxonomy is a module constant,
 * so which sections this shop has is a fact about the build rather than about a render.
 */
const SHOP_SECTIONS = getShopMainSections();

interface ShopViewProps {
  /**
   * Full-screen takeover mounted *inside* a host view (DressingRoomView) rather
   * than routed to as its own page, returning to that host via the header's 返回.
   *
   * Deliberately a full-bleed page and not a centered modal card: the dressing
   * room's inventory panel sits on its own raised tier, so a centered card was
   * painted underneath it and lost its whole left half behind the panel.
   */
  isOverlay?: boolean;
  onClose?: () => void;
  initialSection?: MainSection;
  /**
   * Open straight onto this sub-category's chips (and whichever main section owns
   * it). Takes precedence over {@link initialSection}, which can only ever land on
   * a section's *first* category.
   */
  initialCategory?: string;
}

/**
 * Which two tiers the shop opens on, in priority order:
 *  1. `initialCategory` — a caller deep-linking an exact category. The dressing
 *     room does this from an empty rack, so 鞋子 opens the shop's 鞋子 rather than
 *     dumping the player back at 帽子 to find the chip themselves.
 *  2. `initialSection` — a caller that only cares about the top tier.
 *  3. The shared `last_selected_category` both screens write, so the plain
 *     storefront resumes where the player left off.
 *
 * An id that no longer exists after a catalog change falls through to the next
 * rule rather than selecting an empty tab.
 */
function resolveInitialTaxonomy(
  initialCategory?: string,
  initialSection?: MainSection,
): { section: MainSection; subCategory: string } {
  // A `standalone` category (更衣室's 寵物 rack) is deliberately absent from every chip row here,
  // so pinning one would open the shop on a tab that renders nothing and highlights nothing. A
  // category this shop does not sell (特殊飾品, now 限時商店-only) falls through for the same
  // reason — see DisplayCategory.channel.
  const pinned = initialCategory ? getDisplayCategory(initialCategory) : undefined;
  if (pinned && !pinned.standalone && (pinned.channel ?? 'main-shop') === 'main-shop') {
    return { section: pinned.mainSection, subCategory: pinned.id };
  }

  if (initialSection) {
    return { section: initialSection, subCategory: getFirstShopCategoryId(initialSection) || DEFAULT_CATEGORY };
  }

  const remembered = resolveCategoryId(
    localStorage.getItem(LAST_CATEGORY_KEY),
    DEFAULT_CATEGORY,
    'main-shop',
  );
  return { section: getDisplayCategory(remembered)?.mainSection || 'PERSON', subCategory: remembered };
}

/**
 * 商店 — the game's single storefront.
 *
 * Named 商店 rather than 家具商店 because it has never only sold furniture: outfits, outdoor
 * buildings, room surfaces and house appearances all live here. Its catalog is the shared
 * taxonomy (utils/categoryUtils.ts), so 室內 and 室外 goods are separate top-level sections and
 * a player never has to guess whether a decoration was meant for the house or the island.
 *
 * Buying is the shared Shop System: the card's 購買/再購買 button and the confirmation dialog
 * are the same components the build rail and the furniture drawer use.
 */
export function ShopView({ isOverlay, onClose, initialSection, initialCategory }: ShopViewProps) {
  const { profile, setCurrentView } = useApp();

  const [activeSection, setActiveSection] = useState<MainSection>(
    () => resolveInitialTaxonomy(initialCategory, initialSection).section
  );

  const [activeSubCategory, setActiveSubCategory] = useState<string>(
    () => resolveInitialTaxonomy(initialCategory, initialSection).subCategory
  );

  const [showCardBag, setShowCardBag] = useState(false);
  const [showPetCare, setShowPetCare] = useState(false);
  const [selectedPurchaseItem, setSelectedPurchaseItem] = useState<ItemDefinition | null>(null);
  const productGridRef = useRef<HTMLDivElement>(null);
  // The wheel over either of the shop's two long lists is handled by us, not by the browser —
  // see useDirectWheelScroll. One instance per node, because a shared one would have to guess
  // the order React attaches and detaches them in.
  const catalogScroll = useDirectWheelScroll();
  const pageScroll = useDirectWheelScroll();

  useEscapeToClose(() => {
    playSound(SoundEffect.CLICK);
    onClose?.();
  }, !!(isOverlay && onClose));

  const handleExit = () => {
    if (onClose) {
      onClose();
    } else {
      setCurrentView(View.HOME);
    }
  };

  const activeSubCategoryLabel = getDisplayCategory(activeSubCategory)?.label || activeSubCategory;

  /**
   * Everything on the shelf, before the pet filter below. What the chips are derived from.
   *
   * `MAIN_SHOP_CATALOG`, never `ALL_ITEMS` (constants/distribution.ts). That is the whole of this
   * screen's relationship with the 限時商店: its goods are not in the list this grid is built from,
   * so there is nothing here to hide, filter or special-case. See §12/§14 of the brief — an
   * `if (item.shopCategory === 'SpecialFx') return null` here would be a rule one screen keeps and
   * the next screen forgets.
   */
  const shelfItems = useMemo(
    () => MAIN_SHOP_CATALOG.filter(item => item.shopCategory === activeSubCategory),
    [activeSubCategory]
  );

  /**
   * 寵物用品的物種篩選 (§5) — which animal's goods the pet shelves are showing.
   *
   * Re-defaulted whenever the shelf changes, to the species of the companion the player has out:
   * walking into 寵物窩 with a bird shows bird homes, not ten beds to sort through. See
   * UI/PetSpeciesFilter.tsx for why 全部 remains one tap away rather than the shelf being narrowed
   * outright, and for why nothing here is written per species.
   *
   * The state is keyed on nothing and reset by an effect rather than being derived, because it has
   * to be OVERRIDABLE: a derived value would spring back to the player's own species the moment
   * anything else re-rendered, which is the filter pressing itself.
   */
  const [petSpecies, setPetSpecies] = useState<PetSpeciesFilterValue>('all');
  useEffect(() => {
    setPetSpecies(defaultSpeciesFilter(shelfItems, getPetSpecies(equippedPetId(profile))));
  }, [shelfItems, profile?.equippedItems]);

  /**
   * 貨架內的分組篩選（第三層，見 UI/CategoryTabs.tsx 的 SubGroupFilter）。`null` 是「全部」。
   *
   * 換貨架就歸零，理由跟寵物物種篩選會重新預設一樣：分組名稱是這一架自己的（燈具的「吊燈」跟
   * 藝術品的「畫作」之間沒有關係），留著上一架的選擇只會讓新的一架看起來是空的。
   */
  const [activeSubGroup, setActiveSubGroup] = useState<string | null>(null);
  useEffect(() => {
    setActiveSubGroup(null);
  }, [activeSubCategory]);

  // 兩層篩選，順序固定：先物種（那是「這件商品適不適合我的動物」），再分組（「我要看哪一種」）。
  // 分組列本身是從**物種篩過之後**的清單長出來的（見下方的 JSX），所以在鳥的貨架上不會出現一個
  // 只有狗用得到的分組。
  const speciesFilteredItems = useMemo(
    () =>
      petSpecies === 'all'
        ? shelfItems
        : shelfItems.filter(item => itemSuitsSpecies(item, petSpecies)),
    [shelfItems, petSpecies]
  );

  const filteredItems = useMemo(
    () =>
      activeSubGroup === null
        ? speciesFilteredItems
        : speciesFilteredItems.filter(item => item.subGroup === activeSubGroup),
    [speciesFilteredItems, activeSubGroup]
  );

  const openPurchase = (item: ItemDefinition) => {
    triggerHaptic('medium');
    setSelectedPurchaseItem(item);
  };

  // --- Shared chrome blocks (identical for both isOverlay and full-page mode) ---

  /**
   * 「我的裝備收納庫」那張大 banner 不在了，連同它打開的「我的收藏裝備」modal。
   *
   * ## 它為什麼要走
   *
   * 它是一張全寬、有圖示磚、有標題與副標的卡，而且排在主分區 tabs **上面**。也就是說玩家打開商
   * 店，第一眼最大的那個東西是一個「去看我已經買過什麼」的連結，不是「這裡賣什麼」—— 這家店最顯
   * 眼的位置給了別的畫面。
   *
   * 而它通往的那個 modal 是 `profile.inventory` 的**第二個**檢視器：自己一套主分區 tabs、自己一
   * 套 chip 列、自己一個名字。第一個是更衣室（現在叫 背包），兩者顯示的是同一份資料。
   *
   * ## 取代它的東西
   *
   * header 上一顆安靜的 背包 鍵（下方 `backpackButton`），跟 我的功能卡 / 我的寵物 / 抽獎券 同一
   * 排、同一個重量。它**離開商店**走到背包去，而不是在店裡再開一個店中店 —— 收納只有一個地方，
   * 就是那個叫背包的地方。
   *
   * 以 overlay 形式（從背包點進來的商店）開啟時不畫：那條路的回頭鍵就在旁邊，寫著「返回」。
   */
  const backpackButton = !isOverlay && (
    <button
      onClick={() => {
        playSound(SoundEffect.CLICK);
        setCurrentView(View.DRESSING_ROOM);
      }}
      className="h-10 px-3.5 gap-2 rounded-xl bg-white border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0"
      title="打開背包"
    >
      <ShoppingBag size={16} strokeWidth={2.75} />
      <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
        背包 {profile?.inventory?.length ?? 0}
      </span>
    </button>
  );

  const headerBlock = (
    <div className="flex flex-col md:flex-row md:items-stretch flex-shrink-0">
      <PanelHeader
        icon={<Store size={22} strokeWidth={2.5} />}
        title="商店"
        subtitle="家具、裝飾、建築與裝扮一次購足"
        className="flex-1 min-w-0 !border-b-0 md:!border-b"
      />
      <div className="flex items-center justify-end flex-wrap gap-2.5 bg-island-cream-2 border-b border-island-line px-6 py-3 md:pr-8 md:pl-2 md:py-0 flex-shrink-0">
        <CurrencyChip amount={getBalance(profile, 'coins')} />
        {/* 功能卡 效果進行中. Renders nothing when nothing is running, so the header is unchanged
            for every player who has never used a card. */}
        <ActiveEffectChip />
        {/* The bag, from the shop itself as well as from the limited shelf: a card that can only be
            reached through the shop it was bought in is one a player loses track of. */}
        {/* 背包 — 取代那張壓在主導覽上方的「我的裝備收納庫」大 banner。見 `backpackButton`。 */}
        {backpackButton}
        <UtilityCardBagButton onClick={() => setShowCardBag(true)} />
        {/* 我的寵物, in the same row and for the same reason the card bag is: this is the screen a
            player buys 寵物用品 on, and a bag of food whose only use is somewhere else is one they
            buy once and never open again. Renders nothing when no companion is out — see
            PetCareButton, and see UI/PetCarePanel.tsx for why the state is behind a button at all
            rather than on the island. */}
        <PetCareButton onClick={() => setShowPetCare(true)} />
        {/* 抽獎券, beside the wallet rather than in the TopBar. This is still the screen where a
            ticket is EXPLAINED — the free ones are minted here, out of 多出來的碎片 — even though
            buying one moved to the 限時小攤 with the rest of 特殊卡牌. The 轉盤 that spends them
            does not exist yet, so a permanent slot on the world HUD would be a counter for a thing
            the player cannot do anything with. */}
        <RaffleTicketChip />
        {/* 清空裝備 used to be here, and again inside the collection drawer below. Both were
            Admin Only, and both put the game's single irreversible write two pixels from the
            wallet on a screen players use constantly. It moved to the 管理員測試 console
            (UI/admin/, 商店與經濟), which is also the only place it now exists — see
            lib/adminSaveReset.ts for the write itself. */}
        <button
          onClick={handleExit}
          className={isOverlay ? headerBackBtnClass : headerCloseBtnClass}
          aria-label={isOverlay ? '返回更衣室' : '關閉商店'}
        >
          {isOverlay ? (
            <>
              <ArrowLeft size={16} strokeWidth={3} />
              <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">返回</span>
            </>
          ) : (
            <X size={18} strokeWidth={2.5} />
          )}
        </button>
      </div>
    </div>
  );


  const subCategoryNavAndGrid = (
    <div className="space-y-5">
      {/* Tier 1: 人物 / 室內 / 室外 / 寵物 / NPC — this shop's sections only. 特殊卡牌 is absent
          because every one of its shelves (抽獎券, 功能卡) belongs to the 限時小攤 now, exactly
          like 特殊飾品's chip in the row below. See getShopMainSections. */}
      <MainSectionTabs
        sections={SHOP_SECTIONS}
        active={activeSection}
        onChange={(section) => {
          setActiveSection(section);
          const firstSub = getFirstShopCategoryId(section);
          if (firstSub) {
            setActiveSubCategory(firstSub);
            localStorage.setItem(LAST_CATEGORY_KEY, firstSub);
          }
        }}
      />

      {/* Tier 2: sub-category chips scoped to the active main section — and to THIS shop.
          `getShopCategoriesFor` drops any shelf another storefront owns (特殊飾品 belongs to the
          限時小攤 now), so the row can never offer a chip whose grid would be empty. */}
      <SubCategoryTabs
        categories={getShopCategoriesFor(activeSection)}
        active={activeSubCategory}
        onChange={(id) => {
          setActiveSubCategory(id);
          localStorage.setItem(LAST_CATEGORY_KEY, id);
          setTimeout(() => {
            productGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 80);
        }}
      />

      {/* What this shelf actually holds — the shared category note (UI/CategoryTabs.tsx). It is
          what tells a player standing between 配件 and 特殊飾品 which one they are looking at,
          without having to buy from each to find out. */}
      <CategoryNote categoryId={activeSubCategory} />

      {/* 依寵物種類篩選. Renders nothing on every shelf whose goods do not declare a species, which
          is all of them but 寵物用品 and 寵物窩 — the row is derived from the items in front of the
          player, not from a list of category ids here. */}
      <PetSpeciesFilter items={shelfItems} value={petSpecies} onChange={setPetSpecies} />

      {/* 貨架內的分組列 —— 第三層。`subGroup` 一直都在資料裡（樹木 8 組、藝術品 5 組、燈具 6
          組…），但以前只被畫成商品卡角落的一枚貼紙，玩家看得到分組卻沒辦法只看其中一組。

          它讀的是**物種篩過之後**的清單，所以兩個篩選器疊起來永遠不會給出空結果；也因為分組是
          從眼前的商品推出來的，貨架換了就自動換一整列，這裡不需要知道任何分類的名字。門檻（幾件
          以上、幾組以上才畫）在元件自己身上。 */}
      <SubGroupFilter
        items={speciesFilteredItems}
        active={activeSubGroup}
        onChange={setActiveSubGroup}
      />

      {/* Product Cards Catalog Grid
          三欄封頂是這家店最貴的一個限制。貨架不是三件，是十五件（客廳 18、燈具 15、藝術品 43），
          而三欄意味著**任何一個貨架都只能一次看到三件**，剩下的要靠捲動一列一列想起來 —— 逛街的
          動作變成翻頁，而「這一架有什麼」這個問題在 43 件的藝術品上等於問不出來。
          寬螢幕上多開兩欄不需要縮卡：`lg` 的 1000px 殼給三欄時一張卡約 320px，`xl` 放到 1340px
          給四欄仍然是 320px，`2xl` 的 1560px 給五欄是 296px —— 圖示井是 aspect-[4/3]，跟著卡一起
          縮，110px 的商品圖在 296px 的卡裡還有餘裕。也就是說多出來的欄位是**多用了螢幕**，不是把
          每張卡削薄。手機到 lg 之間一格都沒有動。 */}
      <div ref={productGridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
        <AnimatePresence mode="popLayout">
          {filteredItems.map(item => {
            const ownedCount = getOwnedCount(profile, item.id);
            // 經驗值-unlocked items (柴犬) are earned, not bought: while the requirement is unmet
            // the card is dimmed behind a lock rather than hidden, so the player can see what they
            // are training towards. See utils/unlock.ts.
            const xpRequired = getXpRequirement(item);
            const locked = isXpLocked(profile, item);
            // House Styles and room surfaces are applied to something the player already has
            // rather than placed as a new object, so their owned card reports state instead of
            // offering another purchase.
            const isApplyOnOwn = isApplyOnOwnCategory(item.shopCategory);
            const styleForItem = getHouseStyleByItemId(item.id);
            const isCurrentStyle = !!styleForItem && profile?.home?.currentStyle === styleForItem.id;
            // Never `item.rarity` directly — see utils/debugOverrides.ts, which is what lets
            // `?rarity=` reach every surface from one place.
            //
            // Always a tier now: every item in the catalog is graded (constants/rarity.ts), so the
            // `rarity ? … : …` branches that used to guard each of the three places below are gone.
            // What replaced 「有沒有稀有度」 as the thing that varies is the tier's own LAYER BUDGET,
            // which RarityAura reads — 普通 draws a plate in a ring and nothing else, so a shelf of
            // ordinary goods still looks like a shelf of ordinary goods.
            const rarity = getItemRarity(item);

            return (
              <motion.div
                layout
                key={item.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                // A rarity card drops `border-island-line hover:border-island-teal-light` rather
                // than layering over them. This project has no class merging (DESIGN_SYSTEM.md),
                // so two utilities setting `border-color` on one element is decided by stylesheet
                // order, not by which is written last here — `.rarity-card` only reliably wins
                // when the utility it would fight isn't on the element at all.
                //
                // The tier's own class rides on the card as well as on the aura: the whole
                // rectangle is the tier now (`.rarity-card` in index.css — tinted paper, a mat
                // ruled inside the frame, engraving and a travelling highlight from 史詩 up), and
                // which of those a card draws is hung off this class exactly the way 普通's flat
                // plate and 神話's drifting bezel already are. Nothing new is passed as a prop.
                className={`store-card rarity-card rarity-${rarity} p-4 rounded-[1.75rem] border flex flex-col group relative overflow-hidden transition-all duration-300 text-left ${
                  locked ? 'bg-island-cream-2' : 'bg-white'
                }`}
                style={rarityStyleVars(rarity)}
              >
                {/* Owned tag overlay */}
                {ownedCount > 0 && (
                  <div className="absolute top-3 right-3 bg-island-teal text-white px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-widest z-20 flex items-center gap-1">
                    <Check size={10} strokeWidth={4} />
                    <span>已擁有 {ownedCount > 1 ? `x${ownedCount}` : ''}</span>
                  </div>
                )}

                {/* The icon well. On a rarity item it is also the light source — RarityAura
                    paints the lit field, rays and sparkles across it, and the item's own wrapper
                    below stays above that layer so the artwork is never dimmed by it. Same
                    dropped-utility rule as the card above for the border colour. */}
                <div className="w-full aspect-[4/3] bg-island-cream-2 rounded-2xl mb-3 flex items-center justify-center relative overflow-hidden border rarity-well">
                  {/* A locked item's aura is turned down rather than off: the tier is still part
                      of what the player is being shown they could earn. */}
                  <div className={locked ? 'opacity-30' : undefined}>
                    <RarityAura rarity={rarity} />
                  </div>
                  {/* 居民不是道具，所以不照道具的擺法擺：一顆縮在格子正中央的小頭讀起來是一張
                      貼紙，不是一個住在島上的人。這兩張改成鋪滿整格的半身照（見 NpcPortrait），
                      稀有度的琺瑯盤因此被蓋在照片底下 —— 卡片外框和 aria 的「史詩稀有度」都還在。 */}
                  {isNpcPortrait(item.id) ? (
                    <div
                      className={`absolute inset-0 transition-transform duration-300 group-hover:scale-[1.04] ${
                        locked ? 'opacity-40 grayscale' : ''
                      }`}
                    >
                      <NpcPortrait itemId={item.id} />
                    </div>
                  ) : (
                    <div
                      className={`text-island-navy flex items-center justify-center scale-[0.96] transition-transform duration-300 group-hover:scale-[1.02] relative ${
                        locked ? 'opacity-40 grayscale' : ''
                      }`}
                    >
                      <QVersionIcon itemId={item.id} size={110} />
                    </div>
                  )}

                  {/* The lock itself — z-20 so it stays legible above the card-wide scrim below,
                      and pointer-events-none so it never eats a click meant for the card. */}
                  {locked && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-1.5 pointer-events-none">
                      <div className="w-11 h-11 rounded-2xl bg-white/90 border border-island-line flex items-center justify-center text-island-navy-soft shadow-[0_4px_12px_rgba(38,70,83,0.12)]">
                        <Lock size={20} strokeWidth={2.75} />
                      </div>
                      <span className="text-[10px] font-black text-island-navy bg-white/90 border border-island-line px-2 py-0.5 rounded-lg">
                        {xpRequired} 經驗值解鎖
                      </span>
                    </div>
                  )}
                </div>

                {/* Card-wide scrim: what makes a locked card read as *dimmer than the shelf* at a
                    glance, before any of its copy is read. A class-based `opacity` can't do this
                    job here — motion.div writes its own inline opacity for the mount animation and
                    would win — so the dimming is a painted layer instead. */}
                {locked && (
                  <div className="absolute inset-0 z-[15] bg-island-navy/[0.07] pointer-events-none rounded-[1.75rem]" />
                )}

                <div className="flex flex-col flex-1">
                  <h4 className="text-base font-black text-island-navy tracking-tight leading-tight mb-1 truncate group-hover:text-island-teal-dark transition-colors duration-200">{item.name}</h4>

                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {/* The item's own shelf within the category when it declares one (畫作, 雕塑
                        … inside 藝術品), otherwise the category itself. Not both: two chips saying
                        「藝術品」「畫作」 spend the row on the half the player can already see from
                        the tab they are standing on. See `subGroup` in constants/items.ts. */}
                    <span className="px-2 py-0.5 bg-island-cream-2 text-island-navy-soft text-[10px] font-black rounded-lg border border-island-line">
                      {item.subGroup || activeSubCategoryLabel}
                    </span>
                    {/* 家具風格系列 — 原木 / 鄉村 / 海島 / 簡約 / 可愛生活. The one thing a player
                        cannot see from the picture alone: which OTHER pieces this one was drawn
                        to sit beside. Tinted with the series' own accent so a shelf of mixed
                        styles can be scanned for a set without reading a word.
                        Absent on the pieces that deliberately belong to no series — see
                        `styleSeries` in constants/items.ts. */}
                    {(() => {
                      const series = getFurnitureSeries(item.styleSeries);
                      if (!series) return null;
                      return (
                        <span
                          className="px-2 py-0.5 text-[10px] font-black rounded-lg border"
                          style={{
                            color: series.accent,
                            borderColor: `${series.accent}55`,
                            backgroundColor: `${series.accent}1a`,
                          }}
                        >
                          {series.label}
                        </span>
                      );
                    })()}
                    {/* 「這件會動」 — the single fact that separates 特殊飾品 from 配件, said on the
                        card itself rather than only on the shelf it came from. Driven off the
                        cosmetic catalog (constants/cosmeticEffects.ts), so it is true by
                        construction: an item gets this badge if and only if something is actually
                        registered to animate it, and it follows a 寵物飾品 into the 寵物 section
                        without anyone remembering to tag it. */}
                    {getSpecialCosmetic(item.id) && (
                      <span className="px-2 py-0.5 bg-island-teal/12 text-island-teal-dark text-[10px] font-black rounded-lg border border-island-teal/25 flex items-center gap-1">
                        <Sparkles size={10} strokeWidth={3} />
                        動態特效
                      </span>
                    )}
                    {/* Same stock readout the build rail and furniture drawer show, so "how many
                        can I still put down" reads identically wherever it is asked. */}
                    <StockBadge itemId={item.id} />
                  </div>

                  <p className="text-island-navy-soft/70 text-xs font-bold leading-relaxed mb-3 line-clamp-2 min-h-[2rem]">
                    {item.description}
                  </p>
                </div>

                {/* Price display inside bottom card. An 經驗值 item states its requirement in the
                    same slot instead of a gold price — it has none, and the row a player's eye
                    already goes to for "what does this cost me" is where the answer belongs. */}
                {/* Deliberately transparent, on both branches. It used to paint itself white,
                    which was invisible while every card's paper was white and is a bare white
                    band punched across the tier's tint now that a graded card's paper is not. The
                    row needs no fill of its own: what separates it is its rule, not its ground. */}
                <div
                  className="flex items-center justify-between mb-3 border-t border-island-line pt-2.5 relative z-10 w-full"
                >
                  <span className="text-xs text-island-navy-soft/70 font-bold">
                    {xpRequired > 0 ? '解鎖條件' : '商品售價'}
                  </span>
                  {xpRequired > 0 ? (
                    <div className="flex items-center gap-1 font-black text-base text-island-navy">
                      <Zap size={14} className="text-island-teal" strokeWidth={2.75} />
                      <span>
                        {locked ? `${profile?.currentXp ?? 0} / ${xpRequired}` : xpRequired}
                      </span>
                      <span className="text-xs font-bold text-island-navy-soft/70">經驗值</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 font-black text-base text-island-navy">
                      <Coins size={14} className="text-island-gold" />
                      <span>{item.price}</span>
                    </div>
                  )}
                </div>

                {/* 商品碎片 — the other way to own this. Sits directly above the buy button, in the
                    same block as the price, because "what does this cost me" now has two answers and
                    they belong to each other. Renders nothing for an item with no fragment of its own,
                    nor for one whose race is over — but an 已擁有 card that can be bought AGAIN keeps
                    its bar, because the fragments on it are still buying something. That call belongs
                    to FragmentMeter (collectsFragments), not to a second condition here: the shelf,
                    the dialog and the write have to agree, and they only can if they ask once. */}
                <FragmentMeter itemId={item.id} className="mb-3 relative z-10" compact />

                {isApplyOnOwn && ownedCount > 0 ? (
                  <Button
                    variant="ghost"
                    disabled
                    className="w-full py-2.5 text-sm"
                    title={
                      isCurrentStyle
                        ? '目前正在使用這個外觀'
                        : styleForItem
                          ? '在建造模式點擊房屋即可套用'
                          : '在屋內的佈置模式即可套用'
                    }
                  >
                    <Check size={16} strokeWidth={2.5} />
                    <span>{isCurrentStyle ? '使用中' : '已解鎖'}</span>
                  </Button>
                ) : (
                  <BuyButton item={item} onClick={() => openPurchase(item)} className="w-full py-2.5 text-sm" />
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {filteredItems.length === 0 && (
          <div className="col-span-full">
            {/* The category's own reason for being empty, when it has one — 抽獎券 is empty
                because tickets are not sold, not because they have not shipped yet. Read off the
                taxonomy rather than branched on here; see `emptyNote` in utils/categoryUtils.ts. */}
            <EmptyState
              icon={<Box size={32} strokeWidth={1.5} />}
              title="目前該分類尚無商品"
              description={getDisplayCategory(activeSubCategory)?.emptyNote}
            />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {isOverlay ? (
        // z-[60]: local sub-scale — ShopView is mounted inline inside another
        // already-scoped view (DressingRoomView), never portaled, so this only
        // ever needs to out-rank that host's own children, not any global HUD
        // tier. It must clear the dressing room's inventory panel (z-50), which
        // is what used to paint over the shop's left half back when this was a
        // centered z-40 modal. See DESIGN_SYSTEM.md's z-index "local sub-scale
        // exception".
        //
        // No dismiss-on-scrim here: there is no scrim left to click, since the
        // shop now covers the host outright. 返回 (and Escape) is the way out.
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="fixed inset-0 z-[60] bg-island-cream-2 flex flex-col"
        >
          {headerBlock}
          <div ref={catalogScroll} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar page-shell-x py-6 md:py-8">
            <div className={`${SHOP_SHELL_WIDTH} space-y-8`}>
              {subCategoryNavAndGrid}
            </div>
          </div>
        </motion.div>
      ) : (
        // Same local sub-scale as the isOverlay branch above — mutually
        // exclusive with it, so reusing the tier is safe.
        <div ref={pageScroll} className="fixed inset-0 z-[60] bg-island-cream-2 overflow-y-auto page-shell-x page-shell-y">
          <div className={`${SHOP_SHELL_WIDTH} bg-island-cream rounded-[2rem] shadow-[0_15px_40px_rgba(38,70,83,0.12)] border border-island-line overflow-hidden mb-10`}>
            {headerBlock}
            <div className="p-6 md:p-8 space-y-8">
              {subCategoryNavAndGrid}
            </div>
          </div>
        </div>
      )}

      {/* 「我的收藏裝備」的 modal 已經整條移走了。

          它是 `profile.inventory` 的第二個檢視器：自己一套主分區 tabs、自己一套 chip 列、
          自己一個名字，而第一個是更衣室（現在叫 背包）。同一份資料兩個檢視器、四個名字，是
          玩家分不出「我的裝備收納庫」「我的收藏裝備」「裝備收藏庫」「更衣室」的原因。

          現在收納只有一個地方：背包（components/UI/BackpackTabs.tsx），header 上那顆 背包 鍵
          就是通往它的門。 */}

      {/* Purchase confirmation — the shared dialog, so buying here and buying from build mode or
          the furniture drawer are literally the same flow.
          z-[80]: topmost of ShopView's own local sub-scale, so it always beats both the catalog
          (z-[60]) and the inventory drawer (z-[70]). */}
      <AnimatePresence>
        {selectedPurchaseItem && (
          <PurchaseDialog
            item={selectedPurchaseItem}
            onClose={() => setSelectedPurchaseItem(null)}
            zIndexClassName="z-[80]"
          />
        )}
      </AnimatePresence>


      {/* z-[80]: same local sub-scale as the purchase dialog — it must clear the catalog and the
          collection drawer. */}
      <UtilityCardBagModal
        open={showCardBag}
        onClose={() => setShowCardBag(false)}
        zIndexClassName="z-[80]"
      />

      {/* Same local tier as the card bag, and for the same reason. */}
      <PetCareModal
        open={showPetCare}
        onClose={() => setShowPetCare(false)}
        zIndexClassName="z-[80]"
      />
    </>
  );
}
