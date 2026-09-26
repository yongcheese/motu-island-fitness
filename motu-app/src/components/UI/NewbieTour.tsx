/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronRight, Check } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { useIsTouchDevice } from '../../hooks/useIsTouchDevice';
import { useAdminMode } from '../../hooks/useAdminMode';
import { useAdminTest } from './admin/AdminTestContext';
import { playSound, SoundEffect, triggerHaptic } from '../../lib/soundUtils';
import { markTutorialSeen, shouldShowTutorial } from '../../lib/tutorialReplay';
import { FOREIGN_MODAL_SELECTOR, useOnboardingSlot } from '../../lib/onboardingQueue';
import { KeyCap } from './DesignKit';
import { CoachSprite } from './CoachSprite';
import { TOUR_TARGET, tourSelector, type TourTargetId } from '../../constants/tourTargets';

/**
 * 新手引導 — the first-run tour of the island HUD, walked by 教練阿肌
 * (CoachSprite.tsx).
 *
 * The problem it solves is the one a new player actually has: they land on a
 * living 3D island with chrome in all four corners and no idea which corner is
 * the one to touch first. So this is NOT a wall of text — it is a spotlight. On
 * each beat everything on screen goes dark except one HUD card, which is lit
 * (and genuinely brightened, see `backdropFilter` below), and the coach stands
 * next to it and says one thing about it.
 *
 * ROUTE: anticlockwise around the screen, which is also roughly the order a
 * player needs the things in — 左上帳號卡 → 左邊四支路牌 → 下方四個分頁 →
 * 右下幸運轉盤 → 右邊 WASD → 右邊鏡頭轉盤. Walking the ring in ONE direction,
 * with no backtracking, is what makes six separate cards feel like one lap of
 * one screen rather than six unrelated popups; it is also why the two stations
 * added later (分頁 and 轉盤) sit in the MIDDLE of the list rather than at the
 * end, where they would have made the coach jump back across the screen twice.
 *
 * The bottom of that ring is also the answer to the two questions a new player
 * actually has after the signposts — 「錢從哪裡來」 (健身分頁) and 「角落那顆會轉
 * 的東西是什麼」 (幸運轉盤) — so the route is not only geometric.
 *
 * IT NEVER TAKES THE CONTROLS AWAY. The dark layer is `pointer-events-none` and
 * the game keeps running underneath: only the bubble, the coach and 跳過 accept
 * clicks. That is not a stylistic choice — station 3 asks the player to press
 * W A S D *while the coach is still on screen*, which a blocking scrim would
 * make impossible. Same contract as the 小天使 build-mode guide (AngelGuide.tsx):
 * one tap advances, 跳過 kills the whole thing in one click, no timers, no gate.
 */

// --- "already seen" bookkeeping -------------------------------------------

/**
 * Ship behaviour: plays once per player, per device (see lib/tutorialReplay.ts
 * for the localStorage bookkeeping this shares with AngelGuide.tsx).
 *
 * 管理員測試模式 (hooks/useAdminMode.ts) overrides this: while it is on, the
 * tour replays on every fresh load and this flag is neither read nor written,
 * so turning admin mode back off restores whatever a normal player's state
 * already was.
 *
 * (It still only plays once per *session* either way: finishing or skipping
 * ends it until the page is reloaded, or until something dispatches the
 * `replay-newbie-tour` event on `window`.)
 */
const SEEN_KEY = 'island.newbieTour.seen.v1';

// --- Where this sits among the other first-run popups ----------------------
//
// Second in the shared queue (lib/onboardingQueue.ts): after the login bonus,
// before HomeSetupGuide. This file used to export a one-boolean store that
// HomeSetupGuide read directly, while THIS component decided whether to stand
// down by polling the DOM for `.z-modal` — and HomeSetupGuide's own scrim is a
// `.z-modal`. So the two guides each waited on the other through a different
// channel, and the Home guide (which renders unconditionally on a new player)
// always won: the tour never played on the one login it exists for. Both halves
// of that handshake are now one declared order.

// --- The script ------------------------------------------------------------

type Rect = { top: number; left: number; width: number; height: number };
type Side = 'right' | 'left' | 'top' | 'bottom';

type TourStep = {
  target: TourTargetId;
  /** Breathing room between the lit card and the edge of the darkness, px. */
  padding: number;
  /** Corner rounding of the spotlight window, px. */
  radius: number;
  /** Where the coach would rather stand. Flips if he doesn't fit there. */
  prefer: Side;
  title: string;
  body: string;
  /** Used instead of `body` on touch devices, where the controls differ. */
  touchBody?: string;
  /** Draws the W/A/S/D keycap cluster under the copy (desktop only). */
  showKeys?: boolean;
  /**
   * This station teaches a control that is itself Admin Only, so it is dropped
   * from the route unless 管理員測試模式 is on. Without this the tour would
   * spotlight an empty corner and describe a dial that is not there — the
   * `fallback` below papers over a card that is *momentarily* missing, not one
   * that was deliberately hidden.
   *
   * Since the 管理員測試 console gave that dial its own visibility switch, the flag has to follow
   * the DIAL and not the MODE: an admin who put the dial away would otherwise get a spotlight on
   * the empty edge it used to occupy, which is the exact failure this flag was written to prevent.
   * See the route filter below.
   */
  adminOnly?: boolean;
  /**
   * Where to cut the spotlight when the element isn't in the DOM at all — the
   * WASD card is desktop-only and also self-hides after the player's first
   * step, so this is a real case, not a defensive one. Screen-relative, so it
   * lands on the region the missing card lives in.
   */
  fallback: (vw: number, vh: number, isTouch: boolean) => Rect;
};

const STEPS: TourStep[] = [
  {
    target: TOUR_TARGET.account,
    padding: 12,
    radius: 26,
    prefer: 'right',
    title: '第一站・你的帳號卡',
    body: '嘿，我是你的專屬教練「阿肌」！左上角這張卡就是你：點頭像可以打開帳號中心。下面三條是等級經驗、金幣和碎片——金幣主要靠健身賺，碎片則是運動以外的獎勵給的。',
    fallback: (_vw, _vh) => ({ top: 16, left: 16, width: 236, height: 176 }),
  },
  {
    target: TOUR_TARGET.toolbar,
    padding: 14,
    radius: 28,
    prefer: 'right',
    title: '第二站・左邊四支路牌',
    body: '由上到下是「建造」「商店」「更衣室」「動作」。蓋房子、買家具、換造型、擺姿勢，全部從這四支牌子出發。',
    fallback: (_vw, vh) => ({ top: vh * 0.3, left: 12, width: 132, height: vh * 0.5 }),
  },
  {
    target: TOUR_TARGET.nav,
    padding: 12,
    radius: 22,
    // Above, always: this board is bottom-anchored and the coach standing under it would be off
    // the bottom of the viewport. `prefer` flips when he doesn't fit, but there is nowhere to
    // flip TO here, so 'top' is the answer rather than the preference.
    prefer: 'top',
    title: '第三站・下面四個分頁',
    body: '下面這塊木牌把遊戲分成四塊：「主頁」是你現在站的島、「健身」是真的動起來的地方、「健康」看得到你的運動數據跟每週任務、「設定」調整遊戲。剛才說金幣只有健身才拿得到——就是從這裡進去。',
    fallback: (vw, vh) => ({ top: vh - 156, left: vw / 2 - 236, width: 472, height: 144 }),
  },
  {
    target: TOUR_TARGET.wheel,
    padding: 14,
    // Round, like the launcher itself — a rounded-rect hole around a circular button reads as a
    // missed target rather than as a spotlight.
    radius: 999,
    prefer: 'left',
    title: '第四站・幸運轉盤',
    body: '右下角這顆輪盤，圖示上那個數字就是你的抽獎券。轉一次花 1 張，轉得到商品碎片、服裝，偶爾還會多還你幾張券。你手上那張是我送的見面禮——先去轉一次，把整排獎品看過一遍。',
    touchBody: '右下角這顆輪盤，圖示上那個數字就是你的抽獎券。轉一次花 1 張，轉得到商品碎片、服裝，偶爾還會多還你幾張券。你手上那張是我送的見面禮——先點開來轉一次，把整排獎品看過一遍。',
    fallback: (vw, vh) => ({ top: vh - 96, left: vw - 92, width: 72, height: 72 }),
  },
  {
    target: TOUR_TARGET.move,
    padding: 14,
    radius: 24,
    prefer: 'left',
    title: '第五站・讓角色動起來',
    body: '按 W A S D 走路，按住滑鼠拖曳可以繞著角色轉鏡頭。現在就試試看，我在這裡等你——熱身也是訓練的一部分。',
    touchBody: '手指按在畫面左半邊拖曳就會走路，右半邊拖曳則是轉鏡頭。現在就試試看，我在這裡等你。',
    showKeys: true,
    fallback: (vw, vh, isTouch) =>
      isTouch
        ? { top: vh * 0.55, left: 16, width: Math.min(vw * 0.46, 260), height: vh * 0.32 }
        : { top: vh - 208, left: vw - 212, width: 188, height: 176 },
  },
  {
    target: TOUR_TARGET.camera,
    padding: 14,
    radius: 30,
    prefer: 'left',
    // The dial this station is about is Admin Only (App.tsx) — see `adminOnly`.
    adminOnly: true,
    title: '第六站・切換視角',
    body: '右邊這組轉盤管鏡頭遠近：＋拉近、－拉遠，滑鼠滾輪也可以。一路拉到最近就會切成第一人稱，直接用角色的眼睛看整座島。',
    touchBody: '右邊這組轉盤管鏡頭遠近，兩指捏合也行。一路拉到最近就會切成第一人稱，直接用角色的眼睛看整座島。',
    fallback: (vw, vh) => ({ top: vh / 2 - 150, left: vw - 124, width: 108, height: 300 }),
  },
];

// --- Measurement -----------------------------------------------------------

function useViewportSize() {
  const [size, setSize] = useState(() => ({
    vw: typeof window === 'undefined' ? 1280 : window.innerWidth,
    vh: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));

  useEffect(() => {
    const onResize = () => setSize({ vw: window.innerWidth, vh: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return size;
}

const rectsDiffer = (a: Rect, b: Rect) =>
  Math.abs(a.top - b.top) > 0.5 ||
  Math.abs(a.left - b.left) > 0.5 ||
  Math.abs(a.width - b.width) > 0.5 ||
  Math.abs(a.height - b.height) > 0.5;

/**
 * The lit rectangle for the current step, tracked per frame.
 *
 * A frame loop rather than resize/scroll listeners because the HUD cards this
 * follows are themselves animating: they spring in on mount, TopBar grows when
 * its detail panel expands, ControlsHint scales, and the rail re-lays-out
 * whenever the window changes shape. A listener-based measure would light the
 * card's *old* box for the length of every one of those animations. One
 * `getBoundingClientRect()` per frame on one element is cheap; the state only
 * updates when the box actually moved (see `rectsDiffer`), so the React tree
 * re-renders on movement, not on every frame.
 *
 * When the element is missing the LAST known rect wins over the fallback: the
 * WASD card retires itself the moment the player takes their first step, and
 * that is precisely the moment we're congratulating them — the spotlight has to
 * stay where the card was instead of teleporting to a screen-relative guess.
 */
function useSpotlightRect(step: TourStep | null, isTouch: boolean, enabled: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const lastRef = useRef<Rect | null>(null);

  useEffect(() => {
    lastRef.current = null;
    setRect(null);
  }, [step]);

  useEffect(() => {
    if (!step || !enabled) return;

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);

      let next: Rect | null = null;
      const el = document.querySelector(tourSelector(step.target));
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) {
          next = {
            top: r.top - step.padding,
            left: r.left - step.padding,
            width: r.width + step.padding * 2,
            height: r.height + step.padding * 2,
          };
        }
      }
      if (!next) next = lastRef.current ?? step.fallback(window.innerWidth, window.innerHeight, isTouch);

      const prev = lastRef.current;
      if (!prev || rectsDiffer(prev, next)) {
        lastRef.current = next;
        setRect(next);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step, isTouch, enabled]);

  return rect;
}

/**
 * Whether an ORDINARY modal is open — a purchase confirm, the account panel,
 * the house-style picker. Anything on the shared `z-modal` tier.
 *
 * Modals sit above this tour by design (index.css's layer table), so a tour
 * still painting its darkness under one would read as a bug. Rather than wire
 * every modal in the app up to a new piece of state, the tour just looks: a
 * cheap class query a few times a second, and it steps aside while one is up
 * and resumes on the same step afterwards.
 *
 * The other first-run popups are excluded by the selector, even though they are
 * on the same tier — they are ordered by the onboarding queue, which the tour
 * joins as a participant. Seeing them here instead is a deadlock, not just a
 * wrong order: this tour's queue claim is conditional on the probe, so a guide
 * politely waiting its turn behind us would read as a reason for us not to
 * start, and neither would ever run.
 */
function useModalPresent(enabled: boolean): boolean {
  const [present, setPresent] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setPresent(false);
      return;
    }
    const check = () => setPresent(!!document.querySelector(FOREIGN_MODAL_SELECTOR));
    check();
    const id = window.setInterval(check, 300);
    return () => window.clearInterval(id);
  }, [enabled]);

  return present;
}

// --- Placement -------------------------------------------------------------

const GAP = 22; // between the lit window and the coach
const MARGIN = 12; // minimum distance kept from the viewport edges

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Where the coach stands for a given spotlight.
 *
 * Preferred side first, then whichever side has the most room — never a fixed
 * corner, because the panel has to clear a card that can be anywhere from the
 * top-left of a phone to the middle-right of an ultrawide. Returns the side it
 * settled on too, so the speech bubble's tail can point back at him.
 */
function placeCoach(
  rect: Rect,
  panel: { w: number; h: number },
  prefer: Side,
  vw: number,
  vh: number,
): { top: number; left: number; side: Side } {
  const space: Record<Side, number> = {
    right: vw - (rect.left + rect.width) - GAP - MARGIN,
    left: rect.left - GAP - MARGIN,
    top: rect.top - GAP - MARGIN,
    bottom: vh - (rect.top + rect.height) - GAP - MARGIN,
  };
  const needed = (s: Side) => (s === 'left' || s === 'right' ? panel.w : panel.h);

  const order: Side[] = [prefer, ...(['right', 'left', 'bottom', 'top'] as Side[]).filter((s) => s !== prefer)];
  const side =
    order.find((s) => space[s] >= needed(s)) ??
    (Object.keys(space) as Side[]).sort((a, b) => space[b] - space[a])[0];

  let top: number;
  let left: number;
  if (side === 'left' || side === 'right') {
    left = side === 'right' ? rect.left + rect.width + GAP : rect.left - GAP - panel.w;
    top = rect.top + rect.height / 2 - panel.h / 2;
  } else {
    top = side === 'bottom' ? rect.top + rect.height + GAP : rect.top - GAP - panel.h;
    left = rect.left + rect.width / 2 - panel.w / 2;
  }

  return {
    left: clamp(left, MARGIN, vw - MARGIN - panel.w),
    top: clamp(top, MARGIN, vh - MARGIN - panel.h),
    side,
  };
}

// --- The tour --------------------------------------------------------------

export function NewbieTour() {
  const { user, profile, currentView, isGameLoading, isWorkoutActive, activePlacementItem } = useApp();
  const isTouch = useIsTouchDevice();
  const isAdminMode = useAdminMode();
  const { showZoomDial } = useAdminTest();
  const { vw, vh } = useViewportSize();

  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>(() =>
    shouldShowTutorial(SEEN_KEY, isAdminMode) ? 'idle' : 'done',
  );
  const [index, setIndex] = useState(0);
  const [celebrating, setCelebrating] = useState(false);

  // The route actually walked. Stations whose subject is an Admin Only control
  // drop out for normal players, so the tour never spotlights something that
  // isn't on their screen. Everything below counts against THIS list — the
  // progress beads, "is this the last one", and the clamp — so a shorter route
  // simply is a shorter tour, with no station left dangling.
  //
  // 「Admin Only」 for the one station that has it means 「the 鏡頭遠近轉盤 is on screen」, which is
  // now two facts and not one: the account is in 管理員測試模式 AND the console's 場景與環境
  // switch is leaving the dial drawn (UI/admin/AdminZoomDial.tsx). Reading only the first would
  // spotlight an edge the tester just emptied.
  const showsZoomDial = isAdminMode && showZoomDial;
  const steps = useMemo(
    () => STEPS.filter((s) => !s.adminOnly || showsZoomDial),
    [showsZoomDial],
  );

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;

  // Everything that has to be true for the island HUD to actually BE on screen
  // and settled — the tour points at cards, so it must not run while a card is
  // missing (another view is up), replaced (placement mode hides TopBar), or
  // still fading in behind the loading screen.
  const ready =
    !!user &&
    !!profile &&
    !isGameLoading &&
    !isWorkoutActive &&
    currentView === View.HOME &&
    activePlacementItem === null;

  // A beat after the world settles, so the coach walks in on a finished HUD
  // rather than measuring cards mid-entrance.
  useEffect(() => {
    if (phase !== 'idle' || !ready) return;
    const t = window.setTimeout(() => setPhase('running'), 900);
    return () => window.clearTimeout(t);
  }, [phase, ready]);

  const modalPresent = useModalPresent(phase === 'running');
  // `ready` is re-checked here (not just at start) on purpose: leaving HOME
  // PAUSES the tour rather than ending it. A new player who taps 商店 mid-tour
  // gets to look around and comes back to the same station, instead of being
  // punished for exploring by losing the tutorial.
  //
  // The queue place is held from the moment we know the tour will run — which is
  // `phase !== 'done'`, i.e. including the idle beat before the coach walks in
  // and any pause for a foreign modal. Only the second argument decides whether
  // he is drawn. Claiming on the drawable condition alone would leave the slot
  // empty during that beat, and HomeSetupGuide (ready the instant the profile
  // loads) would flash up and be displaced. See lib/onboardingQueue.ts.
  const visible = useOnboardingSlot(
    'newbieTour',
    phase !== 'done',
    phase === 'running' && ready && !modalPresent,
  );

  const rect = useSpotlightRect(visible ? step : null, isTouch, visible);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  const panelWidth = Math.min(vw - MARGIN * 2, isTouch ? 372 : 440);

  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const measure = () => setPanelHeight((h) => (Math.abs(h - el.offsetHeight) > 0.5 ? el.offsetHeight : h));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, index]);

  const placement = useMemo(
    () => (rect ? placeCoach(rect, { w: panelWidth, h: panelHeight || 190 }, step.prefer, vw, vh) : null),
    [rect, panelWidth, panelHeight, step.prefer, vw, vh],
  );

  const finish = useCallback((reason: 'done' | 'skip') => {
    markTutorialSeen(SEEN_KEY, isAdminMode);
    // `reason` is kept as a parameter rather than dropped so a later telemetry
    // call can tell "read it all" from "bailed out" — the two mean very
    // different things about the copy.
    void reason;
    setPhase('done');
    setCelebrating(false);
  }, [isAdminMode]);

  const celebrateTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(celebrateTimer.current), []);

  const advance = useCallback(() => {
    if (!isLast) {
      playSound(SoundEffect.CLICK);
      triggerHaptic('light');
      setIndex((i) => i + 1);
      return;
    }
    // A second click during the flex means "yes, I'm done" — leave at once. The
    // tour must never hold the player hostage to an animation.
    if (celebrating) {
      finish('done');
      return;
    }
    playSound(SoundEffect.SUCCESS);
    triggerHaptic('medium');
    setCelebrating(true);
    celebrateTimer.current = window.setTimeout(() => finish('done'), 900);
  }, [isLast, celebrating, finish]);

  const skip = useCallback(() => {
    playSound(SoundEffect.CLICK);
    triggerHaptic('light');
    finish('skip');
  }, [finish]);

  // Keyboard: Enter advances, Esc skips. Deliberately NOT Space or the arrow
  // keys — both are live movement/camera inputs while the tour is up, and
  // station 3 is literally asking the player to use them.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') advance();
      else if (e.key === 'Escape') skip();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, advance, skip]);

  // Replay hook for QA and for a future 說明 button: `window.dispatchEvent(new
  // Event('replay-newbie-tour'))` restarts it from station 1.
  useEffect(() => {
    const replay = () => {
      setIndex(0);
      setCelebrating(false);
      setPhase('idle');
    };
    window.addEventListener('replay-newbie-tour', replay);
    return () => window.removeEventListener('replay-newbie-tour', replay);
  }, []);

  // `phase` is seeded once at mount, which is the login case — but the 管理員
  // 測試模式 switch has to be felt without a reload, so flipping it re-decides
  // the same question. Both directions: on re-arms the tour for a player who
  // already finished it, off puts it back to whatever their real record says.
  // The ref keeps this from firing on mount, where the seed already ran.
  const prevAdminRef = useRef(isAdminMode);
  useEffect(() => {
    if (prevAdminRef.current === isAdminMode) return;
    prevAdminRef.current = isAdminMode;
    setIndex(0);
    setCelebrating(false);
    setPhase(shouldShowTutorial(SEEN_KEY, isAdminMode) ? 'idle' : 'done');
  }, [isAdminMode]);

  const body = isTouch && step.touchBody ? step.touchBody : step.body;
  const spring = { type: 'spring' as const, stiffness: 210, damping: 28 };
  const halo = 130; // how far the light falls off past the lit card

  return (
    <AnimatePresence>
      {visible && rect && (
        <motion.div
          key="newbie-tour"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          // z-toast (40), same tier as the 小天使: above every piece of HUD
          // chrome it is darkening (z-hud-*, 20-28) and above floating panels
          // (30), but under real modals (z-modal), which must always win.
          //
          // pointer-events-none is the whole contract — see the header note.
          className="fixed inset-0 z-toast pointer-events-none"
        >
          {/* ---- The darkness, and the window cut in it ----
              One element does both jobs: its own box is the lit window (with a
              `backdrop-filter` that genuinely BRIGHTENS the card underneath,
              rather than just failing to dim it), and a single enormous
              box-shadow spread paints every other pixel of the screen dark.
              200vmax, not 100: the shadow's corners round with its spread, and
              at 100vmax a card in one corner could leave the opposite corner of
              a wide screen undarkened. */}
          <motion.div
            initial={false}
            animate={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            transition={spring}
            style={{
              position: 'fixed',
              borderRadius: step.radius,
              boxShadow: '0 0 0 200vmax rgba(8, 22, 28, 0.84)',
              backdropFilter: 'brightness(1.22) saturate(1.06)',
              WebkitBackdropFilter: 'brightness(1.22) saturate(1.06)',
            }}
          />

          {/* Light falloff, so the edge of the spotlight is a gradient rather
              than a cut. `screen` blending lifts the darkness around the card
              only — the core of the gradient is transparent so it never washes
              out the card itself. */}
          <motion.div
            initial={false}
            animate={{
              top: rect.top - halo,
              left: rect.left - halo,
              width: rect.width + halo * 2,
              height: rect.height + halo * 2,
            }}
            transition={spring}
            style={{
              position: 'fixed',
              mixBlendMode: 'screen',
              background:
                'radial-gradient(closest-side, rgba(255,240,205,0) 0%, rgba(255,240,205,0) 44%, rgba(255,238,196,0.30) 62%, rgba(255,238,196,0) 84%)',
            }}
          />

          {/* Rim light on the card's own edge — a slow breathing pulse, which
              is what makes the eye land on the card and stay there. */}
          <motion.div
            initial={false}
            animate={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              opacity: [0.55, 1, 0.55],
            }}
            transition={{ ...spring, opacity: { duration: 2.6, repeat: Infinity, ease: 'easeInOut' } }}
            style={{
              position: 'fixed',
              borderRadius: step.radius,
              border: '2px solid rgba(255,236,190,0.9)',
              boxShadow: '0 0 26px rgba(255,225,160,0.5), inset 0 0 26px rgba(255,225,160,0.28)',
            }}
          />

          {/* ---- The coach and what he's saying ---- */}
          <motion.div
            ref={panelRef}
            // top/left are seeded in `initial` (from the first placement, which
            // already has the real spotlight and only estimates the panel's own
            // height) so the coach fades in AT his post. Without them motion
            // reads the unset `top`/`left` as 0 and springs him in from the
            // corner of the screen on the first beat.
            initial={{ opacity: 0, scale: 0.92, top: placement?.top ?? 0, left: placement?.left ?? 0 }}
            animate={{
              opacity: 1,
              scale: 1,
              top: placement?.top ?? 0,
              left: placement?.left ?? 0,
            }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ ...spring, opacity: { duration: 0.3 }, scale: { duration: 0.3 } }}
            style={{
              position: 'fixed',
              width: panelWidth,
              // Hidden only for the single frame before the panel's own height
              // is known, so it never flashes at an unplaced position.
              visibility: placement ? 'visible' : 'hidden',
            }}
            className={`flex items-start gap-2 sm:gap-3 ${
              placement?.side === 'left' ? 'flex-row-reverse' : 'flex-row'
            }`}
          >
            {/* The NPC — clickable in his own right, since he is the obvious
                thing to tap. The endless hover lives on this button; the inner
                span is keyed on `index`, so each new line remounts it and
                replays a small "perk up" spring without disturbing the hover. */}
            <motion.button
              type="button"
              onClick={advance}
              animate={{ y: [0, -7, 0] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="pointer-events-auto flex-shrink-0 -mt-2 sm:-mt-4 cursor-pointer active:scale-95 transition-transform drop-shadow-[0_14px_30px_rgba(0,0,0,0.45)]"
              title="點一下繼續"
            >
              <motion.span
                key={index}
                initial={{ scale: 0.86 }}
                animate={celebrating ? { scale: [1, 1.18, 1.06], rotate: [0, -5, 3, 0] } : { scale: 1 }}
                transition={
                  celebrating
                    ? { duration: 0.5, ease: 'easeOut' }
                    : { type: 'spring', stiffness: 420, damping: 12 }
                }
                className="block"
              >
                {/* One SVG scaled by CSS rather than a phone copy and a desktop
                    copy — two mounted sprites would mean duplicate gradient ids. */}
                <CoachSprite className="w-[84px] sm:w-[112px] h-auto" pose={celebrating ? 'cheer' : 'idle'} />
              </motion.span>
            </motion.button>

            {/* Speech card — same three-part anatomy as the 小天使's (cream-2
                header band, rope-stitch rule, white body), so the two guides
                read as one UI kit. The corner nearest the coach is squared off
                so the tail lands on a straight edge instead of fighting a
                1.6rem radius. */}
            <div
              role="button"
              tabIndex={0}
              onClick={advance}
              onKeyDown={(e) => {
                if (e.key === 'Enter') advance();
              }}
              className={`pointer-events-auto relative mt-3 sm:mt-6 flex-1 min-w-0 cursor-pointer select-none border border-island-line bg-island-cream text-left shadow-[0_28px_56px_-14px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.9)_inset] transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99] ${
                placement?.side === 'left'
                  ? 'rounded-tr-xl rounded-tl-[1.6rem] rounded-b-[1.6rem]'
                  : 'rounded-tl-xl rounded-tr-[1.6rem] rounded-b-[1.6rem]'
              }`}
            >
              {/* Tail, pointing back at the coach on whichever side he ended up. */}
              <span
                className={`absolute top-[26px] z-10 h-3.5 w-3.5 rotate-45 rounded-[3px] border-island-line bg-island-cream-2 ${
                  placement?.side === 'left'
                    ? 'right-[-6.5px] border-t border-r'
                    : 'left-[-6.5px] border-b border-l'
                }`}
              />

              {/* ---- Header band: stable chrome. The speaker and the controls
                      never change between beats, so they don't animate. ---- */}
              <div className="flex items-center gap-2.5 rounded-t-[0.69rem] bg-island-cream-2/90 px-3.5 pt-2.5 pb-2 sm:px-5 sm:pt-3 sm:pb-2.5">
                <span className="relative flex h-2 w-2 flex-shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-island-coral/70 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-island-coral" />
                </span>
                <span className="text-[10px] font-black tracking-[0.22em] text-island-navy sm:text-[11px]">
                  教練阿肌
                </span>

                {/* Progress beads. Past stations stay tinted but faded, the
                    current one stretches, upcoming ones are inert line-colour —
                    so the row shows direction of travel, not just position. */}
                <span className="ml-auto flex items-center gap-1.5">
                  {steps.map((s, i) => (
                    <span
                      key={s.target}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i === index
                          ? 'w-5 bg-island-coral'
                          : i < index
                            ? 'w-1.5 bg-island-coral/40'
                            : 'w-1.5 bg-island-line'
                      }`}
                    />
                  ))}
                </span>

                {/* The escape hatch: one click, tour gone. Stops propagation so
                    it never reads as "next" on the way out. */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    skip();
                  }}
                  className="flex flex-shrink-0 cursor-pointer items-center gap-1 rounded-full border border-island-line bg-island-cream py-1 pl-1.5 pr-2 text-[10px] font-black text-island-navy-soft shadow-[0_1px_2px_rgba(38,70,83,0.08)] transition-all hover:bg-island-line/40 hover:text-island-navy active:scale-95"
                  title="跳過新手引導"
                >
                  <X size={11} strokeWidth={3} />
                  <span>跳過</span>
                </button>
              </div>

              {/* Stitched rule, inset from the edges like the seam on a tag */}
              <div className="rope-stitch mx-3.5 sm:mx-5" />

              {/* ---- The line itself ---- */}
              <div className="px-3.5 py-3 sm:px-5 sm:py-4">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="mb-1.5 text-[10px] font-black tracking-[0.18em] text-island-navy-soft/70">
                      {step.title}
                    </p>
                    {/* Generous leading: this is Chinese body copy at small
                        size, where tight line-height is what makes a bubble
                        feel cheap. */}
                    <p className="text-[13px] font-bold leading-[1.85] tracking-wide text-island-navy sm:text-[15px]">
                      {body}
                    </p>

                    {step.showKeys && !isTouch && (
                      <div className="mt-3 flex flex-col items-center gap-1.5">
                        <KeyCap>W</KeyCap>
                        <div className="flex gap-1.5">
                          <KeyCap>A</KeyCap>
                          <KeyCap>S</KeyCap>
                          <KeyCap>D</KeyCap>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] font-black text-island-teal-dark sm:text-[11px]">
                  <span>{celebrating ? '訓練開始！' : isLast ? '開始冒險' : '點一下繼續'}</span>
                  {isLast ? (
                    <Check size={14} strokeWidth={3} />
                  ) : (
                    // Nudges rightward on a loop — a standing invitation to
                    // tap, with no countdown and no pressure to hurry.
                    <motion.span
                      className="flex"
                      animate={{ x: [0, 3, 0] }}
                      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                    >
                      <ChevronRight size={14} strokeWidth={3} />
                    </motion.span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
