/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 旅行商人 — rules tests.
 *
 * Run with `npm run test:merchant`. Same tsx-script style as `test:limited-shop`, and a deliberate
 * sibling of it: that one pins WHAT is on the shelf, this one pins WHO brings it and WHEN.
 *
 * Everything here is a property the brief states as a requirement and that is cheap to break
 * months later — most of them by editing a single number in `constants/merchantDocks.ts` or
 * `constants/merchants.ts` and never seeing anything go wrong on screen:
 *
 *  §5/§17   the boat's mooring point is derived from the island's own shoreline, so it is on
 *           WATER at every territory level — not a Vector3 that happens to be wet today
 *  §6/§16   the player can reach the merchant from dry sand: the interaction radius covers the
 *           gap between the waterline and where he stands
 *  §7/§15   merchant presence and shop rotation are ONE clock — the merchant is never selling a
 *           period the shop is not showing, and the shop can never be open while he is away
 *  §8/§9    there is a real arrival and a real departure in the schedule, and a gap between a
 *           merchant leaving and the next one arriving (otherwise 「下一位在路上」 never exists)
 *  §14/§18  every merchant resolves to a dock and to a shop, so adding one cannot half-land
 *
 * What it deliberately does NOT test: the boat's sail-in animation and the React layer. Those are
 * seconds-scale presentation driven by useFrame; what is testable without a DOM is every rule
 * that decides whether the shop may open at all — the half that silently rots.
 */

import {
  MERCHANTS,
  MERCHANT_SHOPS,
  getMerchant,
  getMerchantDockFor,
  getMerchantShop,
  merchantsWithoutDock,
} from '../src/constants/merchants';
import {
  MERCHANT_DOCKS,
  dockClearanceFromShore,
  dockReach,
  resolveDock,
} from '../src/constants/merchantDocks';
import {
  merchantAlwaysDocked,
  merchantVisitAt,
  merchantVisitsAt,
  openMerchantVisitAt,
  setMerchantAlwaysDocked,
  visitIdFor,
  visitMatchesShopPeriod,
} from '../src/constants/merchantVisit';
import {
  OTTER_BODY,
  OTTER_RIG,
  otterBodyRadiusAt,
  otterCollar,
  otterHatBand,
  otterHeadRadiusAt,
  otterLegCapsule,
  otterNeckline,
  otterOnHead,
  otterOnMuzzle,
  otterPelvisBottom,
  otterPelvisTop,
  otterSatchel,
  otterSilhouetteRadiusAt,
} from '../src/constants/npcs';
import {
  MERCHANT_BREATH,
  MERCHANT_GREETING,
  MERCHANT_PURCHASE,
  MERCHANT_SENSES,
  type MerchantAnimationState,
} from '../src/constants/merchantAnimation';
import { MerchantAnimator } from '../src/lib/merchantAnimation';
import { BOAT_COLLIDERS, MERCHANT_STAND } from '../src/components/Three/MerchantBoat';
import { resolvePlayerAgainstSolids } from '../src/lib/furniturePlacement';
import { clearWorldSolids, getWorldSolids, publishWorldSolids } from '../src/lib/worldSolids';
import { PLAYER_PHYSICAL_RADIUS } from '../src/utils/placementRules';
import { SWIM_BODY_REACH, SWIM_HYSTERESIS } from '../src/components/Three/characterMovement';
import { GRASS_RADIUS, SHORELINE_RADIUS, SWIMMABLE_RADIUS } from '../src/constants/terrain';
import { WATER_SURFACE_Y } from '../src/constants/world';
import { LIMITED_SHOP_CONFIG } from '../src/constants/limitedShop';
import { currentRotation, periodForInstant } from '../src/constants/limitedShopRotation';

let failures = 0;
let checks = 0;

function eq(name: string, got: unknown, want: unknown): void {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures++;
    console.log(`FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

function ok(name: string, condition: boolean, detail = ''): void {
  checks++;
  if (!condition) {
    failures++;
    console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
  } else {
    console.log(`ok    ${name}${detail ? `  (${detail})` : ''}`);
  }
}

/** 領土等級 1..11 對應的島嶼縮放。跟島上每一個元件用的是同一條式子。 */
const SCALES = Array.from({ length: 11 }, (_, i) => 1 + i * 0.4);

console.log('\n== 旅行商人 ==========================================================');

// --- 資料完整性 (§14/§18) ----------------------------------------------------
console.log('\n-- 每一位商人都連得上他的停靠點與他的店 (§14/§18) -----------------------');

ok('there is at least one merchant', MERCHANTS.length > 0);
eq('every merchant resolves to a dock', merchantsWithoutDock().map((m) => m.id), []);
ok(
  'every merchant resolves to a shop provider',
  MERCHANTS.every((m) => !!getMerchantShop(m)),
  MERCHANTS.filter((m) => !getMerchantShop(m)).map((m) => m.id).join('/'),
);
ok(
  'every merchant id is unique',
  new Set(MERCHANTS.map((m) => m.id)).size === MERCHANTS.length,
);
ok(
  'every dock id is unique',
  new Set(MERCHANT_DOCKS.map((d) => d.id)).size === MERCHANT_DOCKS.length,
);
// 「商人 → 連著的店 → 那家店的畫面」。這條鏈斷掉的話，走到商人面前按 E 會什麼都不發生，
// 而那是一個沒有任何錯誤訊息的失敗。
ok(
  'every merchant opens a real view',
  MERCHANTS.every((m) => !!MERCHANT_SHOPS[m.shop]?.view),
);

// --- 停靠點在水上 (§5/§17) ---------------------------------------------------
console.log('\n-- 船停在水上，而且每一個領土等級都是 (§5/§17) --------------------------');

for (const dock of MERCHANT_DOCKS) {
  // 這是整份測試最重要的一條。停靠點如果寫成一組座標，它今天是對的、升到三級領土就會變成
  // 一艘停在沙灘上的船——而且沒有任何東西會壞給你看。因為它是從水線推導的，這裡對每一個等級
  // 各驗一次，成本是十一次乘法。
  ok(
    `dock ${dock.id}: moored outside the waterline at every territory level`,
    SCALES.every((scale) => dockClearanceFromShore(dock, scale) > 0),
    `clearances ${SCALES.map((s) => dockClearanceFromShore(dock, s).toFixed(2)).join(', ')}`,
  );
  // 離岸距離跟島無關：它是「水線往外幾單位」，所以每一級都一樣。這一條驗的是那個性質本身，
  // 因為它才是「船永遠停得一樣近」的原因。
  ok(
    `dock ${dock.id}: the gap to the shore does not drift with island size`,
    SCALES.every((scale) => Math.abs(dockClearanceFromShore(dock, scale) - dock.offshore) < 1e-9),
  );
  ok(
    `dock ${dock.id}: floats on the sea surface`,
    SCALES.every((scale) => resolveDock(dock, scale).moored.y === WATER_SURFACE_Y),
  );
  // 進場點必須在玩家游得到的範圍外，否則「船從遠處滑進來」會變成「船在玩家旁邊出現」。
  ok(
    `dock ${dock.id}: the approach point is beyond where the player can swim`,
    SCALES.every((scale) => {
      const { approach } = resolveDock(dock, scale);
      return Math.hypot(approach.x, approach.z) > SWIMMABLE_RADIUS * scale;
    }),
  );
  // 進場點與停靠點在同一條方位線上——航線是一段直線，所以船不會斜著穿過島。
  ok(
    `dock ${dock.id}: the approach runs straight in along one bearing`,
    SCALES.every((scale) => {
      const { moored, approach } = resolveDock(dock, scale);
      return Math.abs(Math.atan2(moored.x, moored.z) - Math.atan2(approach.x, approach.z)) < 1e-9;
    }),
  );
}

// --- 玩家搆得到 (§6/§16) -----------------------------------------------------
console.log('\n-- 站在乾沙灘上就談得到 (§6/§16) ----------------------------------------');

for (const dock of MERCHANT_DOCKS) {
  const reach = dockReach(dock);
  // 互動半徑是**推出來的**，不是一格可以單獨調的資料。這一條驗的就是那件事：船挪動時互動
  // 半徑一定跟著挪，所以兩者中間那塊「玩家站得到的地」不可能在沒有人注意的時候被擠掉。
  eq(`dock ${dock.id}: the reach is derived from the mooring, not authored beside it`,
    reach, dock.offshore + dock.landing);

  // ★ 這一條是這個功能被回報的那個 bug 的規格。
  //
  // 前一版是 offshore 2.6 配 reach 3.4，兩格各自調的資料 —— 於是玩家真正站得到的那塊地是
  // 一個沒有人寫下來的差值，只有 0.80。實測（領土一級）：提示要走到 r=5.79 之外才亮，而水
  // 線在 6.8、乾沙灘只有 5.7→6.8 這 1.1 寬，所以能談生意的地方是沙灘最外面那一公尺。玩家
  // 朝著船多走兩步就過了 7.15 開始游泳，體感就是「非得下海才買得到東西」。
  //
  // 下限因此是「整片乾沙灘 + 玩家自己的半徑」：一踏上沙子提示就亮著，而且站的是整個身體、
  // 不是一個點。
  const dryBeach = SHORELINE_RADIUS - GRASS_RADIUS;
  ok(
    `dock ${dock.id}: the landing covers the whole dry beach, plus the player's own radius`,
    dock.landing >= dryBeach + PLAYER_PHYSICAL_RADIUS,
    `landing ${dock.landing} >= beach ${dryBeach.toFixed(2)} + radius ${PLAYER_PHYSICAL_RADIUS} = ${(dryBeach + PLAYER_PHYSICAL_RADIUS).toFixed(2)}`,
  );
  // 而且在**每一個**領土等級上，那塊地的內緣都還在乾沙灘上（沙灘只會隨島變寬，不會變窄）。
  // 保守地從船心量 —— 商人站得比船心更靠岸，所以真正的內緣還更進來一點。
  ok(
    `dock ${dock.id}: and its inner edge is dry land at every territory level`,
    SCALES.every((scale) => {
      const { moored } = resolveDock(dock, scale);
      const innermost = Math.hypot(moored.x, moored.z) - reach;
      return innermost < SHORELINE_RADIUS * scale - PLAYER_PHYSICAL_RADIUS;
    }),
  );
  // 反過來也要成立：一個大到從島中央就談得到的半徑，等於把商人變回一顆隨時可按的按鈕。
  ok(
    `dock ${dock.id}: but not so large that the whole island is in range`,
    SCALES.every((scale) => {
      const { moored } = resolveDock(dock, scale);
      return Math.hypot(moored.x, moored.z) - reach > SHORELINE_RADIUS * scale * 0.5;
    }),
  );

  // ★ 水線與船身之間必須放得下一個**躺平的**游泳者。
  //
  // 這一條是「玩家的模型陷進船裡」那個修法逼出來的第二個條件。游泳的身體從腳往前躺
  // SWIM_BODY_REACH，而碰撞推的是腳，所以腳得停在船身外 `body + 半徑`。間隙比那還窄的話，
  // 朝船游過去的玩家會被推回沙灘 → 上岸就不算游泳 → 身體站起來 → 保留距離消失 → 又能往前
  // 游，在水線上來回彈。
  //
  // **SWIM_HYSTERESIS 不加進來**，而且那不是疏漏：`isInWaterZone` 是不對稱的，已經在水裡的
  // 人退到 `sandRadius` 以內才算上岸（乾的人才需要走過 `sandRadius + margin`）。被推回去的
  // 是已經在游泳的人，所以擋著他的是水線那條線。把 margin 也加進來會把船推得比需要的遠 0.35
  // —— 這正是這條測試第一版犯的錯。
  const hullHalfW = Math.max(...BOAT_COLLIDERS.filter((c) => c.id.startsWith('hull')).map((c) => c.halfW));
  const swimmerNeeds = hullHalfW + SWIM_BODY_REACH + PLAYER_PHYSICAL_RADIUS;
  ok(
    `dock ${dock.id}: a swimmer lying flat fits between the waterline and the hull`,
    dock.offshore > swimmerNeeds,
    `offshore ${dock.offshore} > hull ${hullHalfW} + body ${SWIM_BODY_REACH} + radius ${PLAYER_PHYSICAL_RADIUS} = ${swimmerNeeds.toFixed(2)}`,
  );
  // 而那個被推回去的位置必須仍然算「在水裡」，否則上一條擋下的來回彈會從另一個方向回來。
  const swimmerStops = SHORELINE_RADIUS + dock.offshore - swimmerNeeds;
  ok(
    `dock ${dock.id}: and where he is stopped still counts as being in the water`,
    swimmerStops > SHORELINE_RADIUS,
    `stopped at r=${swimmerStops.toFixed(2)}, waterline r=${SHORELINE_RADIUS} (dry→wet line is ${(SHORELINE_RADIUS + SWIM_HYSTERESIS).toFixed(2)}, which is NOT the one that applies here)`,
  );
  // ★ 而船已經停在那條下限上了 —— 這一條把「還能再往島邊挪多少」量出來，寫成數字。
  //
  // 存在的理由是「船離島太遠」這個回報下一次還會出現，而那時該看的是 landing 不是 offshore。
  // 這一格印出來的餘裕（實測與這裡算的一致：領土一級時玩家朝船游過去停在 r≈7.2，水線外
  // 0.4）就是「把船開近一點」全部的空間 —— 螢幕上看不出來，卻是那條不等式僅剩的緩衝。
  ok(
    `dock ${dock.id}: the mooring is at its floor — moving it closer is not the lever`,
    dock.offshore - swimmerNeeds < 0.5,
    `only ${(dock.offshore - swimmerNeeds).toFixed(2)} of room left before the swimmer bounces; the lever is landing (${dock.landing})`,
  );
}

// --- 一個時鐘 (§7/§15) -------------------------------------------------------
console.log('\n-- 商人與貨架讀同一個時鐘 (§7/§15) --------------------------------------');

const spec = MERCHANTS[0];
const shop = getMerchantShop(spec);
const periodMs = shop.periodLengthMs();
const epochMs = Date.parse(LIMITED_SHOP_CONFIG.epoch);

eq('the merchant schedules against the shop period length', periodMs, Date.parse(
  new Date(Date.parse(periodForInstant(epochMs).endsAt)).toISOString(),
) - epochMs);

// 掃過三檔、每檔取樣 400 個點。這是「商人在的時候，他帶來的一定是畫面上那一檔」唯一一種
// 真正驗得動的方式——它在結構上不可能失敗（兩邊都是同一個 currentPeriod 推出來的），而這
// 條測試存在的意義正是把那個「不可能」寫下來，讓有人哪天想給商人一套自己的排程時會撞到它。
{
  const samples = 400;
  let mismatched = 0;
  let openSamples = 0;
  let closedSamples = 0;
  for (let period = 0; period < 3; period++) {
    for (let i = 0; i < samples; i++) {
      const now = epochMs + period * periodMs + Math.floor((i / samples) * periodMs);
      const visit = merchantVisitAt(now, spec);
      if (!visitMatchesShopPeriod(now, visit)) mismatched++;
      if (visit.open) openSamples++; else closedSamples++;

      // 這一條是 §15 的核心：店開得了 ⇔ 商人在。兩者是同一個布林值，不是兩個要同步的旗標。
      const shelfPeriodId = currentRotation(now).id;
      if (visit.open && shelfPeriodId !== visit.periodId) mismatched++;
    }
  }
  eq('a visit never carries a different period than the shelf', mismatched, 0);
  // 停 3 天、走 4 天。驗的是取樣比而不是一個寫死的時間點，因為行程本來就是比例；
  // 兩個取樣點的誤差是 1/400 檔，所以 1% 的寬容已經是它的十倍。
  const openShare = openSamples / (openSamples + closedSamples);
  ok('he is docked three days in seven', Math.abs(openShare - 3 / 7) < 0.01,
    `${(openShare * 100).toFixed(1)}% open (${openSamples} vs ${closedSamples}) — expected ${((3 / 7) * 100).toFixed(1)}%`);
  // §9：一定要有「他走了、下一位還沒到」的那一段，否則玩家永遠看不到換檔這件事發生。
  // 現在那一段不再是「約 20 小時的收攝」而是規則的一半，所以它比停靠那一段還長。
  ok('but there is a real gap between visits', closedSamples > openSamples,
    `${closedSamples} samples with nobody on the island vs ${openSamples} with him here`);
}

// --- 以天為單位把規則寫下來 ---------------------------------------------
//
// 上面那一組驗的是比例，這一組驗的是它乘出來的**天數**——因為玩家收到的規則是「停三天、
// 走四天」，而一個正確的比例配上一個被改過的檔期長度依然能算出一個錢不對的天數。
{
  const DAY = 24 * 60 * 60 * 1000;
  const period = periodForInstant(Date.now());
  const startsAt = Date.parse(period.startsAt);
  const visit = merchantVisitAt(startsAt + 1000, spec);

  eq('a period is seven days', Math.round(periodMs / DAY), 7);
  eq('he docks as the period opens', Math.round((visit.arrivesAt - startsAt) / DAY), 0);
  eq('and casts off three days later', Math.round((visit.departsAt - visit.arrivesAt) / DAY), 3);
  eq('the island is then merchant-free for four days',
    Math.round((visit.nextArrivesAt - visit.departsAt) / DAY), 4);
  // 三加四是七：一趟航程就是一檔。這一條是「商人沒有自己的排程」的算術形式。
  eq('so one round trip is exactly one period',
    Math.round((visit.nextArrivesAt - visit.arrivesAt) / DAY), Math.round(periodMs / DAY));

  // 跋過一整周逐天問一次：前三天在、後四天不在。這是玩家真正會遇到的那個形狀。
  const week = Array.from({ length: 7 }, (_, day) =>
    merchantVisitAt(startsAt + day * DAY + DAY / 2, spec).open);
  eq('three days on, four days off', week, [true, true, true, false, false, false, false]);
}

// --- 相位 (§8/§9) ------------------------------------------------------------
console.log('\n-- 抵達、停留、離開，是三段而不是一個開關 (§8/§9) -----------------------');

{
  const period = periodForInstant(Date.now());
  const startsAt = Date.parse(period.startsAt);
  const endsAt = Date.parse(period.endsAt);

  const atStart = merchantVisitAt(startsAt + 1, spec);
  // 停靠那一段的中間，不是**檔期**的中間——一檔七天而他只停三天，所以第 3.5 天他已經走了。
  // 這一行本來寫著 `(startsAt + endsAt) / 2`，而那在行程是「幾乎整檔都在」的時候恰已碰巧是對的。
  const midway = merchantVisitAt((atStart.arrivesAt + atStart.departsAt) / 2, spec);
  const atEnd = merchantVisitAt(endsAt - 1, spec);

  eq('he is here as the period opens', atStart.phase, 'visiting');
  eq('he is here in the middle of his stay', midway.phase, 'visiting');
  eq('he has left before it closes', atEnd.phase, 'departed');
  eq('and the shop is shut with him', atEnd.open, false);

  ok('departure comes before the period ends', atStart.departsAt < endsAt);
  ok('arrival is not after departure', atStart.arrivesAt < atStart.departsAt);
  // 「下一位什麼時候到」必須是一個真的能講出來的時間，否則收攤畫面只能寫「之後」。
  ok('the next arrival is in the future once he has gone', atEnd.nextArrivesAt > endsAt - 1);
  ok(
    'and it lines up with the next period opening',
    Math.abs(atEnd.nextArrivesAt - (endsAt + (endsAt - startsAt) * spec.schedule.arrivesAfter)) < 1e-6,
  );
}

// 一趟造訪的 id 換檔就換掉——這是「他換人了」的唯一判準（UI/MerchantSession.tsx 用它決定要不
// 要把正在逛的玩家送回島上），也是抵達通知一檔只講一次的鍵。
{
  const period = periodForInstant(Date.now());
  const startsAt = Date.parse(period.startsAt);
  const endsAt = Date.parse(period.endsAt);
  const thisVisit = merchantVisitAt(startsAt + 1000, spec);
  const nextVisit = merchantVisitAt(endsAt + 1000, spec);
  eq('a visit id is merchant + period', thisVisit.visitId, visitIdFor(spec.id, period.id));
  ok('and it changes when the rotation does', thisVisit.visitId !== nextVisit.visitId,
    `${thisVisit.visitId} → ${nextVisit.visitId}`);
}

// --- 可重算 (§14 的「重新進入遊戲，商品保持一致」) ---------------------------
console.log('\n-- 同一個時間點永遠得到同一位商人 -------------------------------------');

{
  const now = Date.now();
  eq(
    'asking twice gives the same visit',
    merchantVisitsAt(now).map((v) => `${v.visitId}:${v.phase}:${v.open}`),
    merchantVisitsAt(now).map((v) => `${v.visitId}:${v.phase}:${v.open}`),
  );
  // 沒有 Math.random()、沒有存檔、沒有 spawn 事件：造訪是時間的純函數，所以重開遊戲、換裝置
  // 都會算出同一位商人帶著同一批貨。
  const replay = merchantVisitAt(now, spec);
  eq('and it matches a fresh lookup by id', getMerchant(spec.id)?.id, spec.id);
  eq('the open merchant is the one the world would draw', openMerchantVisitAt(now)?.merchantId ?? null,
    replay.open ? spec.id : null);
}

// --- 管理員：船一直停在岸邊 -------------------------------------------------
console.log('\n-- 管理員測試模式下商船不走 -------------------------------------------');

{
  const DAY = 24 * 60 * 60 * 1000;
  const period = periodForInstant(Date.now());
  const startsAt = Date.parse(period.startsAt);
  // 第 5 天 —— 正式規則下這是「他走了」那四天的中間。
  const whileAway = startsAt + 5 * DAY;

  eq('a normal player never has the override on', merchantAlwaysDocked(), false);
  eq('and on day five the island is empty', merchantVisitAt(whileAway, spec).open, false);

  setMerchantAlwaysDocked(true);
  try {
    eq('the console can say the rule is live', merchantAlwaysDocked(), true);

    const pinned = merchantVisitAt(whileAway, spec);
    eq('with it on he is on the island on day five too', pinned.open, true);
    eq('and the phase says so rather than merely the boolean', pinned.phase, 'visiting');
    // 釘住的是行程而不是時鐘：他帶的還是這一檔，而不是第 0 檔。這一條就是「換檔在這個
    // 模式下依然測得到」的規格；它壞掉的話，一位永遠在岶上、貨也永遠不換的商人會讓換檔變成測不到的東西。
    eq('he still carries this period, not a frozen one', pinned.periodId, period.id);
    ok('a visit never carries a different period than the shelf, override or not',
      visitMatchesShopPeriod(whileAway, pinned));
    eq('the visit id still turns over with the rotation',
      merchantVisitAt(Date.parse(period.endsAt) + 1000, spec).visitId !== pinned.visitId, true);

    // 排程被拿掉 = 整檔都在。掃一整周，一天都不能缺。
    const week = Array.from({ length: 7 }, (_, day) =>
      merchantVisitAt(startsAt + day * DAY + DAY / 2, spec).open);
    eq('seven days on, none off', week, [true, true, true, true, true, true, true]);
  } finally {
    setMerchantAlwaysDocked(false);
  }

  // 關掉就是真的關掉 —— 這正是 AdminMerchantDock 卸載時做的事。
  eq('turning it back off restores the real schedule', merchantVisitAt(whileAway, spec).open, false);
  eq('and the panel says so', merchantAlwaysDocked(), false);
}

// --- 模型組裝 ----------------------------------------------------------------
console.log('\n-- 水獺行商的下半身是一條連續的實體 -----------------------------------');

// 這一組是「雙腳與軀幹分離」那個 bug 的規格化。它壞掉的方式是同一個關節被三個獨立的字面值
// 各寫了一次而它們並不同意，所以這裡驗的不是「腿在某個高度」，而是**那條鏈上每一段都咬住
// 下一段**。任何一個數字被單獨調動，都會讓其中一條失敗。
{
  const pelvisBottom = otterPelvisBottom();
  const pelvisTop = otterPelvisTop();
  const leg = otterLegCapsule();
  // capsuleGeometry(radius, length) 的總高是 length + 2·radius，從中心量。
  const legTop = leg.centerY + leg.length / 2 + leg.radius;
  const legBottom = leg.centerY - leg.length / 2 - leg.radius;

  eq('the leg capsule reconstructs exactly the rig it was derived from', Number(legTop.toFixed(6)), OTTER_RIG.legTopY);
  eq('and its bottom is the ankle', Number(legBottom.toFixed(6)), OTTER_RIG.ankleY);
  ok('the capsule has a real cylindrical section', leg.length > 0, `length ${leg.length.toFixed(3)}`);

  // 腳底踩在 0。跟 audit:ground 對玩家的規則同一件事：模型的原點在地面上。
  ok('the sole sits on the ground plane', OTTER_RIG.soleY === 0);
  // 腳掌：球心 0.026、Y 半徑 0.052×0.5 = 0.026，所以鞋底正好落在 soleY。
  const footTop = 0.026 + 0.052 * 0.5;
  const footSole = 0.026 - 0.052 * 0.5;
  eq('the foot rests exactly on the ground plane', Number(footSole.toFixed(6)), OTTER_RIG.soleY);
  ok(
    'and the leg overlaps the foot rather than merely touching it',
    footTop - OTTER_RIG.ankleY > 0.01,
    `${(footTop - OTTER_RIG.ankleY).toFixed(3)} of overlap`,
  );

  // ★ 這一條就是那個 bug。腿頂必須高過衣襬下緣，否則兩者之間是空的。
  ok(
    'the legs reach UP PAST the tunic hem — this is the gap that broke',
    OTTER_RIG.legTopY > OTTER_RIG.hemBottomY,
    `legTop ${OTTER_RIG.legTopY} vs hem ${OTTER_RIG.hemBottomY} — ${(OTTER_RIG.legTopY - OTTER_RIG.hemBottomY).toFixed(3)} of overlap`,
  );
  // 骨盆跨過衣襬，所以「軀幹 → 骨盆 → 腿」中間沒有接縫。
  ok(
    'the pelvis bridges the hem',
    pelvisBottom < OTTER_RIG.hemBottomY && pelvisTop > OTTER_RIG.hemBottomY,
    `pelvis ${pelvisBottom.toFixed(3)}..${pelvisTop.toFixed(3)}, hem ${OTTER_RIG.hemBottomY}`,
  );
  // 關節必須埋在實體裡 —— 兩邊都要。一個懸在空氣裡的支點正是上一版的樣子。
  ok(
    'the hip joint is inside the pelvis',
    OTTER_RIG.hipY > pelvisBottom && OTTER_RIG.hipY < pelvisTop,
  );
  ok(
    'the hip joint is inside the leg capsule too',
    OTTER_RIG.hipY > legBottom && OTTER_RIG.hipY < legTop,
  );
  ok(
    'the legs are narrower than the pelvis they socket into',
    OTTER_RIG.hipX + OTTER_RIG.legRadius < OTTER_RIG.pelvisRadius,
    `${(OTTER_RIG.hipX + OTTER_RIG.legRadius).toFixed(3)} < ${OTTER_RIG.pelvisRadius}`,
  );

  // ★ §4：未來加動畫也不會再散開。腿頂那一小截繞著髖掃出去的距離，必須小於骨盆的半深。
  const stub = OTTER_RIG.legTopY - OTTER_RIG.hipY;
  const sweep = stub * Math.sin(OTTER_RIG.legSwing) + OTTER_RIG.legRadius;
  const pelvisHalfDepth = OTTER_RIG.pelvisRadius * OTTER_RIG.pelvisDepth;
  ok(
    'a full-swing stride keeps the leg top buried in the pelvis',
    sweep < pelvisHalfDepth,
    `sweep ${sweep.toFixed(3)} < pelvis half-depth ${pelvisHalfDepth.toFixed(3)}`,
  );
}

// --- 碰撞盒 ------------------------------------------------------------------
console.log('\n-- 船的碰撞盒貼著船身，而且擋不到互動 ---------------------------------');

{
  // 船的可見範圍（Three/MerchantBoat.tsx 的 Hull）：船首尖 z = 2.05、船尾板 z = -1.60、
  // 舷緣 |x| = 0.83。碰撞盒不得超出它——超出來的部分就是玩家看得到水卻游不過去的地方。
  const VISUAL = { maxZ: 2.05, minZ: -1.6, halfW: 0.83 };
  const over = BOAT_COLLIDERS.filter((c) =>
    c.cz + c.halfD > VISUAL.maxZ + 1e-6 ||
    c.cz - c.halfD < VISUAL.minZ - 1e-6 ||
    Math.abs(c.cx) + c.halfW > VISUAL.halfW + 1e-6);
  eq('no collider sticks out past the visible hull', over.map((c) => c.id), []);

  // 船頭那三格跟著真正的收窄走。每一格的半寬取自它自己中點上的真實船寬，所以誤差是對稱
  // 的，最大值就是「半個格子長度換算成的寬度」。
  const trueHalfBeam = (z: number) => Math.max(0, 0.8 * (2.05 - z) / 1.05);
  const bow = BOAT_COLLIDERS.filter((c) => c.id.startsWith('hull-bow'));
  eq('the bow is a staircase, not one box', bow.length, 3);
  ok(
    'each bow box matches the real hull width at its own centre',
    bow.every((c) => Math.abs(c.halfW - trueHalfBeam(c.cz)) < 0.01),
    bow.map((c) => `${c.id} ${c.halfW} vs ${trueHalfBeam(c.cz).toFixed(3)}`).join(', '),
  );
  ok(
    'and never deviates from the taper by more than the player can notice',
    bow.every((c) => trueHalfBeam(c.cz - c.halfD) - c.halfW < PLAYER_PHYSICAL_RADIUS),
    `worst ${Math.max(...bow.map((c) => trueHalfBeam(c.cz - c.halfD) - c.halfW)).toFixed(3)} < ${PLAYER_PHYSICAL_RADIUS}`,
  );

  // 甲板上的東西全部落在船殼圍出來的範圍裡。它們碰不到今天的玩家（船殼先擋下他），這一條
  // 驗的是它們至少沒有戳到船外面去。
  const hullBoxes = BOAT_COLLIDERS.filter((c) => c.id.startsWith('hull-'));
  const deckBoxes = BOAT_COLLIDERS.filter((c) => !c.id.startsWith('hull-'));
  ok('there are deck colliders as well as hull ones', deckBoxes.length > 0 && hullBoxes.length > 0);

  /**
   * 船殼在這個 z 上有多寬。
   *
   * 不能拿「甲板上的盒子有沒有整個裝進**某一格**船殼盒」來問：桅杆那一格橫跨 z = 1.0，也
   * 就是直身段與船頭第一段的接縫，所以它兩格都不完全屬於，但它明明就在船上。船殼那幾格沿
   * 著 z 是連續而且不重疊的，所以正確的問法是「在這個 z 上，船有多寬」。
   */
  const hullHalfWidthAt = (z: number) =>
    hullBoxes.find((h) => z >= h.cz - h.halfD - 1e-6 && z <= h.cz + h.halfD + 1e-6)?.halfW ?? 0;

  // 用甲板盒**最靠船頭的那一端**去問，因為船是往前收窄的：那裡是船最窄、最容易裝不下的
  // 地方，通過了就處處通過。
  const outside = deckBoxes.filter((d) =>
    Math.abs(d.cx) + d.halfW > hullHalfWidthAt(d.cz + d.halfD) + 1e-6);
  eq('every deck collider sits inside the hull plan at its narrowest point', outside.map((d) => d.id), []);
  // §8：布、繩、旗、燈籠這種東西不該有碰撞。
  ok(
    'cloth, rope and trim have no colliders',
    !BOAT_COLLIDERS.some((c) => /flag|sail|awning|rope|lantern|scallop|plank/.test(c.id)),
  );
}

// --- 碰撞 vs 互動 (§9/§16) ---------------------------------------------------
console.log('\n-- 碰撞邊界與互動距離是分開的兩件事 (§9/§16) ---------------------------');

{
  const dock = getMerchantDockFor(spec)!;
  for (const scale of SCALES) {
    const { moored } = resolveDock(dock, scale);
    const cos = Math.cos(moored.yaw);
    const sin = Math.sin(moored.yaw);
    // 跟 Three/MerchantVisitor.tsx 每幀做的是同一條式子。測試算的就是遊戲裡會發生的事。
    const toWorld = (cx: number, cz: number) => ({
      x: moored.x + cx * cos + cz * sin,
      z: moored.z - cx * sin + cz * cos,
    });

    // 每一格碰撞盒離島心最近的那個角，減掉玩家半徑 —— 那是玩家最靠近島的可能被擋位置。
    let nearestBlock = Infinity;
    for (const c of BOAT_COLLIDERS) {
      for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const p = toWorld(c.cx + sx * c.halfW, c.cz + sz * c.halfD);
        nearestBlock = Math.min(nearestBlock, Math.hypot(p.x, p.z));
      }
    }
    const shoreline = SHORELINE_RADIUS * scale;

    // ★ 站在乾沙灘上的玩家永遠碰不到船的碰撞盒 —— 不會有「明明還在岸上就被隱形牆擋住」。
    if (scale === 1 || scale === SCALES[SCALES.length - 1]) {
      ok(
        `scale ${scale.toFixed(1)}: the collision boundary never reaches dry land`,
        nearestBlock - PLAYER_PHYSICAL_RADIUS > shoreline,
        `blocked from r=${(nearestBlock - PLAYER_PHYSICAL_RADIUS).toFixed(2)}, shoreline r=${shoreline.toFixed(2)}`,
      );
    }

    // ★ 玩家被推到最貼近船的位置時，離商人仍然在互動距離內 —— 碰撞不會把互動鎖死。
    const anchor = toWorld(MERCHANT_STAND.x, MERCHANT_STAND.z);
    const anchorR = Math.hypot(anchor.x, anchor.z);
    // 從岸的方向逼近：玩家能到的最近點，與商人錨點的距離。
    const closestApproach = anchorR - (nearestBlock - PLAYER_PHYSICAL_RADIUS);
    if (scale === 1) {
      ok(
        'a player pressed against the hull is still well inside interaction range',
        Math.abs(closestApproach) < dockReach(dock),
        `closest ${closestApproach.toFixed(2)} vs reach ${dockReach(dock)}`,
      );
      ok(
        'and so is a player standing on the dry sand',
        anchorR - shoreline < dockReach(dock),
        `from the waterline: ${(anchorR - shoreline).toFixed(2)} vs reach ${dockReach(dock)}`,
      );
    }
  }
}

// --- 碰撞本身 ----------------------------------------------------------------
console.log('\n-- 推出去這件事跟家具走的是同一個函數 ---------------------------------');

{
  // resolvePlayerAgainstSolids 與家具共用 pushOutOfBox，所以這幾條同時也是家具碰撞的規格。
  const box = [{ id: 'test', cx: 0, cz: 0, halfW: 1, halfD: 0.5, rotation: 0 }];
  const r = 0.35;

  const inside = resolvePlayerAgainstSolids(0.2, 0.1, r, box);
  ok(
    'a player inside a solid is pushed out of it',
    Math.abs(inside.z) >= 0.5 + r - 1e-6 || Math.abs(inside.x) >= 1 + r - 1e-6,
    `(0.2, 0.1) → (${inside.x.toFixed(2)}, ${inside.z.toFixed(2)})`,
  );
  const grazing = resolvePlayerAgainstSolids(0, 0.7, r, box);
  eq('one just outside is pushed to exactly the radius', Number(grazing.z.toFixed(4)), 0.85);
  const clear = resolvePlayerAgainstSolids(0, 3, r, box);
  eq('and one well clear is not moved at all', [clear.x, clear.z], [0, 3]);
  eq('no solids means no push', resolvePlayerAgainstSolids(0.2, 0.1, r, null), { x: 0.2, z: 0.1 });

  // 旋轉：同一個盒子轉 90 度之後，擋住的方向也跟著轉。船會轉，所以這一條是真的會用到的。
  const turned = [{ id: 'test', cx: 0, cz: 0, halfW: 1, halfD: 0.5, rotation: Math.PI / 2 }];
  const acrossTurned = resolvePlayerAgainstSolids(0.7, 0, r, turned);
  eq('a rotated box blocks along its rotated axis', Number(acrossTurned.x.toFixed(4)), 0.85);
}

// --- 登記表 ------------------------------------------------------------------
console.log('\n-- 船開走了碰撞盒就跟著走 ---------------------------------------------');

{
  clearWorldSolids();
  eq('nothing solid while nobody is visiting', getWorldSolids().length, 0);

  const boxes = BOAT_COLLIDERS.map((c) => ({ id: c.id, cx: 0, cz: 0, halfW: c.halfW, halfD: c.halfD, rotation: 0 }));
  publishWorldSolids('traveling-trader', boxes);
  eq('a docked merchant contributes its boxes', getWorldSolids().length, BOAT_COLLIDERS.length);

  // 來源就地改寫自己的盒子，登記表看到的必須已經是新值——這是「Collider 不會留在原地」的
  // 機制本身：攤平的清單裝的是同一批物件，不是複本。
  boxes[0].cx = 42;
  eq('and the registry sees a moved box without re-publishing', getWorldSolids()[0].cx, 42);

  // 同一組重複登記是無操作，所以呼叫端可以每幀無腦呼叫。
  publishWorldSolids('traveling-trader', boxes);
  eq('re-publishing the same array does not duplicate it', getWorldSolids().length, BOAT_COLLIDERS.length);

  publishWorldSolids('traveling-trader', null);
  eq('a departed merchant leaves no invisible wall behind', getWorldSolids().length, 0);
}


// --- 配件貼在身上，不是埋在身體裡 -------------------------------------------
console.log('\n-- 這一身穿在身上，不是穿在身體裡面 -----------------------------------');

// 這一組是「軀幹裡那個褐色圓環」的規格化。它壞掉的方式跟腿散架是同一種：一個配件的座標與
// 它要貼上去的那個身體，各自被寫死了一次。所以這裡驗的不是「背帶在某個半徑上」，而是**每
// 一個配件都在身體外面**——任何一個數字被單獨調動，都會讓其中一條失敗。
{
  const satchel = otterSatchel();
  const collar = otterCollar();
  const band = otterHatBand();

  // 環上一點的水平距離與高度。這就是模型那三層 group 做的事（scale → tilt → yaw），寫在這
  // 裡再算一次是刻意的：測試驗的是**畫面上那個環**，不是產生它的那些參數。
  const strapPoint = (theta: number) => {
    const flat = satchel.stretch * satchel.radius * Math.cos(theta);
    return {
      r: Math.hypot(flat * Math.cos(satchel.tilt), satchel.radius * Math.sin(theta)),
      y: satchel.centreY + flat * Math.sin(satchel.tilt),
    };
  };

  let drift = 0;
  let minClear = Infinity;
  let maxClear = -Infinity;
  let lowest = Infinity;
  let highest = -Infinity;
  for (let i = 0; i < 720; i++) {
    const p = strapPoint((i / 720) * Math.PI * 2);
    drift = Math.max(drift, Math.abs(p.r - satchel.radius));
    const clear = p.r - otterBodyRadiusAt(p.y);
    minClear = Math.min(minClear, clear);
    maxClear = Math.max(maxClear, clear);
    lowest = Math.min(lowest, p.y);
    highest = Math.max(highest, p.y);
  }

  // ★ 這一條就是那個 bug。整條背帶必須在身體外面 —— 上一版有 86% 在裡面。
  ok(
    'the satchel strap never sinks into the body — THIS is the brown ring',
    minClear > 0,
    `clearance ${minClear.toFixed(4)} .. ${maxClear.toFixed(4)}`,
  );
  // 也不能離身體太遠：一條浮在空中的背帶跟一條埋在身體裡的一樣不對。
  ok('and it never floats off it either', maxClear < 0.03, `worst ${maxClear.toFixed(4)}`);
  // 拉長的倍率就是為了這一條：斜著切過圓柱的平面，切出來的是橢圓。半徑一旦隨角度變化，
  // 「貼著身體」就只在某幾個角度成立。
  ok(
    'the strap is a true cylinder section — its radius does not wobble with the angle',
    drift < 1e-9,
    `max drift ${drift.toExponential(1)}`,
  );
  // 背帶從腰帶**上面**過去，從領口**底下**過去。兩端都是從別的零件推出來的。
  ok(
    'the strap passes above the sash',
    lowest > OTTER_BODY.sash.cy + OTTER_BODY.sash.h / 2,
    `strap bottom ${lowest.toFixed(3)} vs sash top ${(OTTER_BODY.sash.cy + OTTER_BODY.sash.h / 2).toFixed(3)}`,
  );
  ok(
    'and under the collar',
    highest < collar.y - collar.tube,
    `strap top ${highest.toFixed(3)} vs collar ${collar.y.toFixed(3)}`,
  );

  // 袋子掛在環的低點上，所以背帶與袋子是同一件東西的兩段，不是兩件剛好靠在一起的東西。
  const pouch = satchel.pouch;
  eq(
    'the pouch hangs exactly off the low point of the strap',
    Number((pouch.cy + pouch.size[1] / 2).toFixed(6)),
    Number(lowest.toFixed(6)),
  );
  ok(
    'the pouch rests against the body rather than inside it',
    pouch.x - pouch.size[0] / 2 > otterBodyRadiusAt(pouch.cy),
    `inner face ${(pouch.x - pouch.size[0] / 2).toFixed(4)} vs body ${otterBodyRadiusAt(pouch.cy).toFixed(4)}`,
  );
  ok(
    'and the flap covers where the strap meets it',
    pouch.flapSize[0] > pouch.size[0] && pouch.x - pouch.flapSize[0] / 2 < satchel.radius + satchel.tube,
  );

  // 領口：原本 100% 埋在肩線球裡，所以那件米白內襯從來沒有出現過。
  let collarClear = Infinity;
  for (let i = 0; i <= 12; i++) {
    const y = collar.y - collar.tube + (2 * collar.tube * i) / 12;
    collarClear = Math.min(collarClear, collar.radius - otterSilhouetteRadiusAt(y));
  }
  ok('the collar sits outside the neck, not inside the shoulders', collarClear > 0,
    `clearance ${collarClear.toFixed(4)}`);
  ok(
    'and it sits where the head actually leaves the shoulders',
    Math.abs(otterHeadRadiusAt(otterNeckline().y) - otterNeckline().radius) < 1e-9,
  );

  // 帽帶：同一種毛病的小號版本（原本只有最外緣 0.002 露在帽冠外面）。
  let bandClear = Infinity;
  for (let i = 0; i <= 8; i++) {
    const y = band.y - band.tube + (2 * band.tube * i) / 8;
    const crown = OTTER_BODY.hatCrown;
    const d = (y - crown.cy) / (crown.r * crown.squash);
    const rc = Math.abs(d) >= 1 ? 0 : crown.r * Math.sqrt(1 - d * d);
    bandClear = Math.min(bandClear, band.radius - rc);
  }
  ok('the hat band wraps the crown instead of hiding in it', bandClear > 0,
    `clearance ${bandClear.toFixed(4)}`);
}

// --- 這張臉上有五官 ----------------------------------------------------------
console.log('\n-- 眼睛、腮紅、鬍鬚真的在臉上 ------------------------------------------');

{
  // 一個點在橢球表面**底下**多深（負的代表在外面）。五官全部靠它決定露出多少。
  const depthUnder = (
    centre: readonly [number, number, number],
    radii: readonly [number, number, number],
    p: readonly [number, number, number],
  ) => {
    const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]] as const;
    const norm = Math.hypot(d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]);
    const len = Math.hypot(d[0], d[1], d[2]);
    return len / norm - len;
  };
  const head = OTTER_BODY.head;
  const headC = [0, head.cy, 0] as const;
  const headR = [head.r, head.r * head.squash, head.r * head.depth] as const;
  const muzzle = OTTER_BODY.muzzle;
  const muzzleC = [0, muzzle.cy, muzzle.cz] as const;
  const muzzleR = [muzzle.r * muzzle.wide, muzzle.r * muzzle.squash, muzzle.r] as const;

  // ★ 兩顆眼睛。原本寫死的 (±0.062, 0.785, 0.115) 在表面底下 0.026，而眼球半徑只有 0.021 ——
  // 整顆埋在頭裡，這張臉上一顆眼睛都沒有。
  const EYE_R = 0.021;
  const eye = otterOnHead([0.062, 0.785, 0.115], 0.010);
  const eyeDepth = depthUnder(headC, headR, eye);
  ok(
    'the eyes stick out of the head — they used to be buried inside it',
    EYE_R - eyeDepth > 0.006,
    `bead ${EYE_R} vs sunk ${eyeDepth.toFixed(4)} → ${(EYE_R - eyeDepth).toFixed(4)} showing`,
  );
  ok('and not so far out that they are beads on a stick', EYE_R - eyeDepth < EYE_R,
    `sunk ${eyeDepth.toFixed(4)} > 0`);
  // 眼睛必須在口鼻那顆球**外面**，否則它會被臉頰吃掉。
  ok('the eyes clear the muzzle', depthUnder(muzzleC, muzzleR, eye) < 0);

  // 腮紅沉得比眼睛深 —— 它是一片顏色，不是一顆突起。
  const blush = otterOnHead([0.108, 0.735, 0.086], 0.022);
  const blushDepth = depthUnder(headC, headR, blush);
  ok('the blush shows as a patch, not a lump', blushDepth > eyeDepth && blushDepth < 0.032,
    `sunk ${blushDepth.toFixed(4)}`);

  // 鬍鬚長在口鼻上。原本四根的兩端幾乎全部在口鼻球裡面。
  for (const i of [0, 1]) {
    const root = otterOnMuzzle([0.062, 0.712 - i * 0.016, 0.15], 0.006);
    ok(
      `whisker ${i} is rooted on the muzzle surface, not inside it`,
      Math.abs(depthUnder(muzzleC, muzzleR, root) - 0.006) < 1e-9,
    );
    // 桿子是斜著往外掃的，所以外側那一半一定在外面。
    const axis = { x: Math.sin(1.35 - i * 0.2), y: Math.cos(1.35 - i * 0.2) };
    const tip = [root[0] + axis.x * 0.036, root[1] + axis.y * 0.036, root[2]] as const;
    ok(`whisker ${i} reaches out past the muzzle`, depthUnder(muzzleC, muzzleR, tip) < 0);
  }
}

// --- 前襟 --------------------------------------------------------------------
{
  // 貼著衣身的一段殼：兩端各問一次身體，中間線性內插。軀幹是外凸的圓錐接上肩線球，所以
  // 內插出來的那條線在中間只會**更外面**——這一條驗的就是那件事，而不是「看起來沒事」。
  const bottom = OTTER_BODY.sash.cy + OTTER_BODY.sash.h / 2;
  const top = OTTER_BODY.shoulder.cy - 0.01;
  const rBottom = otterBodyRadiusAt(bottom) + 0.004;
  const rTop = otterBodyRadiusAt(top) + 0.004;
  let worst = Infinity;
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const y = bottom + (top - bottom) * t;
    worst = Math.min(worst, rBottom + (rTop - rBottom) * t - otterBodyRadiusAt(y));
  }
  ok('the coat placket follows the coat instead of sinking into it', worst > 0,
    `worst clearance ${worst.toFixed(4)}`);
}

// --- 動畫狀態機 --------------------------------------------------------------
console.log('\n-- 待機、打招呼、交易反應是一台狀態機 (§4/§12/§13) ---------------------');

/** 把控制器跑 `seconds` 秒，每幀 `step`。回傳這段時間裡出現過的狀態順序。 */
function run(
  animator: MerchantAnimator,
  seconds: number,
  distance: number | null,
  step = 1 / 60,
  onFrame?: (animator: MerchantAnimator, t: number) => void,
): MerchantAnimationState[] {
  const seen: MerchantAnimationState[] = [];
  for (let t = 0; t < seconds; t += step) {
    onFrame?.(animator, t);
    animator.update({
      delta: step,
      distance,
      bearing: 0.3,
      available: true,
      awareness: AWARENESS,
      interaction: REACH,
    });
    if (seen[seen.length - 1] !== animator.state) seen.push(animator.state);
  }
  return seen;
}

const REACH = dockReach(getMerchantDockFor(spec)!);
const AWARENESS = REACH * MERCHANT_SENSES.awarenessFromReach;

// 三個半徑由外往內：先被看到，再談得到，最後才是碰撞。§14。
ok('awareness reaches further than the interaction range', AWARENESS > REACH,
  `awareness ${AWARENESS.toFixed(2)} vs reach ${REACH}`);
ok(
  'and the forget radius is further still, so the edge cannot flicker',
  AWARENESS + MERCHANT_SENSES.forgetMargin > AWARENESS,
);

// --- 待機 (§5/§6) ------------------------------------------------------------
{
  const idle = new MerchantAnimator(1);
  const states = run(idle, 30, null);
  eq('nobody around: he just idles', states, ['idle']);

  // 「不再完全靜止」：連續取樣的姿勢必須一直在變。
  const samples: number[] = [];
  for (let i = 0; i < 240; i++) {
    idle.update({ delta: 1 / 60, distance: null, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
    samples.push(idle.pose.rise * 1000 + idle.pose.roll * 100 + idle.pose.headYaw);
  }
  const moved = samples.filter((v, i) => i > 0 && Math.abs(v - samples[i - 1]) > 1e-9).length;
  ok('an idle merchant is never completely still', moved > samples.length * 0.9,
    `${moved}/${samples.length} frames changed`);

  // 「不會一直重複同一個明顯動作」：五分鐘裡至少出現過三種待機小動作。
  const actions = new Set<string>();
  const long = new MerchantAnimator(7);
  run(long, 300, null, 1 / 30, (a) => actions.add(a.idleAction));
  ok('idle varies instead of looping one gesture', actions.size >= 3,
    `saw ${[...actions].join(', ')}`);

  // 可重現：同一個種子跑出同一串小動作。沒有這一條，上面那一條就只是「今天剛好」。
  const seqA: string[] = [];
  const seqB: string[] = [];
  run(new MerchantAnimator(42), 120, null, 1 / 30, (a) => seqA.push(a.idleAction));
  run(new MerchantAnimator(42), 120, null, 1 / 30, (a) => seqB.push(a.idleAction));
  eq('and the same seed replays the same idle', seqA.join('') === seqB.join(''), true);
}

// --- 打招呼 (§7/§8) ----------------------------------------------------------
{
  const a = new MerchantAnimator(3);
  // 玩家走進感知範圍：打一次招呼，然後回到「應對」（他就站在互動距離裡）。
  const states = run(a, 12, REACH * 0.8);
  eq('a player walking up gets greeted exactly once', states.filter((s) => s === 'greeting').length, 1);
  eq('and afterwards he stays attentive, not stuck waving', a.state, 'interacting');

  // 站著不動：不會再打第二次。§7 的「玩家持續站在範圍內，不要重複播放」。
  const more = run(a, 120, REACH * 0.8);
  eq('standing there does not make him greet again', more.filter((s) => s === 'greeting').length, 0);
}

{
  // ★ 邊界抖動：在感知半徑上來回踏步。這是 §7 明講要避免的 animation spam。
  const a = new MerchantAnimator(4);
  let greetings = 0;
  let last: MerchantAnimationState = 'idle';
  for (let i = 0; i < 60 * 60; i++) {
    // 每半秒跨過邊界一次，幅度剛好在遲滯帶裡面。
    const inside = Math.floor(i / 30) % 2 === 0;
    a.update({
      delta: 1 / 60,
      distance: inside ? AWARENESS - 0.2 : AWARENESS + 0.2,
      bearing: 0,
      available: true,
      awareness: AWARENESS,
      interaction: REACH,
    });
    if (a.state === 'greeting' && last !== 'greeting') greetings++;
    last = a.state;
  }
  eq('pacing across the awareness edge for a minute greets once, not sixty times', greetings, 1);
}

{
  // 真的離開、真的回來：這一次可以再打招呼 —— 但要等冷卻過了。
  const a = new MerchantAnimator(5);
  run(a, 6, REACH * 0.8);                       // 第一次招呼
  run(a, MERCHANT_GREETING.rearmSeconds + 1, AWARENESS * 4); // 走遠
  const tooSoon = run(a, 4, REACH * 0.8);       // 冷卻還沒過就回來
  eq('coming straight back does not re-trigger it', tooSoon.filter((s) => s === 'greeting').length, 0);

  run(a, MERCHANT_GREETING.cooldownSeconds, AWARENESS * 4); // 走遠夠久
  const later = run(a, 6, REACH * 0.8);
  eq('but coming back later does', later.filter((s) => s === 'greeting').length, 1);
}

// --- 購買反應 (§10/§11) ------------------------------------------------------
{
  const a = new MerchantAnimator(6);
  run(a, 20, REACH * 0.5);
  eq('no purchase, no celebration', a.state, 'interacting');

  a.notifyPurchase({ currency: 'coins', amount: 200 });
  const small = run(a, MERCHANT_PURCHASE.smallSeconds + 0.5, REACH * 0.5);
  ok('a small purchase gets a short reaction', small.includes('purchase'));
  eq('and it ends back where it started', a.state, 'interacting');

  a.notifyPurchase({ currency: 'coins', amount: 2400 });
  let frames = 0;
  for (; frames < 60 * 5; frames++) {
    a.update({ delta: 1 / 60, distance: REACH * 0.5, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
    if (a.state !== 'purchase') break;
  }
  const seconds = frames / 60;
  ok('a bigger one gets a longer one — but still under two seconds (§10)',
    seconds > MERCHANT_PURCHASE.smallSeconds && seconds <= 2,
    `${seconds.toFixed(2)}s`);
}

// --- 交付物品：包裹出現、遞出去、手收回來之前就給出去了 -------------------------
{
  const h = MERCHANT_PURCHASE.handover;
  ok('handover beats are in order: appear < give < gone, all inside the reaction',
    h.appear < h.give && h.give < h.gone && h.gone < 1);

  const c = new MerchantAnimator(7);
  run(c, 3, REACH * 0.5);
  ok('no parcel in his hand before anything is bought', c.pose.offer === 0);

  for (const [label, amount, total] of [
    ['a big purchase', 2400, MERCHANT_PURCHASE.bigSeconds],
    ['a small purchase', 200, MERCHANT_PURCHASE.smallSeconds],
  ] as const) {
    c.notifyPurchase({ currency: 'coins', amount });
    let maxOffer = 0;
    let lingering = false;
    const frameCount = Math.round(total * 60);
    for (let i = 0; i < frameCount; i++) {
      const pose = c.update({ delta: 1 / 60, distance: REACH * 0.5, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
      maxOffer = Math.max(maxOffer, pose.offer);
      // Past `gone` (plus the blend-in frame or two), the parcel must already have been handed over.
      if ((i + 1) / 60 / total > h.gone + 0.04 && pose.offer > 1e-3) lingering = true;
    }
    ok(`${label} puts a parcel in his hand`, maxOffer > 0.9, `peak ${maxOffer.toFixed(2)}`);
    ok(`${label}: it is handed over before his arm comes back`, !lingering);
    run(c, 1, REACH * 0.5);
    ok(`${label}: his hand is empty afterwards`, c.pose.offer === 0);
  }
}

// --- 優先權 (§12) ------------------------------------------------------------
{
  const a = new MerchantAnimator(8);
  // 招呼播到一半，交易成功。
  run(a, 0.6, REACH * 0.9);
  eq('mid-greeting', a.state, 'greeting');
  a.notifyPurchase({ currency: 'fragments', amount: 400 });
  a.update({ delta: 1 / 60, distance: REACH * 0.9, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
  eq('a successful purchase takes over a greeting', a.state, 'purchase');

  // 反過來不成立：購買反應播到一半，不會被招呼打斷。
  const b = new MerchantAnimator(9);
  run(b, 3, AWARENESS * 4);              // 遠遠站著，讓招呼重新武裝
  b.notifyPurchase({ currency: 'coins', amount: 2000 });
  b.update({ delta: 1 / 60, distance: AWARENESS * 4, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
  eq('purchase started', b.state, 'purchase');
  for (let i = 0; i < 12; i++) {
    b.update({ delta: 1 / 60, distance: REACH * 0.5, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
  }
  eq('a player walking up does not interrupt it', b.state, 'purchase');
}

// --- 動畫碰不到碰撞，也碰不到 root (§15) -------------------------------------
console.log('\n-- 動畫只寫得到姿勢，寫不到位置 (§9/§15) -------------------------------');

{
  const a = new MerchantAnimator(11);
  // 一組會用到每一個通道的情境：走近、打招呼、買東西、走開。
  let maxYaw = 0;
  let maxYawStep = 0;
  let maxRise = 0;
  let previousYaw = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const t = i / 60;
    const distance = t < 8 ? AWARENESS * 3 : t < 26 ? REACH * 0.7 : AWARENESS * 3;
    if (Math.abs(t - 14) < 1 / 120) a.notifyPurchase({ currency: 'coins', amount: 1500 });
    const pose = a.update({
      delta: 1 / 60,
      distance,
      bearing: 0.9,
      available: true,
      awareness: AWARENESS,
      interaction: REACH,
    });
    maxYaw = Math.max(maxYaw, Math.abs(pose.bodyYaw));
    maxYawStep = Math.max(maxYawStep, Math.abs(pose.bodyYaw - previousYaw));
    previousYaw = pose.bodyYaw;
    maxRise = Math.max(maxRise, Math.abs(pose.rise));
  }

  // ★ 姿勢裡**沒有位移通道**。這是「動畫不會讓 Collider 與 Visual 分家」的機制本身：不是
  // 「記得不要改 root」，而是控制器根本沒有辦法表達那件事。
  const channels = Object.keys(a.pose).sort();
  eq(
    'a pose cannot express a translation at all — there is no such channel',
    channels.filter((k) => /^(x|y|z|position|offset)$/i.test(k)),
    [],
  );
  ok(
    'the only vertical channel is the upper-body breath, and it is tiny',
    maxRise <= MERCHANT_BREATH.rise + 1e-9,
    `max rise ${maxRise.toFixed(4)} (model units, × height 1.72)`,
  );
  // 轉向被夾住，所以他不會轉到背對貨架。
  ok('the turn is clamped', maxYaw <= MERCHANT_SENSES.maxBodyYaw + 1e-9, `max ${maxYaw.toFixed(3)}`);
  // 而且是平滑的：沒有任何一幀是瞬間對準玩家。§9。
  ok('and it is smooth — never a snap to face the player', maxYawStep < 0.05,
    `worst frame step ${maxYawStep.toFixed(4)} rad`);

  // ★ 轉到極限時，肩線仍然留在他自己那一格碰撞盒裡（Three/MerchantBoat.tsx 的 merchant）。
  // 繞著自己的中軸轉不會改變一個圓形肩線的佔地，而這一條把那件事寫下來。
  const merchantBox = BOAT_COLLIDERS.find((c) => c.id === 'merchant')!;
  const shoulderWorld = OTTER_BODY.shoulder.r * spec.height;
  ok(
    'and at any yaw his shoulders stay inside his own collider box',
    shoulderWorld <= merchantBox.halfW,
    `shoulders ${shoulderWorld.toFixed(3)} vs box ${merchantBox.halfW}`,
  );
}

{
  // 同一個物件、每一幀。動畫不製造垃圾 —— §17。
  const a = new MerchantAnimator(12);
  const first = a.update({ delta: 1 / 60, distance: null, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
  const second = a.update({ delta: 1 / 60, distance: null, bearing: 0, available: true, awareness: AWARENESS, interaction: REACH });
  ok('the animator writes into one pose object instead of allocating per frame', first === second);
}

{
  // 幀率無關：30fps 與 144fps 走出同一串狀態，而且招呼在同一個時間點結束。
  const slow = new MerchantAnimator(13);
  const fast = new MerchantAnimator(13);
  const slowStates = run(slow, 10, REACH * 0.8, 1 / 30);
  const fastStates = run(fast, 10, REACH * 0.8, 1 / 144);
  eq('the state sequence does not depend on the frame rate', slowStates, fastStates);
}
console.log(
  `\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — ${checks - failures}/${checks} checks\n`,
);
process.exit(failures === 0 ? 0 : 1);
