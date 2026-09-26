/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Maximize2, Minimize2, Home, HelpCircle, ChevronRight,
  Hammer, ChevronsRight, Move, PackageOpen, Trees, Trash2, LayoutGrid,
} from 'lucide-react';
import { ItemDefinition, getItemById } from '../../constants/items';
import { STARTER_HOUSE_ITEM_ID } from '../../constants/houseStyles';
import { hasPlacedHome, usePlayerHome } from '../../hooks/usePlayerHome';
import { useAdminMode } from '../../hooks/useAdminMode';
import { getItemsInCategory, getPlacementCategoriesIn } from '../../utils/categoryUtils';
import { getAvailableStock, getOwnedCount } from '../../utils/inventory';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { describeRecentFailure } from '../../lib/saveStatus';
import { QVersionIcon } from '../QVersionIcon';
import {
  Button, DockPanel, EmptyState, IconTile, ModalOverlay, ModalShell, PanelHeader, Toolbar,
  type ToolbarItem,
} from './DesignKit';
import {
  CatalogDrawer, DrawerSectionDivider, OWNED_DIVIDER, PlacementItemRow, UNOWNED_DIVIDER,
} from './PlacementCatalog';
import { PurchaseDialog } from './PurchaseDialog';
import { AngelGuide, AngelGuideStep, markAngelGuideSeen, shouldShowAngelGuide } from './AngelGuide';
import { FloatingPanelPortal } from './FloatingPanelPortal';
import { HomePanel } from './HomePanel';

/**
 * BUILD MODE — the island's own build chrome, built to the same plan as the house's.
 *
 * ## What this rework was for
 *
 * The two build modes did the same job through two unrelated interfaces, and every difference
 * was accidental rather than a consequence of being outdoors:
 *
 *  - **Browsing.** Indoors: a right-hand drawer, a grid of categories with ownership counts, then
 *    a vertical list split 已擁有 / 尚未擁有 with names, descriptions and stock. Outdoors: a chip
 *    row and a horizontal strip of small square cards with arrow buttons over them, owned and
 *    unowned mixed together and told apart only by a 庫存不足 veil. Both are now the shared
 *    {@link CatalogDrawer}.
 *  - **Positioning.** Indoors the controls were a bottom-centre dock; outdoors a bar at the TOP
 *    of the screen, so the same three verbs lived at opposite edges. Both are now the shared
 *    `PlacementDock` (see UI/IslandEditorOverlay.tsx).
 *  - **Landing.** Build mode opened on 領土規劃 — island resizing, the rarest thing anyone comes
 *    here to do — with 建築規劃 as the second tab. The tools are peers on a dock now, the way the
 *    house's 家具 / 房間擴建 are, and nothing is preselected.
 *
 * ## What is deliberately NOT the same
 *
 * A house is one room you can see all of; an island is a landscape, and the thing a player most
 * often wants out here is not in any shop category — it is the object already standing on their
 * lawn. Clicking its model still works and is still the fastest way, but it is a poor primary:
 * a 火把 is a few pixels on a phone, an object can be behind the house, and nothing on screen
 * ever said that clicking was a thing you could do. So build mode gets a third tool the interior
 * has no use for — **島上物件**, a list of what is already placed, with 移動 and 收回 on each row
 * and the Home at the top of it. That is the one place these two modes should diverge, and it is
 * the difference in the WORLD, not in the widgets.
 *
 * 領土規劃 keeps its own surface too, but as a modal rather than half of the mode: it edits the
 * island itself rather than anything on it, which makes it a sibling of 房間擴建 indoors.
 *
 * ## 我的家 is the fourth tool, and it earns that by the same test
 *
 * The Home used to be row one of 島上物件 — a list whose own subtitle promises 移動或收回 — and
 * tapping that row started a MOVE outright. Every other reason to point at your house (looking at
 * it, repainting it, turning it a notch) went through a transform the player never asked for, and
 * repainting was worse than hidden: it lived on the placement dock, i.e. only reachable from
 * inside a move.
 *
 * Name the thing about the WORLD that requires the divergence, same as 島上物件 had to:
 *
 *  - the Home is not in `islandPlacements` — it is a singular `profile.home`, and it cannot be
 *    收回'd, so two of that list's three columns are meaningless for it;
 *  - it is the only object that wears an APPEARANCE (constants/houseStyles.ts) — a whole verb no
 *    fountain has;
 *  - it is the only object you can walk INTO, and the one the whole island is arranged around.
 *
 * That is three verbs on one subject, which is a destination, not a row. So it is a peer on the
 * dock, first in the row, and its surface (UI/HomePanel.tsx) is a SELECTION state: it shows the
 * house and lets the player choose. 島上物件 keeps a 我的家 row for findability, but the row now
 * opens the same panel rather than doing something else — one subject, one place to edit it.
 */

/**
 * Build-mode tutorials, spoken by the 小天使 NPC (AngelGuide.tsx) — the same device the house
 * interior uses for its 家具 / 房間擴建 flows, under the same rules (auto-play once per player,
 * one tap per beat, 跳過 kills it, the 說明 key on the toolbar brings it back).
 *
 * One script per tool, because they are unrelated jobs and a single combined script would spend
 * most of its beats on whichever one the player did not open. Each script talks only about
 * controls that are on screen while it plays, so a beat never points at a button the player has
 * to go and find first.
 */
type AngelTopic = 'overview' | 'home' | 'catalog' | 'placed' | 'territory';

const ANGEL_GUIDES: Record<AngelTopic, AngelGuideStep[]> = {
  overview: [
    {
      title: '建造模式',
      body: '哈囉～我是小天使！這裡可以整理你的家、擺新東西、搬動已經放好的東西，還有調整島的大小。',
    },
    {
      title: '從哪裡開始',
      body: '房子的事都在「我的家」；想加點什麼就按「建築與裝飾」；要搬動或收回已經放好的東西，按「島上物件」。',
    },
    {
      title: '結束編輯',
      body: '弄完之後按右上角的「退出編輯」就好，隨時想再看說明就點「說明」叫我出來！',
    },
  ],
  home: [
    {
      title: '我的家',
      body: '這裡是房子的管理頁，先讓你看看現在的家長什麼樣、大門朝哪邊，再決定要做什麼。',
    },
    {
      title: '換個外觀',
      body: '按「更換外觀」挑一款喜歡的，點「套用」就換好了 —— 房子不會被搬走，裡面的家具也都在。',
    },
    {
      title: '搬家或轉個方向',
      body: '想換位置或改大門方向，按「移動與轉向」才會進到擺放模式：拖曳搬動、按 R 轉 45°，滿意再按「確認」。',
    },
  ],
  catalog: [
    {
      title: '挑一個帶走',
      body: '先選分類，再點卡片上的「擺放」，物件就會出現在島上。按住它拖到想要的地方，或點一下地面決定落點。',
    },
    {
      title: '還沒有的東西',
      body: '沒買過的會排在「尚未擁有」那一區，想要的話直接在同一張卡上按「購買」就行。',
    },
    {
      title: '一個接一個',
      body: '確認擺放之後清單還會留在旁邊，可以連續放好幾個不用重開。',
    },
  ],
  placed: [
    {
      title: '島上物件',
      body: '這是你已經放在島上的東西。找不到某個裝飾的時候，從這裡找最快。',
    },
    {
      title: '搬家或收回',
      body: '按「移動」就能重新擺位置，按「收回」會把它放回背包，之後隨時能再拿出來。',
    },
    {
      title: '你的家',
      body: '房子也在這張清單的最上面，不過點它是打開「我的家」，不會直接把房子搬起來喔。',
    },
  ],
  territory: [
    {
      title: '領土規劃',
      body: '這一頁管的是島的大小，你可以把可蓋房子的地變大或變小。',
    },
    {
      title: '擴張領土',
      body: '按「擴張島嶼領土」就會多出一圈土地，卡片上寫的 XP 是這一階需要的解鎖條件喔。',
    },
    {
      title: '縮減領土',
      body: '覺得島太空曠？按「縮減島嶼領土」退回上一階，之後想擴張回來隨時都可以。',
    },
  ],
};

/**
 * Replaces the overview before the Home exists: the mode collapses to the Starter House then, so
 * the real script's talk of three tools would be describing a dock that is not there.
 */
const HOME_FIRST_GUIDE: AngelGuideStep[] = [
  {
    title: '先放下你的家',
    body: '哈囉～我是小天使！在蓋別的東西之前，得先幫你的家找個位置。',
  },
  {
    title: '選個好地方',
    body: '按「開始放置」，房子就會出現在島上。按住房子拖到喜歡的地方、按 R 轉方向，滿意就按「確認」。',
  },
  {
    title: '之後呢？',
    body: '家蓋好以後，這裡就會變成一整組建造工具，隨時回來慢慢佈置！',
  },
];

/**
 * Which of this overlay's OWN surfaces is open. `null` is the dock on its own.
 *
 * 我的家 is not in here: its open state lives with the editing session (`homeMenuOpen`,
 * context/useIslandEditor.ts) because the house can also be selected by clicking it in the world,
 * and because a Home transform has to know to come back to it.
 */
type BuildTool = 'catalog' | 'placed' | 'territory';

/** One card on the build dock. `id` doubles as the 小天使 topic the card narrates. */
interface DockTool {
  id: AngelTopic;
  icon: React.ReactNode;
  label: string;
  /** The `sm:hidden` label. Four cards in one phone-width row only fit at four characters. */
  shortLabel?: string;
  hint: string;
}

/**
 * The dock, in the order a player actually needs it: their house, then things to add, then things
 * already out there, then the land itself — most personal to most structural.
 */
const HOME_TOOL: DockTool = {
  id: 'home',
  icon: <Home size={22} strokeWidth={2.5} />,
  label: '我的家',
  hint: '外觀、位置與方向',
};

const BUILD_TOOLS: DockTool[] = [
  { id: 'catalog', icon: <Hammer size={22} strokeWidth={2.5} />, label: '建築與裝飾', shortLabel: '建築裝飾', hint: '挑選並擺放新的物件' },
  { id: 'placed', icon: <LayoutGrid size={22} strokeWidth={2.5} />, label: '島上物件', hint: '移動或收回已擺放的東西' },
  { id: 'territory', icon: <Maximize2 size={22} strokeWidth={2.5} />, label: '島嶼領土', hint: '調整可建造的土地範圍' },
];

/**
 * How the dock lays its cards out, by how many there are.
 *
 * Literal strings rather than `grid-cols-${n}`, which Tailwind's scanner cannot see. Three tiers,
 * for the reason each exists: a phone fits one row of compact cards, a tablet has vertical room
 * to spare and no horizontal room for four captioned cards side by side, and from `lg` up the row
 * fits with its captions (4 × 13rem + gaps ≈ 892px).
 */
const DOCK_LAYOUT: Record<number, string> = {
  3: 'grid grid-cols-3 lg:flex lg:items-stretch',
  4: 'grid grid-cols-4 sm:grid-cols-2 lg:flex lg:items-stretch',
};

export function BuildModeOverlay() {
  const {
    currentView, setCurrentView,
    expandTerritory, shrinkTerritory,
    profile, setActivePlacementItem, selectHome, selectIslandPlacement, removeIslandPlacement,
    islandDraft, showIslandAlert,
    homeMenuOpen, closeHomeMenu, startHomeTransform, applyHouseStyle,
  } = useApp();
  const isAdminMode = useAdminMode();
  const home = usePlayerHome(profile);

  const [tool, setTool] = useState<BuildTool | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [purchaseItem, setPurchaseItem] = useState<ItemDefinition | null>(null);

  // By PLACEMENT SCOPE, not by shop section: this drawer is 「什麼可以放在島上」, and a shelf can be
  // browsed under one tab and put down in another world — 寵物窩 is sold in 寵物 and stands on the
  // island. See DisplayCategory.placementScope in utils/categoryUtils.ts.
  const outdoorCategories = useMemo(() => getPlacementCategoriesIn('OUTDOOR', ['placeable']), []);

  // Before the Home exists the mode collapses to the Starter House alone, so the guided
  // first-placement can't be sidestepped by placing decorations first.
  const needsHome = !!profile && !hasPlacedHome(profile) && !!profile.inventory?.includes(STARTER_HOUSE_ITEM_ID);
  const homePlaced = hasPlacedHome(profile);
  const placements = profile?.islandPlacements ?? [];

  /** The dock's cards. 我的家 leads, but only once there is a house to manage. */
  const dockTools = useMemo(
    () => (homePlaced ? [HOME_TOOL, ...BUILD_TOOLS] : BUILD_TOOLS),
    [homePlaced],
  );

  /**
   * 貨架內的分組篩選（第三層）。`null` 是「全部」，換分類就歸零 —— 分組名稱是每一架自己的。
   * 室外這邊最需要它的是 互動物件：21 件，橫跨座椅／遊憩／野餐／營地／觀景五組。
   */
  const [activeSubGroup, setActiveSubGroup] = useState<string | null>(null);
  useEffect(() => {
    setActiveSubGroup(null);
  }, [activeCategory]);

  /** 這一架的全部商品 —— 分組列列的是「這裡有哪幾組」，所以讀的是篩之前的清單。 */
  const categoryItems = useMemo(
    () => (activeCategory ? getItemsInCategory(activeCategory) : []),
    [activeCategory],
  );

  /** Everything in the open category, split by whether the player owns it yet. */
  const drawerItems = useMemo(() => {
    const decorated = categoryItems
      .filter(item => activeSubGroup === null || item.subGroup === activeSubGroup)
      .map(item => ({
        item,
        owned: getOwnedCount(profile, item.id),
        available: getAvailableStock(profile, item.id),
      }));
    return {
      owned: decorated.filter(e => e.owned > 0),
      unowned: decorated.filter(e => e.owned === 0),
    };
    // `placements` is a dependency because stock is `owned - placed`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryItems, activeSubGroup, profile?.inventory, placements]);

  /** How many of a category the player owns — the count shown on the category tiles. */
  const ownedCountByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const category of outdoorCategories) {
      counts[category.id] = getItemsInCategory(category.id).filter(
        item => getOwnedCount(profile, item.id) > 0,
      ).length;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outdoorCategories, profile?.inventory]);

  /**
   * What is standing on the island, grouped the way the shop groups it.
   *
   * Grouped rather than listed flat because an island with thirty things on it is a wall of names
   * otherwise, and the grouping the player already knows is the catalog's own.
   */
  const placedGroups = useMemo(() => {
    const byCategory = new Map<string, { label: string; rows: typeof placements }>();
    for (const p of placements) {
      const item = getItemById(p.itemId);
      if (!item) continue;
      const category = outdoorCategories.find(c => c.id === item.shopCategory);
      const key = category?.id ?? 'other';
      const label = category?.label ?? '其他';
      if (!byCategory.has(key)) byCategory.set(key, { label, rows: [] });
      byCategory.get(key)!.rows.push(p);
    }
    return [...byCategory.entries()].map(([id, g]) => ({ id, ...g }));
  }, [placements, outdoorCategories]);

  // --- 小天使 guide state ---------------------------------------------------
  // Same shape as BuildingInteriorView's: `angelRun` is bumped on every trigger so the guide
  // remounts and restarts at step 1 even when the same topic fires twice in a row.
  const [angelTopic, setAngelTopic] = useState<AngelTopic | null>(null);
  const [angelRun, setAngelRun] = useState(0);

  /**
   * The bookkeeping id for a topic. Normally the topic itself — except that 建造模式 has two
   * different overview scripts and they are two different lessons: reading HOME_FIRST_GUIDE must
   * not spend the real overview's one showing, or a player who placed their house would never be
   * told what the three tools on the dock are.
   */
  const angelGuideId = React.useCallback(
    (topic: AngelTopic) => (topic === 'overview' && needsHome ? 'overview.homeFirst' : topic),
    [needsHome],
  );

  /**
   * Puts her on screen — and banks the topic as read in the same breath.
   *
   * Marking on SHOW rather than on dismiss is what makes 「每個功能只在第一次使用時出現」 actually
   * true. Dismissal is only one of the ways she leaves: walking out of build mode, opening a
   * different tool and starting a placement all RETIRE her without the player ever pressing
   * anything, and while those paths wrote nothing, a player who glanced at her and carried on got
   * the same beats again on every single visit. Being shown the lesson is what counts as having
   * had it; the 說明 key is the way back to one.
   *
   * 管理員測試模式 is unaffected: markAngelGuideSeen writes nothing while it is on, and
   * shouldShowAngelGuide answers yes every time (lib/tutorialReplay.ts), so every 小天使 replays
   * on every entry for a tester and the player's real record underneath is never touched.
   *
   * `force` is the 說明 key: a deliberate ask, so the seen flag doesn't get a vote.
   */
  const showAngel = React.useCallback((topic: AngelTopic, force = false) => {
    const id = angelGuideId(topic);
    if (!force && !shouldShowAngelGuide(id, isAdminMode)) return;
    markAngelGuideSeen(id, isAdminMode);
    setAngelTopic(topic);
    setAngelRun(r => r + 1);
  }, [isAdminMode, angelGuideId]);

  // Each tool narrates itself, and entering the mode narrates the dock. That is the same
  // commitment rule the interior follows — a guide waits until the player has said which job they
  // came to do — and it is what makes a short script per surface better than one long one. A placement
  // session belongs to `islandDraft` rather than to a tool, so it is excluded: it is reachable
  // from the island view too, and arriving in build mode with one already running must not put
  // her on screen behind the editor dock.
  /** Which surface she is narrating. 我的家 is a topic like any other, just not a `tool`. */
  const angelSurface: AngelTopic = homeMenuOpen ? 'home' : tool ?? 'overview';

  useEffect(() => {
    if (currentView !== View.BUILD_MODE) {
      setAngelTopic(null);
      return;
    }
    // Leaving this branch silent rather than clearing is deliberate: retiring her for a draft is
    // the next effect's job.
    if (islandDraft) return;
    // She is only ever allowed to be on screen talking about the surface that is actually open.
    // Moving to one whose lesson is already spent has to retire her rather than leave her
    // narrating a drawer that just closed — `showAngel` alone would decline and change nothing.
    // Keeping her when the topic already matches is what lets `openTool` summon her for a
    // re-click of the surface that is open without this effect wiping it in the next commit.
    setAngelTopic(prev => (prev === angelSurface ? prev : null));
    showAngel(angelSurface);
  }, [currentView, angelSurface, islandDraft, showAngel]);

  // 我的家 and the tool drawers are all right-hand surfaces on the same tier, so they take turns
  // rather than stacking. Opening the panel from a world click (PlayerHomeView) can arrive while
  // a drawer is up, so the rule lives here rather than at each call site.
  useEffect(() => {
    if (homeMenuOpen) setTool(null);
  }, [homeMenuOpen]);

  // Nothing this overlay owns survives leaving build mode — including a selection held in the
  // editing session, which would otherwise be waiting the next time the player walks back in.
  useEffect(() => {
    if (currentView !== View.BUILD_MODE) closeHomeMenu();
  }, [currentView, closeHomeMenu]);

  /**
   * Takes her off screen. Nothing to bank — `showAngel` already did that the moment she appeared,
   * so 跳過, reading to the end and every silent retire below all mean the same thing to the
   * record: she has had her one showing.
   */
  const dismissAngel = React.useCallback(() => setAngelTopic(null), []);

  // Starting to site something replaces the dock she is narrating with the placement dock, so
  // rather than leave her stranded talking about controls the player can no longer see, she bows
  // out.
  useEffect(() => {
    if (islandDraft) dismissAngel();
  }, [islandDraft, dismissAngel]);

  /** Replays the current surface's guide on demand (the 說明 key), seen flag or not. */
  const replayAngel = () => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    showAngel(angelSurface, true);
  };

  if (currentView !== View.BUILD_MODE) return null;

  const act = (action: () => void) => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    action();
  };

  /**
   * Arming a piece leaves the drawer open behind the placement dock, exactly as the house does —
   * that is what lets a player put down five fence posts without re-opening the list five times.
   */
  const startPlacing = (itemId: string) => act(() => setActivePlacementItem(itemId));

  const startMoving = (instanceId: string) => act(() => selectIslandPlacement(instanceId));

  /**
   * 收回 straight from the row — the same write the editing session's 收回 performs, addressed to
   * an object the player is not currently holding. See `removeIslandPlacement` in AppContext for
   * why this does not go select-then-retrieve.
   */
  const retrieve = (instanceId: string) => act(() => {
    void removeIslandPlacement(instanceId).then((ok: boolean) => {
      if (!ok) showIslandAlert(describeRecentFailure());
    });
  });

  /** A dock card. 我的家 opens a selection; the other three open one of this overlay's drawers. */
  const openTool = (id: AngelTopic) => act(() => {
    if (id === 'home') {
      selectHome();
    } else {
      setTool(id as BuildTool);
    }
    // Pressing the card of the surface that is ALREADY open changes no state, so the effect that
    // normally introduces a surface never runs. 管理員測試模式 promises a tester the guide on
    // every press, so the press asks for itself in that one case; a normal player has already
    // spent that topic's showing, so `showAngel` declines and this is a no-op. Any OTHER card is
    // left to the effect — asking here as well would restart her twice for one press.
    if (id === angelSurface) showAngel(id);
  });

  /**
   * 套用 from the style list. Reports a refused write the same way every other button in this
   * mode does — an appearance that silently didn't change reads as a broken panel.
   */
  const applyStyle = (styleItemId: string) => act(() => {
    void applyHouseStyle(styleItemId).then((ok: boolean) => {
      if (!ok) showIslandAlert(describeRecentFailure());
    });
  });

  // Every mode-level control is one array rather than separately hand-placed JSX, so a future
  // tool is added here rather than bolted on as another absolutely-positioned element. The three
  // BUILD TOOLS are deliberately NOT in it: they are destinations on the dock below, the same
  // shape the house's 家具 / 房間擴建 take, and this row is what is true whatever is open.
  const toolbarItems: ToolbarItem[] = [
    {
      // Always present, unlike the interior's floating ? which hides itself while she is up: this
      // one is a key in a fixed row, and a key that disappeared mid-tutorial would shuffle the
      // one beside it. Pressing it while she is already talking just restarts her.
      id: 'guide',
      kind: 'action',
      variant: 'ghost',
      label: '說明',
      icon: <HelpCircle className="h-4 w-4 sm:h-5 sm:w-5" strokeWidth={3} />,
      title: '請小天使再說一次',
      onClick: replayAngel,
    },
    {
      id: 'exit',
      kind: 'action',
      variant: 'secondary',
      label: '退出編輯',
      icon: <X className="h-4 w-4 text-island-navy-soft sm:h-5 sm:w-5" strokeWidth={3} />,
      onClick: () => act(() => setCurrentView(View.HOME)),
    },
  ];

  return (
    // z-hud-toolbar (not z-game-view): the player can walk the island while this overlay is open,
    // so on touch devices MobileControls' full-bleed joystick catcher (z-hud-touch) is mounted
    // underneath. This container stays pointer-events-none so touches fall through to the joystick
    // everywhere it is empty, but its panels must out-layer that catcher to stay tappable.
    <div
      className="pointer-events-none fixed inset-0 z-hud-toolbar flex flex-col items-center justify-start"
      style={{
        // Edge insets come from the shared --hud-inset token rather than a per-component `p-8`, so
        // this overlay breathes at the same distance from the viewport edge as the rest of the HUD
        // and never clips into a notch. It stays outside HudFrame (only mounted for
        // HOME/BUILDING_INTERIOR) but follows its spacing rules.
        paddingTop: 'max(var(--hud-inset), env(safe-area-inset-top))',
        paddingRight: 'max(var(--hud-inset), env(safe-area-inset-right))',
        paddingBottom: 'max(var(--hud-inset), env(safe-area-inset-bottom))',
        paddingLeft: 'max(var(--hud-inset), env(safe-area-inset-left))',
      }}
    >
      {/* 小天使. Mounted inside this overlay rather than at App level so she lives and dies with
          build mode; `absolute inset-0` here spans the viewport, so she centres against the screen
          rather than against the dock. The key remounts her per topic AND per run, so the step
          counter restarts both when the script changes and when a replay is asked for. */}
      <AnimatePresence>
        {angelTopic && (
          <AngelGuide
            key={`${angelTopic}-${angelRun}`}
            placement="island"
            steps={angelTopic === 'overview' && needsHome ? HOME_FIRST_GUIDE : ANGEL_GUIDES[angelTopic]}
            onClose={dismissAngel}
          />
        )}
      </AnimatePresence>

      {/* While an object is being sited the island IS the interface: the placement dock
          (IslandEditorOverlay) takes the bottom centre and this steps out of the way rather than
          covering the ground the player is trying to drop something onto. */}
      {/* Mode-level controls at the TOP, the tools at the bottom.
          The bottom belongs to whichever dock is live — the tool dock, or the placement dock that
          replaces it — so 說明 and 退出編輯 cannot be under either of them, and the split matches
          the house, where 退出 is in the header and the tools are on the dock. */}
      <AnimatePresence>
        {!islandDraft && (
          <motion.div
            key="build-toolbar"
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
          >
            <Toolbar items={toolbarItems} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {!islandDraft && (
          <React.Fragment key="build-dock">
            {needsHome ? (
              <StarterHomeDock onPlace={() => startPlacing(STARTER_HOUSE_ITEM_ID)} />
            ) : (
              // Peer destinations on one plank, so they read as cards rather than as four solid
              // buttons shouting equally — the same treatment (and the same reasoning) as the
              // house's build dock. DockPanel owns its own bottom-centre placement, so this stack
              // only ever passes width, layout and padding.
              //
              // The cards used to be a fixed `sm:w-52 lg:w-56` in a flex row, which already
              // overflowed a 640px viewport at three of them and would have run ~250px off screen
              // at four. They are laid out by DOCK_LAYOUT now — a phone row, a tablet 2×2, a
              // laptop row of shrinkable `flex-[1_1_13rem]` cards under a viewport-width cap.
              <DockPanel
                initial={{ y: 50, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 50, opacity: 0 }}
                className={`pointer-events-auto w-[95%] gap-1.5 p-2 sm:w-auto sm:max-w-[calc(100vw-2rem)] sm:gap-3 sm:p-3 ${DOCK_LAYOUT[dockTools.length] ?? DOCK_LAYOUT[3]}`}
              >
                {dockTools.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => openTool(entry.id)}
                    className="group flex min-w-0 flex-col items-center gap-1.5 rounded-[1.5rem] border border-island-line bg-island-sand px-2 py-2.5 text-center shadow-[inset_0_1px_3px_rgba(38,70,83,0.07)] transition-all duration-300 hover:-translate-y-1 hover:border-island-teal hover:bg-island-cream hover:shadow-[0_14px_28px_-10px_rgba(42,157,143,0.5)] active:scale-[0.98] sm:flex-row sm:gap-3 sm:px-3 sm:py-3 sm:text-left lg:flex-[1_1_13rem] lg:gap-3.5 lg:px-4"
                  >
                    {/* Solid teal, not a tint: on a sand card a tinted tile is invisible, and the
                        tile is what gives each slot its colour weight. */}
                    <IconTile
                      size={44}
                      solid
                      className="shadow-[0_4px_10px_rgba(42,157,143,0.35)] transition-transform duration-300 group-hover:scale-105"
                    >
                      {entry.icon}
                    </IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block whitespace-nowrap text-[11px] font-black text-island-navy transition-colors group-hover:text-island-teal-dark sm:text-[15px]">
                        {/* Four cards only fit one phone row at four characters, so a card that
                            needs a shorter name declares one rather than being truncated into an
                            ellipsis. Nothing is dropped — the full name is back from `sm`. */}
                        <span className="sm:hidden">{entry.shortLabel ?? entry.label}</span>
                        <span className="hidden sm:inline">{entry.label}</span>
                      </span>
                      <span className="hidden truncate text-[11px] font-bold text-island-navy-soft sm:block">
                        {entry.id === 'placed' ? `${placements.length + (homePlaced ? 1 : 0)} 件已擺放` : entry.hint}
                      </span>
                    </span>
                    <ChevronRight
                      size={16}
                      strokeWidth={3}
                      className="hidden flex-shrink-0 text-island-navy-soft/45 transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-island-teal sm:block"
                    />
                  </button>
                ))}
              </DockPanel>
            )}
          </React.Fragment>
        )}
      </AnimatePresence>

      {/* The tools' own surfaces, on the floating-panel tier above everything this overlay owns. */}
      <FloatingPanelPortal>
        {/* 我的家. Outside the `tool` switch because its open state belongs to the editing session
            (it is also opened by clicking the house), and hidden — not closed — while a transform
            is running, so 取消 lands the player back on the page they started from. */}
        <AnimatePresence>
          {homeMenuOpen && home && !islandDraft && (
            <HomePanel
              key="home"
              home={home}
              profile={profile}
              onStartTransform={() => act(startHomeTransform)}
              onApplyStyle={applyStyle}
              onBuy={setPurchaseItem}
              onClose={() => act(closeHomeMenu)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tool === 'catalog' && (
            <CatalogDrawer
              key="catalog"
              icon={<Hammer size={20} strokeWidth={2.5} />}
              // 「挑選物件」，跟屋內那個抽屜同名 —— 它們是**同一個元件**在做同一件事，副標才是
              // 差別（島上 vs 房間裡）。以前一個叫「挑選建築與裝飾」一個叫「挑選擺設與家具」，同
              // 一個動作在兩個地方有兩個名字，玩家得分別記住。見 BuildingInteriorView 的同一處。
              title="挑選物件"
              subtitle="放在島上的植物、裝飾與大型裝置"
              categories={outdoorCategories}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              ownedCountByCategory={ownedCountByCategory}
              subGroupItems={categoryItems}
              activeSubGroup={activeSubGroup}
              onSubGroupChange={setActiveSubGroup}
              emptyIcon={<Trees size={32} strokeWidth={1.5} />}
              // Half height and no backdrop while a piece is being positioned, so the player can
              // reach the ground and place one thing after another. Same pose as indoors.
              compact={!!islandDraft}
              onClose={() => act(() => setTool(null))}
            >
              {drawerItems.owned.length > 0 && (
                <section className="space-y-3">
                  <DrawerSectionDivider {...OWNED_DIVIDER} count={drawerItems.owned.length} owned />
                  {drawerItems.owned.map(entry => (
                    <PlacementItemRow
                      key={entry.item.id}
                      item={entry.item}
                      owned
                      available={entry.available}
                      onPlace={() => startPlacing(entry.item.id)}
                      onBuy={() => setPurchaseItem(entry.item)}
                    />
                  ))}
                </section>
              )}
              {drawerItems.unowned.length > 0 && (
                <section className="space-y-3 pt-1">
                  <DrawerSectionDivider {...UNOWNED_DIVIDER} count={drawerItems.unowned.length} />
                  {drawerItems.unowned.map(entry => (
                    <PlacementItemRow
                      key={entry.item.id}
                      item={entry.item}
                      owned={false}
                      available={0}
                      onPlace={() => startPlacing(entry.item.id)}
                      onBuy={() => setPurchaseItem(entry.item)}
                    />
                  ))}
                </section>
              )}
            </CatalogDrawer>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tool === 'placed' && !islandDraft && (
            <PlacedObjectsDrawer
              key="placed"
              groups={placedGroups}
              homePlaced={homePlaced}
              onSelectHome={() => act(selectHome)}
              onMove={startMoving}
              onRetrieve={retrieve}
              onClose={() => act(() => setTool(null))}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {tool === 'territory' && !islandDraft && (
            <TerritoryPanel
              level={profile?.territoryLevel || 1}
              onExpand={() => act(expandTerritory)}
              onShrink={() => act(shrinkTerritory)}
              onClose={() => act(() => setTool(null))}
            />
          )}
        </AnimatePresence>

        {/* Buying from here opens the same dialog the shop opens — one purchase flow, one place
            the price and the confirmation are written. */}
        <AnimatePresence>
          {purchaseItem && (
            <PurchaseDialog item={purchaseItem} onClose={() => setPurchaseItem(null)} />
          )}
        </AnimatePresence>
      </FloatingPanelPortal>
    </div>
  );
}

/** The one-off first-run dock: before the Home exists, there is nothing else to build. */
function StarterHomeDock({ onPlace }: { onPlace: () => void }) {
  return (
    <DockPanel
      initial={{ y: 50, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 50, opacity: 0 }}
      className="pointer-events-auto flex w-[95%] flex-col items-center gap-4 p-4 text-center sm:w-auto sm:flex-row sm:text-left"
    >
      <IconTile size={64} solid className="flex-shrink-0">
        <Home size={30} strokeWidth={2.5} />
      </IconTile>
      <div className="min-w-0 flex-1 sm:max-w-sm">
        <h3 className="text-lg font-black text-island-navy">先放下你的家</h3>
        <p className="mt-1 text-xs font-bold leading-relaxed text-island-navy-soft">
          選一個喜歡的位置放置房屋，之後就能在這裡擺放其他建築與裝飾。
        </p>
      </div>
      <Button variant="primary" onClick={onPlace} className="px-6 py-3 text-sm">
        <Hammer size={16} strokeWidth={2.5} />
        <span>開始放置</span>
      </Button>
    </DockPanel>
  );
}

/**
 * 島上物件 — the tool the house does not need.
 *
 * Clicking an object's own model still starts the same session and is still the fastest way to
 * edit something you can see. This is for everything else: the 火把 that is twelve pixels across
 * on a phone, the planter behind the house, and the plain question "what have I actually put out
 * here?". Every row offers the two verbs the world does — 移動 (which hands over to the same
 * editing session a click would have started) and 收回 — so nothing here is a second rule.
 *
 * The Home keeps its place at the top for findability, but it is the one row that is not a verb:
 * it opens 我的家 (its own dock tool, UI/HomePanel.tsx) rather than picking the house up, because
 * 移動 / 收回 are the wrong two columns for it — a house cannot be 收回'd and moving it is one of
 * three things you might want. It is drawn as a link, not as a card with buttons, so the row
 * cannot be mistaken for the ones under it.
 */
function PlacedObjectsDrawer({
  groups,
  homePlaced,
  onSelectHome,
  onMove,
  onRetrieve,
  onClose,
}: {
  groups: Array<{ id: string; label: string; rows: Array<{ instanceId: string; itemId: string }> }>;
  homePlaced: boolean;
  onSelectHome: () => void;
  onMove: (instanceId: string) => void;
  onRetrieve: (instanceId: string) => void;
  onClose: () => void;
}) {
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      onWheel={(e) => e.stopPropagation()}
      className="absolute inset-0 z-floating-panel flex items-center justify-end bg-island-navy/45 p-4 md:p-8"
    >
      <motion.div
        initial={{ x: 100 }}
        animate={{ x: 0 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        className="pointer-events-auto flex h-full w-full max-w-md flex-col overflow-hidden rounded-[2rem] border border-island-line bg-island-cream shadow-[0_24px_60px_rgba(38,70,83,0.3)]"
      >
        <PanelHeader
          icon={<LayoutGrid size={20} strokeWidth={2.5} />}
          title="島上物件"
          subtitle={`${total + (homePlaced ? 1 : 0)} 件已擺放 · 也可以直接點島上的模型`}
          onClose={onClose}
        />

        <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto overscroll-contain bg-island-cream-2/40 p-6">
          {homePlaced && (
            <section className="space-y-3">
              <DrawerSectionDivider icon={<Home size={13} strokeWidth={3} />} label="我的家" count={1} owned />
              <button
                onClick={onSelectHome}
                className="group flex w-full items-center gap-4 rounded-[1.5rem] border border-island-line bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-island-teal active:scale-[0.99]"
              >
                <IconTile size={64} solid className="flex-shrink-0">
                  <Home size={28} strokeWidth={2.5} />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-black text-island-navy">我的家</span>
                  {/* Says where it GOES, not what it does to the house. The old copy read
                      「移動、旋轉，或更換房屋外觀」 on a row that only ever did the first. */}
                  <span className="block text-xs font-black text-island-navy-soft/70">
                    開啟房屋管理，外觀與位置都在裡面
                  </span>
                </span>
                <ChevronsRight
                  size={18}
                  strokeWidth={2.5}
                  className="flex-shrink-0 text-island-teal transition-transform group-hover:translate-x-0.5"
                />
              </button>
            </section>
          )}

          {total === 0 && !homePlaced && (
            <EmptyState
              icon={<PackageOpen size={32} strokeWidth={1.5} />}
              title="島上還沒有東西"
              description="回到「建築與裝飾」挑一個喜歡的擺設放上來吧。"
            />
          )}

          {groups.map(group => (
            <section key={group.id} className="space-y-3">
              <DrawerSectionDivider
                icon={<Trees size={13} strokeWidth={3} />}
                label={group.label}
                count={group.rows.length}
              />
              {group.rows.map(row => {
                const item = getItemById(row.itemId);
                if (!item) return null;
                return (
                  <div
                    key={row.instanceId}
                    className="flex w-full items-center gap-4 rounded-[1.5rem] border border-island-line bg-white p-4 transition-all hover:border-island-teal-light"
                  >
                    <IconTile size={56} className="flex-shrink-0 bg-white">
                      <QVersionIcon itemId={item.id} size={48} />
                    </IconTile>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-black text-island-navy">{item.name}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs font-black text-island-navy-soft/70">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-stretch gap-1.5">
                      <Button
                        variant="primary"
                        onClick={() => onMove(row.instanceId)}
                        className="px-3 py-1.5 text-[11px]"
                        title="重新擺放這個物件"
                      >
                        <Move size={13} strokeWidth={2.5} />
                        <span>移動</span>
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => onRetrieve(row.instanceId)}
                        className="px-3 py-1.5 text-[11px]"
                        title="收回這個擺設，庫存會加回一件"
                      >
                        <Trash2 size={13} strokeWidth={2.5} />
                        <span>收回</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * 島嶼領土 — resizing the island itself.
 *
 * A modal rather than half of build mode. It is the one tool here that edits no OBJECT, which is
 * exactly what makes it the sibling of the house's 房間擴建 rather than a peer of the catalog —
 * and it is the rarest thing anyone opens build mode to do, so it no longer gets the landing tab.
 */
function TerritoryPanel({
  level,
  onExpand,
  onShrink,
  onClose,
}: {
  level: number;
  onExpand: () => void;
  onShrink: () => void;
  onClose: () => void;
}) {
  return (
    <ModalOverlay zIndexClassName="z-modal" onClick={onClose}>
      <ModalShell maxWidthClassName="max-w-2xl">
        <PanelHeader
          icon={<Maximize2 size={20} strokeWidth={2.5} />}
          title="島嶼領土"
          subtitle={`目前等級 ${level} · 增加或收回可建造的土地`}
          onClose={onClose}
        />
        <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-2">
          <button
            onClick={onExpand}
            className="group flex items-center gap-5 rounded-[1.5rem] border border-island-teal/25 bg-island-teal/8 p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-island-teal/14 active:scale-[0.98]"
          >
            <IconTile size={64} active className="text-island-teal transition-transform group-hover:scale-110">
              <Maximize2 size={30} />
            </IconTile>
            <span className="min-w-0">
              <span className="block text-lg font-black text-island-teal-dark">擴張島嶼領土</span>
              <span className="mt-1 block text-xs font-bold text-island-navy-soft">
                解鎖需求: {level * 100} XP
              </span>
            </span>
          </button>

          <button
            onClick={onShrink}
            className="group flex items-center gap-5 rounded-[1.5rem] border border-island-coral/25 bg-island-coral/10 p-5 text-left transition-all hover:-translate-y-0.5 hover:bg-island-coral/18 active:scale-[0.98]"
          >
            <IconTile size={64} active accent="coral" className="text-island-coral transition-transform group-hover:scale-110">
              <Minimize2 size={30} />
            </IconTile>
            <span className="min-w-0">
              <span className="block text-lg font-black text-island-coral">縮減島嶼領土</span>
              <span className="mt-1 block text-xs font-bold text-island-navy-soft">
                暫時不需要這麼大時使用，之後隨時能擴張回來
              </span>
            </span>
          </button>
        </div>
      </ModalShell>
    </ModalOverlay>
  );
}
