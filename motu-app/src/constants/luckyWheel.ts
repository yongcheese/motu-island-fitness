/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 幸運輪盤 — the ten things the wheel can land on, as data.
 *
 * §6 of docs/economy.md was a placeholder for a long time (「輪盤目前不存在」), and the placeholder
 * said exactly what building it would have to respect: `RewardSource` already has `'wheel'`, and
 * `SOURCE_CURRENCY_POLICY` already refuses it 金幣. Nothing here mints a coin, and nothing here
 * names an item id — the two outfit slots are POOLS (rules about rarity and category), so a new
 * 稀有 shirt is on the wheel the moment it is in the catalog.
 *
 * ## Ten wedges, and every one of them shows its prize
 *
 * The whole appeal of a wheel over a button is that the player can see the ladder BEFORE spending
 * anything: the 史詩 wedge has to be visible while it is not being won. So this list is the source
 * both for the drawing (components/UI/LuckyWheel.tsx renders one wedge per entry, in this order)
 * and for the draw (context/useWheelActions.ts). One list, so a wedge can never show one prize and
 * pay another.
 *
 * ## Geometry is not odds
 *
 * All ten wedges are the same 36°, because a wheel with a hair-thin 史詩 sliver tells the player it
 * is rigged before they touch it. The odds live in {@link WheelSlot.weight} instead, and the two
 * are deliberately separate numbers: 史詩 occupies a tenth of the FACE and 1% of the OUTCOMES.
 * That is not a trick — {@link wheelSlotChance} is exported precisely so the UI can print the real
 * figure on the wedge's own tooltip rather than let the geometry imply a wrong one.
 *
 * ## The arrangement
 *
 * 碎片 sits on every even index, so the five ordinary outcomes are spread around the face and the
 * five special ones are never adjacent to each other. A wheel with its two 稀有 wedges side by side
 * reads as having one fat 稀有 wedge, which is the same legibility failure as sizing by odds.
 */

import type { Rarity } from './rarity';
import type { RewardPool } from './rewardPools';
import type { UtilityCardId } from './utilityCards';

/** How many 抽獎券 one spin costs. The wheel's only sink, and the ticket's only one. */
export const WHEEL_SPIN_COST = 1;

/**
 * 免費轉盤次數 in hand — turns that cost no 抽獎券 at all.
 *
 * 第 7 天 of the 每日登入 round pays one of these (constants/dailyLogin.ts). Read here rather than
 * inline at the two call sites for the reason every other balance getter in this game exists: a
 * missing field, a `NaN` left by a bad write and a negative all have to read as zero, and three
 * copies of that guard is three chances for one of them to let a negative through and hand the
 * player an unspendable wheel.
 */
export function getFreeSpins(profile: { freeWheelSpins?: number } | null | undefined): number {
  const held = profile?.freeWheelSpins;
  return typeof held === 'number' && Number.isFinite(held) ? Math.max(0, Math.floor(held)) : 0;
}

/**
 * What a wedge pays.
 *
 *  - `fragments`     — 商品碎片 for one item, rolled toward what the player is already collecting
 *                      (context/useWheelActions.ts). The everyday outcome.
 *  - `raffle-ticket` — the spin back, and then some. Keeps a session going.
 *  - `outfit`        — a wearable at a fixed tier, drawn from {@link WheelSlot.pool}.
 *  - `function-card` — 功能卡 from constants/utilityCards.ts, granted through its own cap.
 */
export type WheelPrizeKind = 'fragments' | 'raffle-ticket' | 'outfit' | 'function-card';

/**
 * 功能卡那一格 —— 發真的卡。
 *
 * 這一格在 2026-08-31 還是個佔位：repo 裡沒有功能卡系統，所以抽到只能退券。之後 雙倍金幣券
 * （constants/utilityCards.ts）上線了，而且它自己的 `channels` 早就寫著 `'wheel'` —— 卡片說它可以
 * 從轉盤拿到，轉盤卻還在發「系統尚未開放」的道歉。這一格因此改成照 `cardId` 發一張真的卡，走的是
 * 限時小攤發卡用的同一個 `grantCards`，上限也是同一個。
 *
 * 退券只剩一種情況：卡已經帶滿 `maxOwned`，`grantCards` 一張都放不進去。那時照舊作廢這一轉，
 * 而不是讓玩家看著一張卡落地、背包裡卻什麼都沒多。
 */
export const FUNCTION_CARD_FULL_NOTE = '功能卡已經帶滿了，這一次的抽獎券退還給你。';

/** How many 抽獎券 a 功能卡 landing hands back when the bag is full. Exactly the spin's cost. */
export const FUNCTION_CARD_REFUND = WHEEL_SPIN_COST;

export interface WheelSlot {
  /** Stable id — the React key, and what a grant's `reason` line names. */
  id: string;
  kind: WheelPrizeKind;
  /** The prize's name, on the wedge. */
  label: string;
  /** The quantity or qualifier under the name — `×20`, `隨機`, `敬請期待`. */
  detail: string;
  /**
   * Relative odds. NOT a percentage, and NOT tied to the wedge's size — see the file doc.
   * {@link wheelSlotChance} turns these into the figure a player is shown.
   */
  weight: number;
  /** `fragments` / `raffle-ticket` / `function-card`: how many. */
  amount?: number;
  /** `function-card`: which card the wedge pays. */
  cardId?: UtilityCardId;
  /** `outfit`: the tier the wedge promises, for its colour and its reveal. */
  rarity?: Rarity;
  /** `outfit`: where the item is actually drawn from. */
  pool?: RewardPool;
}

/**
 * The categories a 造型 prize may come from.
 *
 * The six wearable shelves the reward system already names (constants/rewardPools.ts's newbie pool)
 * plus 特殊飾品 (`SpecialFx`), which is where most of the catalog's 稀有 and 史詩 cosmetics actually
 * live — the wings, the halo, the rain cloud. Leaving it out would have left the 史詩 wedge drawing
 * from a pool of one.
 *
 * 髮型 and 帽子 are in the list and contribute nothing today, because every hat and every hairstyle
 * in the catalog is currently 普通. That is the pool doing its job rather than a bug: the day a
 * 稀有 hat ships it is on the wheel with no edit here.
 */
const OUTFIT_CATEGORIES = ['Tops', 'Bottoms', 'Hats', 'Shoes', 'Accessories', 'Hair', 'SpecialFx'] as const;

/**
 * A 造型 pool pinned to exactly one tier.
 *
 * Floor and ceiling are the same rung on purpose: the wedge says 稀有造型, so it must not be able to
 * pay 普通 (a promise broken downward) or 史詩 (a promise broken upward, which quietly makes the
 * 史詩 wedge worth less). `preferUnowned` because a duplicate wearable is a no-op in the inventory
 * (utils/inventory.ts), and a prize that lands as nothing is worse than a plain one.
 *
 * No price bounds beyond 「有在賣」: the wheel grades by rarity, and price is a separate property of
 * an item (constants/rarity.ts). A price ceiling here would quietly re-introduce 「貴的就是稀有的」,
 * which the catalog is deliberately laid out to disprove.
 */
function outfitPool(rarity: Rarity, label: string): RewardPool {
  return {
    id: `wheel-outfit-${rarity}`,
    label,
    categories: [...OUTFIT_CATEGORIES],
    maxPrice: Number.MAX_SAFE_INTEGER,
    minPrice: 1,
    maxRarity: rarity,
    minRarity: rarity,
    allowXpUnlock: false,
    preferUnowned: true,
  };
}

export const WHEEL_RARE_OUTFIT_POOL = outfitPool('rare', '輪盤：稀有造型');
export const WHEEL_EPIC_OUTFIT_POOL = outfitPool('epic', '輪盤：史詩造型');

/**
 * What a 造型 wedge pays when the player already owns everything at that tier.
 *
 * `preferUnowned` keeps the draw on fresh items while there are any, so this only fires for a
 * collection that is complete at that rung — and then the drawn item is a second copy of a
 * wearable, which the inventory discards (own-once, utils/inventory.ts). Paying nothing there would
 * mean watching a 史詩 land and receiving nothing, which is the worst outcome the wheel can
 * produce and the one a player is most likely to read as a bug.
 *
 * Priced in spins rather than in a new resource: a 稀有 wedge is worth roughly a couple of goes and
 * a 史詩 rather more, so the consolation is legible without inventing anything. It is deliberately
 * NOT paid in 碎片 — a fragment belongs to one item, and the item this wedge drew is the one item
 * its fragments could never be spent on.
 */
export const DUPLICATE_OUTFIT_TICKETS: Partial<Record<Rarity, number>> = {
  rare: 2,
  epic: 5,
};

/**
 * The face, clockwise from twelve o'clock. Index 0 is what the pointer rests on.
 *
 * Five 碎片 wedges on the even indices, and the five one-off prizes between them. The fragment
 * amounts are a readable ladder against the two sources that already exist — a workout pays 3–40
 * (constants/fragments.ts) and a login day 10–40 — so a 10 is an ordinary result, a 50 beats any
 * single day of anything else, and the wheel still does not become the fast lane to an unlock.
 *
 * 史詩 is 2%, not 1% (2026-09-13). The epic pool holds only 7 pieces and never repeats while any
 * are unowned, so at 1% finishing it averaged ~700 spins against ~67 for 稀有's 8 at 12% — a
 * tenfold gap that made the purple wedge decoration. 2% halves that and still keeps it the rarest
 * outcome by a clear margin; the extra point comes out of the everyday ×10.
 */
export const WHEEL_SLOTS: readonly WheelSlot[] = [
  { id: 'frag-10', kind: 'fragments', label: '碎片', detail: '×10', amount: 10, weight: 255 },
  {
    id: 'outfit-rare-a',
    kind: 'outfit',
    label: '稀有造型',
    detail: '隨機',
    rarity: 'rare',
    pool: WHEEL_RARE_OUTFIT_POOL,
    weight: 60,
  },
  { id: 'frag-20', kind: 'fragments', label: '碎片', detail: '×20', amount: 20, weight: 155 },
  {
    id: 'function-card',
    kind: 'function-card',
    label: '功能卡',
    detail: '×1',
    cardId: 'double-coin',
    amount: 1,
    weight: 30,
  },
  { id: 'frag-15', kind: 'fragments', label: '碎片', detail: '×15', amount: 15, weight: 195 },
  {
    id: 'outfit-epic',
    kind: 'outfit',
    label: '史詩造型',
    detail: '隨機',
    rarity: 'epic',
    pool: WHEEL_EPIC_OUTFIT_POOL,
    weight: 20,
  },
  { id: 'frag-30', kind: 'fragments', label: '碎片', detail: '×30', amount: 30, weight: 95 },
  { id: 'ticket', kind: 'raffle-ticket', label: '抽獎券', detail: '×1', amount: 1, weight: 85 },
  { id: 'frag-50', kind: 'fragments', label: '碎片', detail: '×50', amount: 50, weight: 45 },
  {
    id: 'outfit-rare-b',
    kind: 'outfit',
    label: '稀有造型',
    detail: '隨機',
    rarity: 'rare',
    pool: WHEEL_RARE_OUTFIT_POOL,
    weight: 60,
  },
];

/** How many wedges the face has. Read by the renderer rather than hardcoded as 10. */
export const WHEEL_SLOT_COUNT = WHEEL_SLOTS.length;

/** Degrees per wedge. Every wedge is the same size — the odds are {@link WheelSlot.weight}. */
export const WHEEL_SLOT_ANGLE = 360 / WHEEL_SLOT_COUNT;

// --- 轉一次要花多久，以及它怎麼慢下來 ---------------------------------------------------------

/**
 * 一次旋轉的動畫參數。
 *
 * 這三個數字原本寫在 UI/LuckyWheel.tsx 的 `transition` 裡，搬到這裡是因為**聲音也要讀它們**：
 * 轉盤的咔咔聲是「指針掃過一根釘子」一聲，而釘子什麼時候經過，完全由「轉多久、轉幾圈、用哪條
 * 減速曲線」決定。留在元件裡的話，哪天有人把 3.6 秒改成 5 秒，畫面會照做、聲音不會 —— 而那個
 * bug 的樣子是「輪盤已經停了，還在咔咔響」，看程式碼是看不出來的。
 *
 * `ease` 是 cubic-bezier 的四個控制點，跟 CSS / motion 用的是同一組數字。
 */
export const WHEEL_SPIN = {
  /** 一次旋轉的長度，毫秒。 */
  durationMs: 3600,
  /** 停到結果之前先轉滿幾整圈。轉盤永遠往同一個方向轉，所以這是「至少」而不是「剛好」。 */
  turns: 5,
  /** 減速曲線。前段幾乎是等速的衝刺，最後一秒才真的慢下來 —— 那一秒就是懸念。 */
  ease: [0.15, 0.72, 0.1, 1],
} as const;

/**
 * cubic-bezier(x1, y1, x2, y2) 求值：給「花掉的時間比例」，回傳「轉完的角度比例」。
 *
 * 就是瀏覽器對 CSS timing function 做的那件事：曲線是用參數 t 定義的，而我們手上有的是 x（時間），
 * 所以要先用牛頓法把 t 解出來，再把它代進 y。八次迭代是瀏覽器自己也用的次數；這條曲線在
 * [0,1] 上是嚴格遞增的，所以它一定收斂。
 *
 * 導數為 0 的那一步直接跳出：那只會發生在曲線的端點上，而端點的答案本來就是 0 或 1。
 */
function easeAt(x: number): number {
  const [x1, y1, x2, y2] = WHEEL_SPIN.ease;
  const a = (p1: number, p2: number) => 1 - 3 * p2 + 3 * p1;
  const b = (p1: number, p2: number) => 3 * p2 - 6 * p1;
  const c = (p1: number) => 3 * p1;
  const curve = (t: number, p1: number, p2: number) => ((a(p1, p2) * t + b(p1, p2)) * t + c(p1)) * t;
  const slope = (t: number, p1: number, p2: number) => 3 * a(p1, p2) * t * t + 2 * b(p1, p2) * t + c(p1);

  let t = Math.min(1, Math.max(0, x));
  for (let i = 0; i < 8; i++) {
    const s = slope(t, x1, x2);
    if (s === 0) break;
    t -= (curve(t, x1, x2) - x) / s;
  }
  return curve(t, y1, y2);
}

/**
 * 指針掃過每一根釘子的時刻，毫秒。轉盤的咔咔聲就是照這張表排的（lib/soundUtils.ts 的
 * playWheelSpin）。
 *
 * 為什麼是「算出來的一張時刻表」而不是「用固定間隔遞減的節拍」：轉盤的減速曲線是一條
 * cubic-bezier，不是等減速；照著猜的節拍在前兩秒還跟得上，最後一秒會提早收完，聽起來就是聲音
 * 和畫面各轉各的。這裡直接沿著同一條曲線走一遍，記下角度每跨過一格的瞬間 —— 聲音因此不可能
 * 比畫面早停，也不可能晚停。
 *
 * 走的是固定的時間切片再線性內插，而不是把曲線反解：最快的那一段大約 26 毫秒過一格，用 600
 * 個切片（6 毫秒一格）每一格都還有四個以上的取樣點，而內插把誤差壓到聽不出來的程度（<1ms）。
 * 反解一條 bezier 要處理它自己的收斂問題，換來的精度在這裡沒有人聽得出來。
 *
 * @param totalDegrees 這一轉總共要轉多少度（含那 {@link WHEEL_SPIN.turns} 整圈）。
 */
export function wheelPegTimes(totalDegrees: number): number[] {
  const times: number[] = [];
  if (!(totalDegrees > 0)) return times;

  const STEPS = 600;
  let prevTurned = 0;
  /** 下一根釘子在「轉過這麼多度」時經過指針。 */
  let nextPeg = WHEEL_SLOT_ANGLE;

  for (let i = 1; i <= STEPS; i++) {
    const t1 = i / STEPS;
    const turned = easeAt(t1) * totalDegrees;
    while (nextPeg <= turned && nextPeg <= totalDegrees) {
      // 這一格之內的線性內插。分母不可能是 0：迴圈進得來就代表這一步真的有轉動。
      const frac = (nextPeg - prevTurned) / (turned - prevTurned);
      times.push(((i - 1 + frac) / STEPS) * WHEEL_SPIN.durationMs);
      nextPeg += WHEEL_SLOT_ANGLE;
    }
    prevTurned = turned;
  }
  return times;
}

const TOTAL_WEIGHT = WHEEL_SLOTS.reduce((sum, slot) => sum + slot.weight, 0);

/** One wedge's real chance, 0–1. Exported so the UI can state the odds instead of implying them. */
export function wheelSlotChance(slot: WheelSlot): number {
  return slot.weight / TOTAL_WEIGHT;
}

/**
 * 一種獎品在整個轉盤上的樣子 —— 它佔幾格、加起來的機率是多少。
 *
 * 為什麼不是「十格各報一個百分比」：稀有造型佔了**兩格**（見 {@link WHEEL_SLOTS} 的排列理由），
 * 而玩家問的從來不是「第 2 格的機率」，是「我抽到稀有造型的機率」。逐格列表會把那個答案切成兩個
 * 6%，讓唯一重要的那個數字變成要玩家自己心算加出來的東西 —— 而 6% 和 12% 決定的是「要不要存券」
 * 這種真的會改變行為的判斷。
 */
export interface WheelPrizeRow {
  /** 代表這種獎品的那一格。名稱、細節、顏色、圖示全部照它走，所以表和面永遠是同一個東西。 */
  slot: WheelSlot;
  /** 面上有幾格發這種獎品。 */
  wedges: number;
  /** 落在其中任何一格的合計機率，0–1。 */
  chance: number;
}

/**
 * 同一種獎品的兩格要合併，靠的是「這兩格發的東西一不一樣」而不是 id。
 *
 * 碎片照數量分（×10 和 ×50 是兩種獎品），造型照階級分（稀有和史詩是兩種獎品），券照張數分。
 * 功能卡只有一格，key 是什麼都無所謂 —— 但仍然照同一條規則生出來，這樣哪天它變成真的功能卡、
 * 而且面上出現第二格，合併是自動發生的，不必有人記得回來改這裡。
 */
function prizeKey(slot: WheelSlot): string {
  return `${slot.kind}:${slot.rarity ?? ''}:${slot.amount ?? ''}`;
}

/**
 * 整張獎品表，機率由高到低。
 *
 * 排序用機率而不是用面上的順序：這是一張**賠率表**，而賠率表的閱讀方式就是「最常發生的在最上面、
 * 最想要的在最下面」。面上的順序有它自己的任務（把五種普通結果散開，見 {@link WHEEL_SLOTS}），
 * 那個任務跟「這張表好不好讀」沒有關係，硬要兩邊同一個順序只會讓兩邊都做不好自己的事。
 */
export function wheelPrizeTable(): WheelPrizeRow[] {
  const rows = new Map<string, WheelPrizeRow>();
  for (const slot of WHEEL_SLOTS) {
    const key = prizeKey(slot);
    const row = rows.get(key);
    if (row) {
      row.wedges += 1;
      row.chance += wheelSlotChance(slot);
    } else {
      rows.set(key, { slot, wedges: 1, chance: wheelSlotChance(slot) });
    }
  }
  return [...rows.values()].sort((a, b) => b.chance - a.chance);
}

/**
 * Draws a wedge.
 *
 * `random` is injected rather than reaching for the global, so a test — or an admin preview that
 * wants to force the 史詩 wedge — can pin the outcome without stubbing `Math.random`.
 */
export function pickWheelSlot(random: () => number = Math.random): WheelSlot {
  let roll = random() * TOTAL_WEIGHT;
  for (const slot of WHEEL_SLOTS) {
    roll -= slot.weight;
    if (roll < 0) return slot;
  }
  // Unreachable for any `random` in [0,1); the last wedge is the honest answer for a generator
  // that returns exactly 1, rather than a crash on the player's screen.
  return WHEEL_SLOTS[WHEEL_SLOT_COUNT - 1];
}

/** Where a wedge sits on the face, 0-based. Both the rotation and the spin's landing need it. */
export function wheelSlotIndex(slotId: string): number {
  return WHEEL_SLOTS.findIndex((slot) => slot.id === slotId);
}
