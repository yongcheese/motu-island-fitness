/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Check, Coins, Gem, History, Layers, Tent, Timer, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { View } from '../types';
import { getBalance, type CurrencyId } from '../constants/currency';
import { rarityStyleVars } from '../constants/rarity';
import { LIMITED_SHOP_CONFIG, getPurchasedCount } from '../constants/limitedShop';
import {
  currentRotation,
  describeTimeLeft,
  msUntilRotationEnds,
  remainingAllowance,
  resolveOffer,
  type LimitedOffer,
  type LimitedRotation,
  type OfferPrice,
  type ResolvedOffer,
} from '../constants/limitedShopRotation';
import { LIMITED_PURCHASE_MESSAGES, type LimitedPurchaseResult } from '../context/useLimitedShop';
import { playSound, SoundEffect, triggerHaptic } from '../lib/soundUtils';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { useDirectWheelScroll } from '../hooks/useScrollIsolation';
import { QVersionIcon } from './QVersionIcon';
import { RarityAura } from './UI/RarityAura';
import {
  Button,
  CurrencyChip,
  EmptyState,
  ModalOverlay,
  ModalShell,
  PanelHeader,
} from './UI/DesignKit';
import {
  UtilityCardArt,
  UtilityCardBagButton,
  UtilityCardBagModal,
  UtilityCardMeta,
  UtilityCardTile,
  useNow,
} from './UI/UtilityCard';

/**
 * 限時小攤 —— 一家獨立的店。
 *
 * 普通商店賣常駐商品，這裡賣本檔限定的東西，兩邊的商品池互斥（constants/distribution.ts），
 * 玩家不需要「先進商店，再去找限時分類」。
 *
 * ## 進得來，是因為有人把門打開了
 *
 * 這一頁**不判斷商人在不在**，一行都沒有。它以前是路牌上一格按鈕直接開的；現在唯一開得了它
 * 的是 UI/MerchantSession.tsx —— 玩家走到島邊那位旅行商人面前按下動作鍵，那個元件確認過造訪
 * 狀態（constants/merchantVisit.ts）之後才切 view。商人收攤時也是它蓋上「他已經離開了」那一
 * 層，並把玩家送回島上。
 *
 * 這一頁因此**完全沒有為了改成世界入口而改動**：它照樣只畫 `currentRotation(now)`。那是刻意
 * 的分工 —— 一個會自己判斷「商人還在嗎」的商店畫面，就是第二個關於商人在不在的答案，而兩個
 * 答案遲早會在某個邊界上不一致。
 *
 * ## 這一頁要讓玩家搞懂的三件事
 *
 *  1. **這不是普通商店。** 靠的是它自己的入口、攤位的木牌語彙與「本檔」的說法，而不是一片紅色
 *     倒數。這裡刻意不做成課金商城：倒數只講到「天/小時」，沒有秒數在跳，沒有「最後機會」，
 *     沒有搶購動畫。它要像島上一個期間限定的小攤子，不是一個要你現在就掏錢的櫃檯。
 *  2. **卡牌是整包賣的。** 每一張卡牌卡片上都直接寫「× N 張」與整包價格，而且沒有數量選擇器
 *     （§16/§17）—— 商品本身就是一包，按鈕上寫的是「購買此組合」。
 *  3. **沒買到不是永久失去。** 「返場」標籤是這家店最有用的一句話。
 *
 * ## 這裡不決定任何事
 *
 * 賣什麼、一包幾張、多少錢、還能買幾次，全部來自 constants/limitedShopRotation.ts 的
 * `currentRotation(now)`，那是期數的純函數。這一頁只是把它畫出來 —— 所以重新整理、重開遊戲、
 * 換一台裝置都會看到同一組商品與同一個價格（§23）。
 */

const headerBtnClass =
  'h-10 px-3.5 gap-2 rounded-xl bg-white border border-island-line hover:border-island-teal hover:text-island-teal text-island-navy-soft flex items-center justify-center transition-all active:scale-90 flex-shrink-0';

/** 價格用哪一種貨幣籌碼。金幣金色、碎片藍綠 —— 見 DesignKit 的 CurrencyChip。 */
const chipKind = (currency: CurrencyId) => (currency === 'coins' ? 'coins' : 'fragments');

export function LimitedShopView({ onClose }: { onClose?: () => void }) {
  const { profile, setCurrentView } = useApp();
  // 一秒一跳：倒數是這一頁「限時」這個說法的全部憑據，而在玩家眼前換檔的貨架，也必須在畫面上
  // 真的換掉 —— `currentRotation` 是這個數字的純函數，所以新的一檔會自己畫出來。
  const now = useNow(1000);
  const rotation: LimitedRotation = currentRotation(now);
  const scrollRef = useDirectWheelScroll();

  const [pending, setPending] = useState<{ resolved: ResolvedOffer; price: OfferPrice } | null>(null);
  const [showBag, setShowBag] = useState(false);

  const exit = () => {
    playSound(SoundEffect.CLICK);
    if (onClose) onClose();
    else setCurrentView(View.HOME);
  };

  // 只有在上面沒有疊東西的時候：對話框與卡牌背包打開時各自接管 Esc，兩個 window 層級的監聽會在
  // 同一次按鍵一起關掉。
  useEscapeToClose(exit, !pending && !showBag);
  useEscapeToClose(() => setPending(null), !!pending);
  useEscapeToClose(() => setShowBag(false), showBag);

  /** 這一檔的商品，依設定裡的貨架區分組，順序照設定寫的。 */
  const sections = useMemo(
    () =>
      LIMITED_SHOP_CONFIG.slots
        .map((slot) => ({
          slot,
          offers: rotation.offers.filter((offer) => offer.slotId === slot.id),
        }))
        .filter((section) => section.offers.length > 0),
    [rotation],
  );

  const timeLeft = msUntilRotationEnds(rotation, now);

  return (
    <>
      <div
        ref={scrollRef}
        className="fixed inset-0 z-[60] bg-island-cream-2 overflow-y-auto page-shell-x page-shell-y"
      >
        <div className="w-full max-w-[1000px] mx-auto bg-island-cream rounded-[2rem] shadow-[0_15px_40px_rgba(38,70,83,0.12)] border border-island-line overflow-hidden mb-10">
          <div className="flex flex-col md:flex-row md:items-stretch flex-shrink-0">
            <PanelHeader
              icon={<Tent size={22} strokeWidth={2.5} />}
              title="限時小攤"
              subtitle="旅行商人的期間限定攤位，本檔換一批"
              className="flex-1 min-w-0 !border-b-0 md:!border-b"
            />
            <div className="flex items-center justify-end flex-wrap gap-2.5 bg-island-cream-2 border-b border-island-line px-6 py-3 md:pr-8 md:pl-2 md:py-0 flex-shrink-0">
              <CurrencyChip amount={getBalance(profile, 'coins')} />
              <CurrencyChip amount={getBalance(profile, 'fragments')} currency="fragments" />
              {/* 卡牌背包，就在這裡：這是全遊戲買得到卡牌的地方，一張只能回商店才看得到的卡是
                  一張玩家會忘記自己有的卡。 */}
              <UtilityCardBagButton onClick={() => setShowBag(true)} />
              <button onClick={exit} className={headerBtnClass} aria-label="離開限時小攤">
                <X size={16} strokeWidth={3} />
                <span className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap">
                  離開
                </span>
              </button>
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-7">
            {/* 「這不是常駐商品」這件事，講一次，講得平靜。 */}
            <div className="rounded-[1.75rem] border border-island-line bg-white px-6 py-5 flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-island-teal text-white flex items-center justify-center flex-shrink-0">
                <Timer size={22} strokeWidth={2.5} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-black text-island-navy tracking-tight">
                  本檔剩餘 {describeTimeLeft(timeLeft)}
                </h3>
                <p className="text-xs font-bold text-island-navy-soft/70 mt-0.5">
                  換檔後攤位上的東西會全部換一批，卡牌組合包的張數與價格也會重新配置。沒買到也沒
                  關係——過一陣子它們可能會再回來。
                </p>
              </div>
            </div>

            {sections.map(({ slot, offers }) => (
              <section key={slot.id} className="space-y-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <h3 className="text-base font-black text-island-navy tracking-tight">{slot.label}</h3>
                  <span className="text-[11px] font-bold text-island-navy-soft/60">
                    本檔 {offers.length} 項
                  </span>
                </div>
                <p className="text-xs font-bold text-island-navy-soft/70 leading-relaxed">
                  {slot.note}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-1">
                  {offers.map((offer) => (
                    <LimitedOfferCard
                      key={offer.id}
                      offer={offer}
                      rotationId={rotation.id}
                      onBuy={(resolved, price) => {
                        triggerHaptic('medium');
                        setPending({ resolved, price });
                      }}
                    />
                  ))}
                </div>
              </section>
            ))}

            {sections.length === 0 && (
              <EmptyState
                icon={<Tent size={32} strokeWidth={1.5} />}
                title="本檔攤位還沒擺出來"
                description="換檔後再回來看看吧！"
              />
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {pending && (
          <LimitedPurchaseDialog
            resolved={pending.resolved}
            price={pending.price}
            rotationId={rotation.id}
            onClose={() => setPending(null)}
          />
        )}
      </AnimatePresence>

      {/* z-[80]：這一頁本地層級的最上層，蓋過貨架與對話框那一層。 */}
      <UtilityCardBagModal open={showBag} onClose={() => setShowBag(false)} zIndexClassName="z-[80]" />
    </>
  );
}
/**
 * 攤位上的一項商品。
 *
 * 兩種畫法，一套規則。標籤、價格列、限購讀數與購買流程對組合包與飾品完全一樣，所以它們寫在這裡
 * 一次；不一樣的是**它被畫成什麼**：功能卡走 `UtilityCardTile`（圓形卡面、票根壓線 —— 功能卡不是
 * 商品，不能被畫成商品，見 DESIGN_SYSTEM.md），目錄商品走商店那張 `.store-card`。
 *
 * 這就是 §20 說的那條線：可以共用基礎卡片，但 Offer 資料、購買規則與刷新規則各自獨立 —— 而它們
 * 獨立的地方在 constants/，不在這裡。
 */
function LimitedOfferCard({
  offer,
  rotationId,
  onBuy,
}: {
  offer: LimitedOffer;
  rotationId: string;
  onBuy: (resolved: ResolvedOffer, price: OfferPrice) => void;
}) {
  const { profile } = useApp();
  const resolved = resolveOffer(offer);
  if (!resolved) return null;

  const bought = getPurchasedCount(profile?.limitedShop, rotationId, offer.id);
  const remaining = remainingAllowance(profile?.limitedShop, rotationId, offer);
  const soldOut = remaining <= 0;
  const isBundle = offer.kind === 'card-bundle';

  const badges = (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      {/* 一包幾張,排在第一個。§16 要的就是這個:玩家不能以為 450 碎片只買到一張。 */}
      {isBundle && (
        <span className="px-2 py-0.5 bg-island-teal text-white text-[10px] font-black rounded-lg flex items-center gap-1">
          <Layers size={10} strokeWidth={3} />× {resolved.quantity} 張
        </span>
      )}
      <span className="px-2 py-0.5 bg-island-gold/12 text-island-navy text-[10px] font-black rounded-lg border border-island-gold/35 flex items-center gap-1">
        <Tent size={10} strokeWidth={3} />
        本檔限定
      </span>
      {/* 返場 —— 這家店最有用的一句話:錯過不是永久的。 */}
      {offer.returning && (
        <span className="px-2 py-0.5 bg-island-teal/12 text-island-teal-dark text-[10px] font-black rounded-lg border border-island-teal/25 flex items-center gap-1">
          <History size={10} strokeWidth={3} />
          返場
        </span>
      )}
      {offer.purchaseLimit !== null && (
        <span className="px-2 py-0.5 bg-island-cream-2 text-island-navy-soft text-[10px] font-black rounded-lg border border-island-line">
          本檔限購 {bought}/{offer.purchaseLimit}
        </span>
      )}
    </div>
  );

  /* 組合包再用整句話講一次張數。上面的 chip 是給掃過去的眼睛看的,這一段是給真的在讀的人看的
     —— 「本檔組合」四個字也順便說明了為什麼下一檔的張數會不一樣。 */
  const bundleNote = isBundle ? (
    <div className="rounded-2xl border border-dashed border-island-line bg-island-cream-2 px-3 py-2">
      <p className="text-xs font-black text-island-navy tracking-tight">
        本檔組合：{resolved.name} × {resolved.quantity} 張
      </p>
      <p className="text-[10px] font-bold text-island-navy-soft/70 mt-0.5">
        整包販售，購買後一次獲得 {resolved.quantity} 張
      </p>
    </div>
  ) : null;

  const priceRows = (
    <div className="space-y-2">
      {offer.prices.map((price) => (
        <PriceRow
          key={price.id}
          price={price}
          quantity={resolved.quantity}
          disabled={soldOut}
          onClick={() => onBuy(resolved, price)}
        />
      ))}
      {soldOut && (
        <p className="text-[11px] font-bold text-island-navy-soft/70 text-center">
          本檔已售罄，換檔後再來
        </p>
      )}
    </div>
  );

  // 功能卡：用共用的卡片元件畫,不是用商品卡(DESIGN_SYSTEM.md:功能卡不是商品)。抽獎券不走這
  // 一條 —— 它在目錄裡是一件真的商品,有自己的 Q 版圖,畫成商品卡才是對的;它跟飾品的差別只在
  // 交付到哪裡,而那件事在 constants/,不在這裡。
  if (resolved.card) {
    return (
      <UtilityCardTile
        card={resolved.card}
        badges={badges}
        aside={bundleNote}
        action={priceRows}
      />
    );
  }

  const item = resolved.item;
  if (!item) return null;

  return (
    <div
      // 稀有度的類名也掛在卡片上,不是只掛在光暈上 —— 整張卡現在就是稀有度本身(見 index.css
      // 的 `.rarity-card`:染色的紙、框內的內襯線、史詩以上的壓紋與沿框走的高光)。
      className={`store-card rarity-card rarity-${resolved.rarity} p-4 rounded-[1.75rem] border flex flex-col cursor-default`}
      style={rarityStyleVars(resolved.rarity)}
    >
      <div className="w-full aspect-[4/3] bg-island-cream-2 rounded-2xl mb-3 flex items-center justify-center relative overflow-hidden border rarity-well">
        <RarityAura rarity={resolved.rarity} />
        <div className="text-island-navy flex items-center justify-center scale-[0.96] relative">
          <QVersionIcon itemId={item.id} size={110} />
        </div>
      </div>

      <h4 className="text-base font-black text-island-navy tracking-tight leading-tight mb-1.5 truncate">
        {resolved.name}
      </h4>
      {badges}
      {/* 抽獎券這種「是商品、但整包賣」的商品在這裡也要把張數講清楚。飾品沒有 bundleNote,所以
          這一行對它們不會畫任何東西。 */}
      {bundleNote && <div className="mb-2">{bundleNote}</div>}
      <p className="text-island-navy-soft/70 text-xs font-bold leading-relaxed mb-3 line-clamp-3">
        {resolved.description}
      </p>

      <div className="mt-auto border-t border-dashed border-island-line pt-3">{priceRows}</div>
    </div>
  );
}

/**
 * 一種付法,做成一顆按鈕。
 *
 * 沒有 `[-] 1 [+]`(§17):商品本身就是一個固定的組合,數量不是玩家的選擇,所以畫面上不該有一個
 * 讓人以為可以選的控制項。按鈕上寫的是「購買此組合」而不是「購買」。
 *
 * 組合包底下多一行「平均每張 ○○」。它不是折扣廣告 —— 它是玩家判斷「這一檔的組合划不划算」唯一
 * 需要的數字,而且正因為價格**不是**單價 × 張數(constants/limitedShop.ts 的 BundlePricing),
 * 這個數字每一檔都不一樣,才值得寫出來。
 */
function PriceRow({
  price,
  quantity,
  disabled,
  onClick,
}: {
  price: OfferPrice;
  quantity: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const { profile } = useApp();
  const balance = getBalance(profile, price.currency);
  const cannotAfford = balance < price.amount;
  const isBundle = quantity > 1;

  return (
    <div className="space-y-1">
      <Button
        variant={price.currency === 'coins' ? 'secondary' : 'primary'}
        disabled={disabled || cannotAfford}
        onClick={onClick}
        className="w-full py-2.5 text-sm"
        title={cannotAfford ? '餘額不足' : undefined}
      >
        {price.currency === 'coins' ? (
          <Coins size={15} className="text-island-gold" strokeWidth={2.75} />
        ) : (
          <Gem size={15} strokeWidth={2.75} />
        )}
        <span>{price.amount.toLocaleString()}</span>
        <span className="text-xs font-bold opacity-80">{isBundle ? '購買此組合' : '購買'}</span>
      </Button>
      <p className="text-[10px] font-bold text-island-navy-soft/60 text-center">
        {isBundle ? `平均每張 ${Math.round(price.amount / quantity).toLocaleString()}` : price.note}
        {isBundle && price.note ? ` · ${price.note}` : ''}
      </p>
    </div>
  );
}

/**
 * 限時小攤的購買確認。
 *
 * 是 `PurchaseDialog` 的兄弟而不是它裡面的一個分支:那個對話框是繞著一件 `ItemDefinition`、一個
 * 金幣價格、商品碎片路線與稀有度揭示長出來的,而這四件事沒有一件描述得了「一包三張、用碎片買、
 * 本檔限購一次」。兩者共用的是真正重要的那件事 —— **寫入**,一家店一個函數,永遠不是逐張分支。
 */
function LimitedPurchaseDialog({
  resolved,
  price,
  rotationId,
  onClose,
}: {
  resolved: ResolvedOffer;
  price: OfferPrice;
  rotationId: string;
  onClose: () => void;
}) {
  const { profile, buyLimitedOffer } = useApp();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const balance = getBalance(profile, price.currency);
  const after = balance - price.amount;
  const bought = getPurchasedCount(profile?.limitedShop, rotationId, resolved.offer.id);
  const isBundle = resolved.offer.kind === 'card-bundle';

  const confirm = async () => {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    const result: LimitedPurchaseResult = await buyLimitedOffer(resolved.offer.id, price.id);
    setBusy(false);
    if (result === 'ok') {
      setDone(true);
      playSound(SoundEffect.REWARD, 0.4);
      triggerHaptic('medium');
      window.setTimeout(onClose, 900);
      return;
    }
    setError(LIMITED_PURCHASE_MESSAGES[result]);
  };

  return (
    // z-[80]：這一頁本地層級的最上層 —— 見上面的卡牌背包。
    <ModalOverlay zIndexClassName="z-[80]" onClick={onClose}>
      <ModalShell maxWidthClassName="max-w-md">
        <PanelHeader
          icon={<Tent size={20} strokeWidth={2.5} />}
          title={isBundle ? '確認購買組合包' : '確認購買'}
          subtitle="限時小攤 · 本檔限定"
          onClose={onClose}
        />

        <div className="p-6 space-y-5">
          <div className="flex items-center gap-4">
            <div
              className="w-20 h-20 rounded-2xl bg-island-cream-2 border rarity-well flex items-center justify-center relative overflow-hidden flex-shrink-0"
              style={rarityStyleVars(resolved.rarity)}
            >
              <RarityAura rarity={resolved.rarity} />
              <div className="relative flex items-center justify-center">
                {resolved.card ? (
                  <UtilityCardArt card={resolved.card} size={48} />
                ) : resolved.item ? (
                  <div className="scale-[0.5]">
                    <QVersionIcon itemId={resolved.item.id} size={110} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-black text-island-navy tracking-tight truncate">
                {resolved.name}
                {isBundle && (
                  <span className="text-island-teal-dark"> × {resolved.quantity}</span>
                )}
              </h3>
              {resolved.card ? (
                <UtilityCardMeta card={resolved.card} className="mt-1.5" />
              ) : (
                <p className="text-xs font-bold text-island-navy-soft/70 mt-1 line-clamp-2">
                  {resolved.description}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-island-line bg-island-cream-2 p-4 space-y-2">
            {/* 組合包最上面先講「會拿到幾張」,再講錢。玩家最容易誤會的就是這一格。 */}
            {isBundle && (
              <Row
                label="購買後獲得"
                value={
                  <span className="text-sm font-black text-island-teal-dark">
                    {resolved.name} × {resolved.quantity} 張
                  </span>
                }
              />
            )}
            <Row
              label={isBundle ? '整包價格' : '價格'}
              value={<CurrencyChip amount={price.amount} currency={chipKind(price.currency)} />}
            />
            <Row label="目前持有" value={<CurrencyChip amount={balance} currency={chipKind(price.currency)} />} />
            <Row
              label="購買後"
              value={<CurrencyChip amount={Math.max(0, after)} currency={chipKind(price.currency)} />}
            />
            {resolved.offer.purchaseLimit !== null && (
              <Row
                label="本檔限購"
                value={
                  <span className="text-sm font-black text-island-navy">
                    {bought}/{resolved.offer.purchaseLimit}
                  </span>
                }
              />
            )}
          </div>

          {error && (
            <p className="text-xs font-black text-island-coral bg-island-coral/10 border border-island-coral/25 rounded-2xl px-4 py-2.5">
              {error}
            </p>
          )}

          <div className="flex gap-2.5">
            <Button variant="secondary" onClick={onClose} className="flex-1 py-3">
              <X size={16} strokeWidth={2.75} />
              <span>取消</span>
            </Button>
            <Button
              variant="primary"
              disabled={busy || after < 0}
              onClick={confirm}
              className="flex-1 py-3"
            >
              <Check size={16} strokeWidth={2.75} />
              <span>{done ? '已購買' : busy ? '購買中…' : '確認購買'}</span>
            </Button>
          </div>
        </div>
      </ModalShell>
    </ModalOverlay>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold text-island-navy-soft/70">{label}</span>
      {value}
    </div>
  );
}
