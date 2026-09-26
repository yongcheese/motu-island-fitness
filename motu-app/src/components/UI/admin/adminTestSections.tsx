/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 管理員測試面板的資訊架構 — the six categories, and what is inside each one.
 *
 * ## Why this file is a list and not a pile of JSX
 *
 * The problem this console was opened to fix is not that the Admin controls looked bad; it is that
 * there was no ANSWER to 「有哪些類型的測試功能」. They were scattered across seven screens
 * (TopBar, AccountPanel, ShopView twice, PetCarePanel, UtilityCard, SettingsView) and the only way
 * to learn what existed was to turn the mode on and go hunting for what had changed.
 *
 * So the categories are data. The panel renders the LIST first and a category second, which means
 * the front page of the console is a table of contents rather than a wall of buttons, and adding a
 * test control later means adding it to a category here rather than finding a corner of the game
 * UI to hang it on.
 *
 * ## The categories are the ones that exist, not the ones that sound complete
 *
 * There is no 房屋與建造 category, because 建造模式 has no Admin-only control — the only thing
 * 管理員測試模式 changes in there is that the four 小天使 guides replay, which is a TUTORIAL
 * behaviour and is reported under 新手與登入流程 with the rest of them. An empty category with a
 * promising name is worse than no category: it sends a tester looking for a switch that was never
 * built. Same reason there is no 天氣 / 時間 / NPC category — those are ordinary game systems with
 * no test-only surface today. See constants/adminFeatures.ts, which remains the registry of record.
 *
 * `entries` is written down rather than derived because a category's controls are not a uniform
 * list — 場景 is one imported panel plus one switch, 玩家數值 is one quick row plus four editors —
 * and a count taken off the DOM would say something different from what a reader would count.
 */

import { useState, type ReactNode } from 'react';
import {
  Coins,
  Dices,
  Dumbbell,
  Eye,
  Gift,
  GraduationCap,
  PawPrint,
  RotateCcw,
  Sailboat,
  Sprout,
  Store,
  Ticket,
  Trash2,
  Trophy,
  Wrench,
} from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { playSound, SoundEffect } from '../../../lib/soundUtils';
import { describeRecentFailure } from '../../../lib/saveStatus';
import { resetOwnedContent } from '../../../lib/adminSaveReset';
import { RARITY_OVERRIDE, UNOWNED_OVERRIDE } from '../../../utils/debugOverrides';
import { PET_CONDITION_BANDS } from '../../../constants/petCare';
import { MERCHANTS, getMerchantShop } from '../../../constants/merchants';
import { merchantAlwaysDocked } from '../../../constants/merchantVisit';
import { useMerchantVisits } from '../../../hooks/useMerchantVisit';
import { AdminIslandControls } from '../AdminIslandControls';
import { AdminWorkoutRewardControls } from '../AdminWorkoutRewardControls';
import { AdminSupplyButtons, AdminValuePanel, GrantAllItemsButton } from '../AdminValueControls';
import { AdminOwnAllItemsRow } from '../settings/AdminOwnAllItemsRow';
import { Button, Toggle } from '../DesignKit';
import { useAdminTest } from './AdminTestContext';
import { AdminActionButton, AdminGroup, AdminStatePill, AdminStatusRow } from './AdminTestKit';

export interface AdminSection {
  id: string;
  label: string;
  /** One line on the category card — what a tester comes to this category FOR. */
  tagline: string;
  icon: ReactNode;
  /** Named controls, listed on the card so the front page says what is inside without opening it. */
  entries: string[];
  Body: () => ReactNode;
}

// --- 場景與環境 -------------------------------------------------------------

/**
 * The 鏡頭遠近轉盤's visibility switch.
 *
 * The dial is Admin-only and always has been (constants/adminFeatures.ts), but until now 「admin
 * mode is on」 and 「the dial is on screen」 were the same fact, so the one piece of Admin chrome
 * that actually sits over the game had no off switch. It has one now, and the switch reports which
 * state it is in rather than leaving it to be read off the corner of the screen.
 *
 * Zoom itself is untouched either way — the wheel, pinch, and the first-person crossover all run
 * through constants/cameraZoom.ts and never through this dial.
 */
function ZoomDialSwitch() {
  const { showZoomDial, setShowZoomDial } = useAdminTest();
  return (
    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="min-w-0">
        <span className="block text-[11px] font-black text-island-navy leading-tight">
          在畫面右側顯示轉盤
        </span>
        <span className="block text-[10px] font-bold text-island-navy-soft/80 leading-snug mt-0.5">
          {showZoomDial
            ? '目前顯示中：轉盤在畫面右緣，新手引導第四站也會講到它。'
            : '目前已隱藏：滑鼠滾輪、雙指捏合與第一人稱切換全部照常，只是畫面上沒有轉盤。'}
        </span>
      </div>
      <Toggle
        checked={showZoomDial}
        onChange={(next) => {
          playSound(SoundEffect.CLICK);
          setShowZoomDial(next);
        }}
      />
    </div>
  );
}

function SceneSection() {
  const { showZoomDial } = useAdminTest();
  return (
    <>
      <AdminGroup
        icon={<Sprout size={14} />}
        title="離線回歸測試"
        note="會寫入存檔的 islandState（只有這一個欄位）；「畫面飽和」那一排完全不寫入。"
      >
        <AdminIslandControls />
      </AdminGroup>

      <AdminGroup
        icon={<Eye size={14} />}
        title="鏡頭遠近轉盤"
        note="只影響畫面上的轉盤，不影響縮放功能本身。不寫入存檔。"
        state={
          <AdminStatePill tone={showZoomDial ? 'on' : 'off'}>
            {showZoomDial ? '顯示中' : '已隱藏'}
          </AdminStatePill>
        }
      >
        <ZoomDialSwitch />
      </AdminGroup>
    </>
  );
}

// --- 玩家數值 ---------------------------------------------------------------

function PlayerSection() {
  return (
    <>
      <AdminGroup
        icon={<Wrench size={14} />}
        title="快捷加值"
        note="一鍵加值，走的是正式的發放路徑（source 標記為 admin-test）。會寫入存檔。"
      >
        <div className="p-3 rounded-2xl bg-island-cream-2 border border-island-line">
          <AdminSupplyButtons goldLabel="+10K 金幣" />
        </div>
      </AdminGroup>

      <AdminGroup
        icon={<Coins size={14} />}
        title="精準數值調整"
        note="金幣、碎片、經驗值、抽獎券各自可加值、歸零或直接寫成指定數字。會寫入存檔。等級沒有獨立欄位，由累計 XP 換算。"
      >
        <AdminValuePanel showGrantAll={false} />
      </AdminGroup>
    </>
  );
}

// --- 商店與經濟 -------------------------------------------------------------

/**
 * 模擬輪盤抽獎 / 重置功能卡 — moved out of the 功能卡背包.
 *
 * They were at the bottom of a bag that is itself only reachable through the 限時小攤, which is
 * only reachable while the travelling merchant is moored on the beach. That gate is deliberate for
 * the SHOP (see docs/traveling-merchant.md), but it was never meant to gate the test buttons: it
 * made 「重置功能卡」 unreachable for roughly twenty hours of every fourteen-day rotation. Here they
 * are always reachable, and they still run the real wheel table and the real grant path.
 */
function UtilityCardControls() {
  const { spinWheel, resetUtilityCards, showIslandAlert } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <div className="flex flex-wrap gap-2">
        <AdminActionButton
          tone="teal"
          icon={<Dices size={12} strokeWidth={2.75} />}
          label="模擬輪盤抽獎"
          disabled={busy}
          title="管理員：跑一次真正的輪盤加權抽選與發放，不是直接塞一張卡"
          onClick={() => {
            void (async () => {
              playSound(SoundEffect.CLICK);
              setBusy(true);
              const result = await spinWheel();
              setBusy(false);
              setMessage(
                result.ok ? `輪盤：${result.prize.label}` : `輪盤沒有發出獎勵（${result.reason}）`,
              );
            })();
          }}
        />
        <AdminActionButton
          tone="danger"
          icon={<RotateCcw size={12} strokeWidth={2.75} />}
          label="重置功能卡"
          disabled={busy}
          title="管理員：清空持有數量、進行中的效果與使用次數統計（不退錢、不補卡）"
          onClick={() => {
            void (async () => {
              playSound(SoundEffect.CLICK);
              setBusy(true);
              const ok = await resetUtilityCards();
              setBusy(false);
              if (!ok) {
                showIslandAlert(describeRecentFailure());
                return;
              }
              setMessage('功能卡狀態已重置');
            })();
          }}
        />
      </div>
      {message && (
        <span className="text-[10px] font-black text-island-teal-dark leading-snug">{message}</span>
      )}
      <span className="text-[9px] text-island-navy-soft/80 leading-tight">
        這裡刻意沒有「發一張卡」的按鈕：要測效果就抽或買，因為那才是玩家會走的路。
      </span>
    </div>
  );
}

/** 清空裝備 — the console's one destructive control, and the only one that asks first. */
function ResetOwnedContentControl() {
  const { profile, showIslandAlert } = useApp();
  const [busy, setBusy] = useState(false);

  const run = () => {
    if (!profile || busy) return;
    if (
      !window.confirm(
        '警告：確定要清空裝備嗎？這會刪除背包內所有物品、清空室內家具與島上擺設，並重設角色裝扮與地板／牆面樣式。金幣、碎片、經驗值與抽獎券不受影響。此操作無法復原。',
      )
    ) {
      return;
    }
    void (async () => {
      playSound(SoundEffect.CLICK);
      setBusy(true);
      const result = await resetOwnedContent(profile.userId);
      setBusy(false);
      if (!result.ok) {
        showIslandAlert(result.error ?? describeRecentFailure());
        return;
      }
      playSound(SoundEffect.REWARD, 0.4);
      showIslandAlert('已清空背包、裝扮、室內家具與島上擺設。');
    })();
  };

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <AdminActionButton
        full
        tone="danger"
        icon={<Trash2 size={12} strokeWidth={2.75} />}
        label={busy ? '清空中…' : '清空裝備（重置存檔內容）'}
        disabled={busy || !profile}
        title="管理員：清空背包、裝扮、室內家具與島上擺設"
        onClick={run}
      />
      <span className="text-[9px] text-island-navy-soft/80 leading-tight">
        清掉的是「東西」不是「錢」：背包、已穿戴、室內家具、地板與牆面樣式、島上擺設（含房屋）。
        金幣、碎片、經驗值、抽獎券、寵物照護、登入與健身紀錄都不會動到。這是面板上唯一會二次確認的按鈕。
      </span>
    </div>
  );
}

/** What `?unown=` / `?rarity=` are doing to this session, if anything. */
function UrlOverrideStatus() {
  const unowned = [...UNOWNED_OVERRIDE];
  const rarities = [...RARITY_OVERRIDE.entries()];

  return (
    <div className="p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <AdminStatusRow
        label="?unown= 未擁有覆寫"
        detail={unowned.length > 0 ? unowned.join('、') : '把指定商品當成還沒買，用來看購買按鈕與上鎖狀態'}
        state={
          <AdminStatePill tone={unowned.length > 0 ? 'warn' : 'off'}>
            {unowned.length > 0 ? `生效中 ${unowned.length}` : '未使用'}
          </AdminStatePill>
        }
      />
      <AdminStatusRow
        label="?rarity= 稀有度覆寫"
        detail={
          rarities.length > 0
            ? rarities.map(([id, tier]) => `${id}:${tier}`).join('、')
            : '只改卡片的塗裝，不動價格、庫存、擁有狀態或獎勵池'
        }
        state={
          <AdminStatePill tone={rarities.length > 0 ? 'warn' : 'off'}>
            {rarities.length > 0 ? `生效中 ${rarities.length}` : '未使用'}
          </AdminStatePill>
        }
      />
      <p className="text-[9px] text-island-navy-soft/80 leading-tight pt-2">
        這兩個是網址參數，不受管理員測試模式控制（它們必須在純函式裡就能回答，讀不到帳號設定）。
        兩者都只會「拿掉」擁有權或改變塗裝，永遠不會發出物品，重新整理即失效。
      </p>
    </div>
  );
}

/**
 * 問船的行程 —— 唯讀。
 *
 * 這一區沒有按鈕，因為「商船一直停靠」不是一個可以單獨按的開關 —— 它就是管理員測
 * 試模式本身（見 components/UI/admin/AdminMerchantDock.tsx）。所以這裡要回答的是另一件事：
 * 現在看到的那艘船，到底是被釘住的還是正式行程列的，以及關掉之後玩家會看到什麼。
 *
 * 天數是算出來的（一檔長度 × 行程比例）而不是寫在這裡的「3」與「4」：面板講的必須是
 * 設定檔現在真正的值，否則有人把檔期改回 14 天之後，這裡會是全遊戲唯一一個還在說謊的地方。
 */
function MerchantScheduleStatus() {
  const visits = useMerchantVisits();
  const pinned = merchantAlwaysDocked();

  const spec = MERCHANTS[0];
  const periodDays = getMerchantShop(spec).periodLengthMs() / 86_400_000;
  const awayRatio = spec.schedule.arrivesAfter + spec.schedule.departsBefore;
  const dockedDays = periodDays * (1 - awayRatio);
  const awayDays = periodDays * awayRatio;
  const days = (value: number) =>
    Number.isInteger(Number(value.toFixed(2))) ? value.toFixed(0) : value.toFixed(1);

  const visit = visits.find((entry) => entry.merchantId === spec.id) ?? null;
  const phaseLabel =
    visit?.phase === 'visiting' ? '停靠中' : visit?.phase === 'awaited' ? '尚未抵達' : '已離開';

  return (
    <div className="p-3 rounded-2xl bg-island-cream-2 border border-island-line">
      <AdminStatusRow
        label="商船一直停靠岸邊"
        detail="行程被拿掉，不用等四天就能再跟商人講話。關掉管理員測試模式即恢復正式行程。"
        state={
          <AdminStatePill tone={pinned ? 'on' : 'off'}>{pinned ? '生效中' : '未生效'}</AdminStatePill>
        }
      />
      <AdminStatusRow
        label="正式行程"
        detail={`停 ${days(dockedDays)} 天 → 離開 ${days(awayDays)} 天 → 再停 ${days(dockedDays)} 天（一檔 ${days(periodDays)} 天）`}
        state={<AdminStatePill tone="off">{`${days(dockedDays)} / ${days(awayDays)}`}</AdminStatePill>}
      />
      <AdminStatusRow
        label="這一趟造訪"
        detail={visit ? `${visit.visitId}（貨架跟著這一檔換）` : '名單上沒有商人'}
        state={<AdminStatePill tone={visit?.open ? 'on' : 'off'}>{phaseLabel}</AdminStatePill>}
      />
      <p className="text-[9px] text-island-navy-soft/80 leading-tight pt-2">
        釘住的是「他在不在」，不是時間。貨架照樣每一檔換一批、造訪 id 照樣會換，
        所以換檔那一刻（這家店最容易出錯的地方）在這個模式下依然測得到。
      </p>
    </div>
  );
}

function EconomySection() {
  const { settings } = useApp();
  const ownAll = !!settings?.adminOwnAllItems;

  return (
    <>
      <AdminGroup
        icon={<Gift size={14} />}
        title="全部商品"
        note="不扣金幣、不檢查等級解鎖。開關版可以還原，按鈕版是單向的。會寫入存檔。"
        state={
          <AdminStatePill tone={ownAll ? 'on' : 'off'}>{ownAll ? '已開啟' : '已關閉'}</AdminStatePill>
        }
      >
        {/* AdminOwnAllItemsRow brings its own surface (SettingRow paints the cream card, the
            border and the radius), so it is dropped in bare — a wrapper here would draw a second
            border around the first. */}
        <AdminOwnAllItemsRow />
        <div className="pt-2">
          <GrantAllItemsButton />
        </div>
      </AdminGroup>

      <AdminGroup
        icon={<Ticket size={14} />}
        title="輪盤與功能卡"
        note="輪盤走真正的加權抽選與發放路徑；重置只清狀態，不退錢也不補卡。會寫入存檔。"
      >
        <UtilityCardControls />
      </AdminGroup>

      <AdminGroup
        icon={<Sailboat size={14} />}
        title="商船行程"
        note="唯讀。這一區不做任何寫入，只是把目前生效中的行程規則說出來。"
      >
        <MerchantScheduleStatus />
      </AdminGroup>

      <AdminGroup
        icon={<Eye size={14} />}
        title="網址覆寫狀態"
        note="唯讀。這一區不做任何寫入，只是把目前生效中的覆寫說出來。"
      >
        <UrlOverrideStatus />
      </AdminGroup>

      <AdminGroup
        icon={<Trash2 size={14} />}
        title="清空裝備"
        note="無法復原，會二次確認。只清內容物，不動任何餘額。"
      >
        <ResetOwnedContentControl />
      </AdminGroup>
    </>
  );
}

// --- 健身與獎勵 -------------------------------------------------------------

function WorkoutSection() {
  return (
    <AdminGroup
      icon={<Dumbbell size={14} />}
      title="健身獎勵測試"
      note="「模擬完成健身」發出的是真正的完成事件，走完整的獎勵流程；「抽獎預覽」不寫入任何東西。"
    >
      <AdminWorkoutRewardControls />
    </AdminGroup>
  );
}

// --- 寵物 -------------------------------------------------------------------

/**
 * 直接設定寵物狀態 — moved out of 寵物照護面板, which is itself only reachable while a companion
 * is out. The write path is unchanged (context/usePetCare.ts), so what a tester sees is what a
 * player in that condition sees.
 */
function PetSection() {
  const { profile, setPetCare, showIslandAlert } = useApp();
  const care = profile?.islandState?.pet?.care;
  const [applied, setApplied] = useState<string | null>(null);

  const pct = (value: number | undefined) =>
    typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';

  return (
    <AdminGroup
      icon={<PawPrint size={14} />}
      title="寵物照護狀態"
      note="直接把飽足與活動力設定到指定區間，走的是正式的照護寫入路徑。會寫入存檔。"
      state={
        <AdminStatePill tone={care ? 'info' : 'off'}>{care ? '已有紀錄' : '尚未建立'}</AdminStatePill>
      }
    >
      <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-bold text-island-navy-soft">
          <span>
            飽足：<span className="font-mono text-island-navy">{pct(care?.nutrition)}</span>
          </span>
          <span>
            活動力：<span className="font-mono text-island-navy">{pct(care?.energy)}</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-2 pt-1.5 border-t border-dashed border-island-line">
          {PET_CONDITION_BANDS.map((band) => (
            <Button
              key={band.id}
              variant="secondary"
              className="px-3 py-1.5 text-[11px]"
              title={band.note}
              onClick={() => {
                void (async () => {
                  playSound(SoundEffect.CLICK);
                  // Just above the band's own floor, so the state lands INSIDE the band being
                  // tested rather than on the boundary between it and the one below.
                  const level = Math.min(1, band.fromActivity + 0.05);
                  const ok = await setPetCare(level, level);
                  if (!ok) {
                    showIslandAlert(describeRecentFailure());
                    return;
                  }
                  setApplied(band.id);
                  window.setTimeout(() => setApplied((k) => (k === band.id ? null : k)), 1400);
                })();
              }}
            >
              {applied === band.id ? '已套用' : band.label}
            </Button>
          ))}
        </div>
        <span className="text-[9px] text-island-navy-soft/80 leading-tight">
          沒有「殺死寵物」的按鈕，因為沒有那個狀態。設定後回島上看牠怎麼動，就是玩家會看到的樣子。
        </span>
      </div>
    </AdminGroup>
  );
}

// --- 新手與登入流程 ---------------------------------------------------------

/**
 * The category with the most STATUS and the fewest buttons, on purpose.
 *
 * 新手引導 and the seven 小天使 guides have no Admin control — what 管理員測試模式 does to them is
 * change a rule (replay every session instead of once ever, see lib/tutorialReplay.ts). Before
 * this console there was nowhere in the game that said so, which is exactly the 「是否正在生效」
 * question the brief's §7 is about. They are reported here rather than given a fake button,
 * because inventing a 「重播教學」 control would be inventing a feature that does not exist.
 */
function OnboardingSection() {
  const { profile, forceShowLoginBonus } = useApp();
  const [busy, setBusy] = useState(false);

  return (
    <>
      <AdminGroup
        icon={<Trophy size={14} />}
        title="每日補給與連續登入"
        note="這顆不是「顯示」而是「再發一次」：每按一次 loginStreak +1 並再度發放，沒有每日上限。會寫入存檔。"
      >
        <div className="flex flex-col gap-2 p-3 rounded-2xl bg-island-cream-2 border border-island-line">
          <div className="text-[10px] font-bold text-island-navy-soft">
            目前連續登入：
            <span className="font-mono text-island-navy">{profile?.loginStreak || 0}</span> 天
          </div>
          <AdminActionButton
            full
            tone="teal"
            icon={<Trophy size={12} strokeWidth={2.75} />}
            label={busy ? '發放中…' : '再觸發一次每日補給'}
            disabled={busy || !profile}
            title="管理員：再跑一次連續登入的發放"
            onClick={() => {
              void (async () => {
                playSound(SoundEffect.CLICK);
                setBusy(true);
                await forceShowLoginBonus();
                setBusy(false);
              })();
            }}
          />
        </div>
      </AdminGroup>

      <AdminGroup
        icon={<GraduationCap size={14} />}
        title="教學重播規則"
        note="唯讀。這些是管理員測試模式改變的「規則」，不是按鈕 —— 關掉模式就恢復成玩家的規則。"
      >
        <div className="p-3 rounded-2xl bg-island-cream-2 border border-island-line">
          <AdminStatusRow
            label="新手引導（教練阿肌）"
            detail="正式玩家每個裝置只看一次；現在每次登入都會重播，且不會覆寫玩家的「已完成」紀錄"
            state={<AdminStatePill tone="on">重播中</AdminStatePill>}
          />
          <AdminStatusRow
            label="小天使導覽 ×7"
            detail="建造模式總覽、我的家、建築與裝飾、島上物件、領土規劃、家具、房間擴建 —— 建造模式與室內的七個導覽同樣每次重播"
            state={<AdminStatePill tone="on">重播中</AdminStatePill>}
          />
          <AdminStatusRow
            label="每日登入面板"
            detail="正式規則是每個台北曆日第一次進遊戲才自動打開；現在每次重新整理都會自動打開"
            state={<AdminStatePill tone="on">每次開啟</AdminStatePill>}
          />
          <AdminStatusRow
            label="新手引導・第四站"
            detail="這一站講的就是鏡頭遠近轉盤，所以它跟著轉盤走（見「場景與環境」）"
            state={<AdminStatePill tone="info">跟隨轉盤</AdminStatePill>}
          />
        </div>
      </AdminGroup>
    </>
  );
}

// --- 目錄 -------------------------------------------------------------------

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: 'scene',
    label: '場景與環境',
    tagline: '把島嶼放到任何一種「離開很久」的狀態，並決定畫面上要不要有轉盤',
    icon: <Sprout size={16} strokeWidth={2.5} />,
    entries: ['離線天數模擬', '離線褪色預覽', '恢復演示', '重置環境變化', '鏡頭轉盤顯示'],
    Body: SceneSection,
  },
  {
    id: 'player',
    label: '玩家數值',
    tagline: '金幣、碎片、經驗值與抽獎券 —— 加值、歸零，或直接寫成指定數字',
    icon: <Coins size={16} strokeWidth={2.5} />,
    entries: ['快捷加值', '金幣', '碎片', '經驗值 XP', '抽獎券'],
    Body: PlayerSection,
  },
  {
    id: 'economy',
    label: '商店與經濟',
    tagline: '一次擁有整個商店目錄、跑一次真正的輪盤，或把存檔內容清空重來',
    icon: <Store size={16} strokeWidth={2.5} />,
    entries: [
      '擁有全部商品開關',
      '一鍵發放全部商品',
      '模擬輪盤抽獎',
      '重置功能卡',
      '商船行程（唯讀）',
      '網址覆寫狀態',
      '清空裝備',
    ],
    Body: EconomySection,
  },
  {
    id: 'workout',
    label: '健身與獎勵',
    tagline: '發出真正的健身完成事件，檢視獎勵池的稀有度分布，重置首次獎勵',
    icon: <Dumbbell size={16} strokeWidth={2.5} />,
    entries: ['模擬完成健身', '獎勵池清單', '稀有度分布', '抽獎預覽', '重置獎勵狀態'],
    Body: WorkoutSection,
  },
  {
    id: 'pet',
    label: '寵物',
    tagline: '把飽足與活動力設定到四個照護區間中的任何一個',
    icon: <PawPrint size={16} strokeWidth={2.5} />,
    entries: ['懶洋洋', '想休息', '悠閒', '活力充沛'],
    Body: PetSection,
  },
  {
    id: 'onboarding',
    label: '新手與登入流程',
    tagline: '重新觸發每日補給，並確認教學重播規則目前是不是真的在生效',
    icon: <GraduationCap size={16} strokeWidth={2.5} />,
    entries: ['再觸發每日補給', '新手引導重播', '小天使導覽 ×7', '每日登入面板自動開啟'],
    Body: OnboardingSection,
  },
];
