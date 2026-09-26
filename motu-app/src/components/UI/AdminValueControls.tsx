/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 管理員數值調整 — the developer's hands on the save's numbers.
 *
 * What 管理員測試模式 is FOR: putting the account into whatever state a test needs, without
 * grinding for it and without editing Firestore by hand. Both shapes below live in the
 * 管理員測試 console's 玩家數值 category (components/UI/admin/), behind the one `<AdminOnly>` gate
 * at its mount — see constants/adminFeatures.ts. Until 2026-09-06 the quick row hung off the
 * player's own profile card in TopBar and the editor sat inside 帳號中心; neither is there now.
 *
 * Two shapes over one write path:
 *
 *   <AdminSupplyButtons />   the +10K 金幣 / +100 碎片 / +1K XP / +5 券 quick row
 *   <AdminValuePanel />      金幣, 碎片, 經驗值 and 抽獎券 set to an exact typed figure
 *
 * Both go through AppContext (`addGold`/`addFragments`/`addXp` add, `setGold`/`setFragments`/
 * `setXp` assign) and both REPORT a refused write with `describeRecentFailure`, because a mute
 * button and a broken button look identical from the outside — that was the whole of
 * 「按了沒反應」. A quick button and a typed figure differ only in what number is sent; neither has
 * a private path to the save.
 *
 * The adds route through the Economy Service's `grantReward` with `source: 'admin-test'`, which is
 * the only source the currency policy (constants/rewards.ts) permits to pay BOTH currencies. The
 * exact-figure setters deliberately do not: writing a balance to 0 is not a grant, and forcing it
 * through a path whose policy is about earning would need either a fake negative reward or a
 * special case in the policy itself.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Coins, Gem, TrendingUp, Wrench, Check, Gift, Loader2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { getBalance } from '../../constants/currency';
import { getRaffleTickets } from '../../constants/fragments';
import { RaffleTicket } from './FragmentProgress';
import { playSound, SoundEffect } from '../../lib/soundUtils';
import { describeRecentFailure } from '../../lib/saveStatus';
import { ADMIN_VALUE_MAX } from '../../context/useEconomyActions';
import { levelFromXp } from '../../utils/level';

/** One tap on any control: run the write, and say why if the save refused it. */
function useAdminWrite() {
  const { showIslandAlert } = useApp();
  return async (run: () => Promise<boolean>) => {
    playSound(SoundEffect.CLICK);
    if (!(await run())) showIslandAlert(describeRecentFailure());
  };
}

const chipClass =
  'px-2 py-1 rounded-lg border text-[10px] font-black leading-none transition-all active:scale-95 cursor-pointer';

/**
 * The quick row. The two original amounts are unchanged — 10000 金幣 and
 * 1000 XP — because that is what the labels promise, and a button whose label and effect disagree
 * is the bug this pass was opened for.
 *
 * 碎片 joined them at +100, two orders of magnitude below the gold button. That is not timidity;
 * it is the scale the currency actually lives on (a whole seven-day 每日登入 round pays 156), and a
 * +10,000 碎片 button would make every test state meaningless. Testing 「碎片不夠」 needs a small
 * step far more often than testing 「碎片很多」 does — and the exact-figure editor below is there
 * for whichever number a test actually wants.
 */
export function AdminSupplyButtons({ goldLabel, compact = false }: { goldLabel: string; compact?: boolean }) {
  const { addGold, addFragments, addXp, addRaffleTickets } = useApp();
  const write = useAdminWrite();

  return (
    <div className="flex flex-col gap-1.5 pt-1.5 border-t border-dashed border-island-line">
      <div className="flex items-center gap-1 px-0.5" title="管理員測試模式專用：直接調整存檔內的數值">
        <Wrench size={compact ? 9 : 10} className="text-island-navy-soft/70 shrink-0" />
        <span className="text-[8px] font-black text-island-navy-soft/70 uppercase tracking-wider leading-none">管理員數值調整</span>
      </div>
      {/* Wraps rather than squeezing. Four buttons fit one row in the console's desktop width and
          do not in its narrowest tier (min(19rem, 46vw) on a tablet), where an unwrapped row would
          push its last button past the panel. `flex-wrap` + a `basis` floor lets it fall to 2x2
          exactly when it has to, and changes nothing in the wide context. This was written for
          TopBar's even narrower ~170px fold and earns its keep unchanged in the panel. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void write(() => addGold(10000))}
          className="flex-1 basis-16 flex items-center justify-center gap-1 bg-island-gold/12 hover:bg-island-gold/20 border border-island-gold/35 px-2 py-1.5 rounded-xl transition-all active:scale-95 cursor-pointer font-black text-island-navy text-[10px] leading-tight"
          title="管理員：增加 10000 金幣"
        >
          <Coins className="text-island-gold" size={11} />
          <span>{goldLabel}</span>
        </button>
        <button
          onClick={() => void write(() => addFragments(100))}
          className="flex-1 basis-16 flex items-center justify-center gap-1 bg-island-teal/10 hover:bg-island-teal/18 border border-island-teal/30 px-2 py-1.5 rounded-xl transition-all active:scale-95 cursor-pointer font-black text-island-navy text-[10px] leading-tight"
          title="管理員：增加 100 碎片"
        >
          <Gem className="text-island-teal-dark" size={11} />
          <span>+100</span>
        </button>
        <button
          onClick={() => void write(() => addXp(1000))}
          className="flex-1 basis-16 flex items-center justify-center gap-1 bg-island-teal/10 hover:bg-island-teal/18 border border-island-teal/30 px-2 py-1.5 rounded-xl transition-all active:scale-95 cursor-pointer font-black text-island-navy text-[10px] leading-tight"
          title="管理員：增加 1000 XP"
        >
          <TrendingUp className="text-island-teal" size={11} />
          <span>+1K XP</span>
        </button>
        {/* 抽獎券. +5 rather than the gold button's four figures, and for the same reason 碎片 is
            +100: five is five spins, which is enough to watch the wheel land on something rare
            without making 「券不夠」 — the state the wheel's zero-ticket UI exists for — unreachable
            for the rest of the session. */}
        <button
          onClick={() => void write(() => addRaffleTickets(5))}
          className="flex-1 basis-16 flex items-center justify-center gap-1 bg-island-gold/12 hover:bg-island-gold/20 border border-island-gold/35 px-2 py-1.5 rounded-xl transition-all active:scale-95 cursor-pointer font-black text-island-navy text-[10px] leading-tight"
          title="管理員：增加 5 張抽獎券"
        >
          <RaffleTicket size={11} />
          <span>+5 券</span>
        </button>
      </div>
    </div>
  );
}

/**
 * One editable number: what it is now, a few one-tap steps, and a field for the exact figure.
 *
 * The field is seeded from the live value and re-seeds whenever that value changes from elsewhere
 * (a quick button, a purchase, the realtime listener), so it always shows what is actually saved
 * rather than whatever was last typed into it. An empty field is treated as "no change" and the
 * 設定 button is disabled, rather than silently meaning zero — 歸零 is its own button on purpose.
 */
function ValueRow({
  label,
  hint,
  value,
  accent,
  icon,
  steps,
  onAdd,
  onSet,
}: {
  label: string;
  hint: string;
  value: number;
  accent: 'gold' | 'teal';
  icon: ReactNode;
  steps: number[];
  onAdd: (amount: number) => Promise<boolean>;
  onSet: (next: number) => Promise<boolean>;
}) {
  const write = useAdminWrite();
  const [draft, setDraft] = useState(String(value));
  const [justApplied, setJustApplied] = useState(false);

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const parsed = Number(draft);
  const canApply = draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0;

  const apply = async () => {
    if (!canApply) return;
    await write(() => onSet(parsed));
    setJustApplied(true);
    window.setTimeout(() => setJustApplied(false), 1200);
  };

  const tone =
    accent === 'gold'
      ? 'bg-island-gold/12 hover:bg-island-gold/22 border-island-gold/35 text-island-navy'
      : 'bg-island-teal/10 hover:bg-island-teal/20 border-island-teal/30 text-island-navy';

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {icon}
          <span className="text-[11px] font-black text-island-navy">{label}</span>
        </div>
        <span className="text-[11px] font-black font-mono text-island-navy tabular-nums">
          {value.toLocaleString()}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {steps.map(step => (
          <button
            key={step}
            onClick={() => void write(() => onAdd(step))}
            className={`${chipClass} ${tone}`}
            title={`管理員：增加 ${step} ${label}`}
          >
            +{step.toLocaleString()}
          </button>
        ))}
        <button
          onClick={() => void write(() => onSet(0))}
          className={`${chipClass} bg-white hover:bg-island-coral/10 border-island-line text-island-navy-soft`}
          title={`管理員：把${label}歸零`}
        >
          歸零
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={0}
          max={ADMIN_VALUE_MAX}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void apply();
          }}
          className="flex-1 min-w-0 px-2 py-1.5 rounded-xl bg-white border border-island-line text-[11px] font-black font-mono text-island-navy tabular-nums outline-none focus:border-island-teal/60"
          aria-label={`設定${label}`}
        />
        <button
          onClick={() => void apply()}
          disabled={!canApply}
          className={`${chipClass} px-3 py-2 ${
            canApply
              ? 'bg-island-navy text-white border-island-navy hover:opacity-90'
              : 'bg-island-line/40 text-island-navy-soft/60 border-island-line cursor-not-allowed'
          }`}
          title={`管理員：把${label}直接設定成輸入的數值`}
        >
          {justApplied ? <Check size={12} /> : '設定'}
        </button>
      </div>

      <span className="text-[9px] text-island-navy-soft/80 leading-tight">{hint}</span>
    </div>
  );
}

/**
 * 一鍵擁有全部商品 — the bottom of the 管理員 panel.
 *
 * Same idea as the gold/XP rows above, one step further along: instead of handing over enough
 * money to buy the shop, it hands over the shop. Everything a test needs to SEE — every card in
 * its 已擁有 form, every wearable in the dressing room, every piece of furniture in the drawer —
 * is one press away instead of ~100 purchases.
 *
 * It only ever adds (see `grantAllItems` in context/useShopActions.ts): gold is not spent, worn
 * items and placements are untouched, and a second press grants nothing because the first one
 * already covered everything. That is why this has no confirm() while 清空裝備 does — there is
 * nothing here to undo.
 *
 * It REPORTS, like every other control in this file: how many ids were added, that everything
 * was already owned, or — via `describeRecentFailure` — why the save refused, because a mute
 * button and a broken button look identical from the outside.
 */
export function GrantAllItemsButton() {
  const { grantAllItems, showIslandAlert } = useApp();
  const [busy, setBusy] = useState(false);
  const [justGranted, setJustGranted] = useState(false);

  const run = async () => {
    if (busy) return;
    playSound(SoundEffect.CLICK);
    setBusy(true);
    const result = await grantAllItems();
    setBusy(false);

    if (!result.ok) {
      showIslandAlert(describeRecentFailure());
      return;
    }
    if (result.granted === 0) {
      showIslandAlert('商店裡的商品你已經全部擁有了。');
      return;
    }
    playSound(SoundEffect.REWARD, 0.4);
    showIslandAlert(`已解鎖 ${result.granted} 件商品 — 商店裡的東西現在全都是你的了。`);
    setJustGranted(true);
    window.setTimeout(() => setJustGranted(false), 1600);
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="flex items-center gap-1.5">
        <Gift size={13} className="text-island-teal" />
        <span className="text-[11px] font-black text-island-navy">全部商品</span>
      </div>

      <button
        onClick={() => void run()}
        disabled={busy}
        className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-[11px] font-black leading-none transition-all active:scale-95 ${
          busy
            ? 'bg-island-line/40 text-island-navy-soft/60 border-island-line cursor-not-allowed'
            : 'bg-island-navy text-white border-island-navy hover:opacity-90 cursor-pointer'
        }`}
        title="管理員：立即擁有商店裡的每一件商品（免費，不扣金幣）"
      >
        {busy ? (
          <Loader2 size={12} className="animate-spin" />
        ) : justGranted ? (
          <Check size={12} />
        ) : (
          <Gift size={12} />
        )}
        <span>{busy ? '解鎖中…' : '立即擁有全部商品'}</span>
      </button>

      <span className="text-[9px] text-island-navy-soft/80 leading-tight">
        每件商品各發一份、不扣金幣，也不會動到已穿戴與已擺放的東西。重複按不會重複發放。
      </span>
    </div>
  );
}

/**
 * The full editor. Lives in the 管理員測試 console's 玩家數值 category (UI/admin/).
 *
 * `showGrantAll` exists because 全部商品 is not a number: it changes what the save OWNS, and in the
 * console that belongs with the rest of the shop controls (擁有全部商品開關, 清空裝備) rather than
 * under the four balances. It defaults to `true` so any other caller keeps the original panel.
 */
export function AdminValuePanel({ showGrantAll = true }: { showGrantAll?: boolean } = {}) {
  const {
    profile, addGold, addFragments, addXp, setGold, setFragments, setXp,
    addRaffleTickets, setRaffleTickets,
  } = useApp();
  if (!profile) return null;

  const gold = getBalance(profile, 'coins');
  const fragments = getBalance(profile, 'fragments');
  const xp = profile.currentXp ?? 0;
  const tickets = getRaffleTickets(profile);

  return (
    <div className="flex flex-col gap-2">
      <ValueRow
        label="金幣"
        hint={`直接寫入存檔，上限 ${ADMIN_VALUE_MAX.toLocaleString()}。`}
        value={gold}
        accent="gold"
        icon={<Coins size={13} className="text-island-gold" />}
        steps={[100, 1000, 10000]}
        onAdd={addGold}
        onSet={setGold}
      />
      {/* 碎片.

          A separate row rather than a mode on the 金幣 one, and the steps are an order of magnitude
          smaller (10/100/1,000 against 100/1,000/10,000) because the two currencies are on genuinely
          different scales: a full seven-day 每日登入 round pays 156 碎片, where a single workout can
          pay hundreds of 金幣. Reusing the gold steps here would make every test state absurd.

          Both currencies are editable because 管理員測試模式 exists to put the save into whatever
          state a test needs — and `admin-test` is the one reward source the currency policy lets
          pay either (constants/rewards.ts). That is not a hole in 「金幣只能來自健身」: it is the
          rule naming its one exception, and the exception is invisible to players (AdminOnly). */}
      <ValueRow
        label="碎片"
        hint={`非健身型獎勵的資源。一輪七天簽到約 156 碎片，上限 ${ADMIN_VALUE_MAX.toLocaleString()}。`}
        value={fragments}
        accent="teal"
        icon={<Gem size={13} className="text-island-teal-dark" />}
        steps={[10, 100, 1000]}
        onAdd={addFragments}
        onSet={setFragments}
      />
      <ValueRow
        label="經驗值 XP"
        hint={`等級由累計 XP 換算（每 100 XP 一級），目前為 LV.${levelFromXp(xp)}。`}
        value={xp}
        accent="teal"
        icon={<TrendingUp size={13} className="text-island-teal" />}
        steps={[100, 1000, 10000]}
        onAdd={addXp}
        onSet={setXp}
      />
      {/* 抽獎券.
          A row of its own rather than a third currency, because it is not one: tickets live in
          their own save field and are spent at exactly one place (幸運轉盤). The steps are the
          smallest on this panel — 1 / 5 / 20 — because that IS the scale: one is a spin, and the
          shop sells them one at a time. Testing the wheel usually needs a handful, not a hoard,
          and the exact-figure field is right there for 0 (which is its own test: the wheel's
          「抽獎券不足」 state). */}
      <ValueRow
        label="抽獎券"
        hint={`幸運轉盤的入場券，一張轉一次。上限 ${ADMIN_VALUE_MAX.toLocaleString()}。`}
        value={tickets}
        accent="gold"
        icon={<RaffleTicket size={13} />}
        steps={[1, 5, 20]}
        onAdd={addRaffleTickets}
        onSet={setRaffleTickets}
      />
      {/* Last row on purpose: it is the one control here that changes what the save OWNS rather
          than what it is worth, so it sits below the number editors. In the console it is hoisted
          out to 商店與經濟 instead — see `showGrantAll`. */}
      {showGrantAll && <GrantAllItemsButton />}
    </div>
  );
}
