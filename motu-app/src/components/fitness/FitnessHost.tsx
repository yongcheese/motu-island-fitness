/**
 * 健身分頁的宿主 — 取代遊戲組原型 FitnessView（該檔保留不刪）。
 *
 * 健身頁本體是健身組的原始碼（上一層的 app/，純 ES Modules），以 `@fitness` 別名直接引用，
 * 不複製第二份：舊版 :8080 與它的測試照常使用同一份程式。這支檔案只做三件事：
 *
 *   1. 把健身頁關進 shadow root（樣式改寫見 fitnessStyles.ts），兩邊的 CSS 互不干擾；
 *   2. 提供健身頁需要的 ctx（store、語音教練、切頁、全螢幕），全螢幕改走遊戲端的 isWorkoutActive；
 *   3. 健身頁在自己的 DOM 留插槽（ctx.slots），這裡用 React portal 把遊戲組元件畫進去；
 *      結束訓練時健身頁先呼叫 ctx.game.settle(session) 由遊戲端發獎（見 useFitnessSettle.ts），
 *      再呼叫 ctx.game.claim(awards)，這裡播逐項領獎（ClaimSequence.tsx），玩家按下任意鍵以繼續後才 resolve。
 *
 * 遊戲端餘額（金幣、碎片、經驗、等級）由這裡從 profile 發布，資源列與健身頁本體
 * （ctx.game.balances／subscribe）讀的是同一份，見 FitnessWallet.tsx。
 *
 * 訓練中的事件（每計一下、階段、里程碑）由健身頁呼叫 ctx.events.emit 送出，
 * 轉給右上角的陪伴主角與對話框，見 CompanionCoach.tsx。
 *
 * 示範人物（截圖急件）：動作卡（插槽 `card-<動作>`）、動作說明頁（`intro`）、示範模式中央（`stage`）
 * 也畫島嶼主角。示範模式每幀的合成 landmarks 以 `demoFrame` 事件送來，這裡直接寫進 ref 給主角讀，
 * 不經 React state、也不轉給陪伴主角（每秒 30 次，不能讓畫面跟著重畫）。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { toShadowCss } from './fitnessStyles';
import { FitnessCharacter, type PoseFeed } from './FitnessCharacter';
import { FitnessWallet, createBalanceFeed } from './FitnessWallet';
import { balancesFromProfile, type Award, type FitnessBalances, type FitnessSession } from './gameContract';
import { CoachBackdrop } from './CoachBackdrop';
import { CompanionCoach, createCompanionFeed } from './CompanionCoach';
import { useFitnessSettle } from './useFitnessSettle';
import { ClaimSequence } from './ClaimSequence';

import workout from '@fitness/features/workout/workout.js';
import { store } from '@fitness/state/store.js';
import { createCoach } from '@fitness/core/coach.js';
import appCss from '@fitness/styles/app.css?raw';
import workoutCss from '@fitness/features/workout/workout.css?raw';
import luminaCss from '@fitness/styles/lumina.css?raw';
import motuCss from '@fitness/styles/motu.css?raw';
import motuSkinCss from '@fitness/styles/motu-skin.css?raw';

// 載入順序同舊版 index.html（motu-skin 必須最後）；外殼與其他分頁的樣式不需要
const FITNESS_CSS = toShadowCss([appCss, workoutCss, luminaCss, motuCss, motuSkinCss].join('\n'));

/** 健身頁的字型宣告只能掛在 document 上（shadow 裡的 @font-face 不生效），整個 App 只掛一次。 */
function ensureFontFaces() {
  if (document.getElementById('fitness-font-faces')) return;
  const style = document.createElement('style');
  style.id = 'fitness-font-faces';
  style.textContent = FITNESS_CSS.fontFaces.join('\n');
  document.head.append(style);
}

/**
 * 遊戲組的樣式（Tailwind）一份複製進 shadow root，畫進插槽的遊戲元件才有樣式。
 * 用複製而不是 import：開發時由 Vite 注入、上線時是打包後的 <link>，兩種都在 document.head 裡。
 */
function cloneGameStyles(target: ShadowRoot) {
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
    if ((node as HTMLElement).id === 'fitness-font-faces') return;
    target.append(node.cloneNode(true));
  });
}

type Slots = Record<string, HTMLElement>;

export function FitnessHost() {
  const { setIsWorkoutActive, setCurrentView, profile, grantFragments } = useApp();
  // 健身頁只掛載一次：context 的 setter 若在重繪時換了參考，也不能因此把訓練中的頁面拆掉重掛
  const appRef = useRef({ setIsWorkoutActive, setCurrentView });
  appRef.current = { setIsWorkoutActive, setCurrentView };
  const hostRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slots>({});
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const [claim, setClaim] = useState<{ awards: Award[]; before: FitnessBalances; resolve: () => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // 遊戲端餘額：整個宿主生命週期只有一條訊息，profile 一換就重新發布（四個數字沒變則不通知）
  const [balanceFeed] = useState(() => createBalanceFeed(balancesFromProfile(profile)));
  useEffect(() => {
    balanceFeed.publish(balancesFromProfile(profile));
  }, [balanceFeed, profile]);
  // 訓練中的事件：整個宿主生命週期一條，陪伴主角訂閱
  const [companionFeed] = useState(createCompanionFeed);
  // 示範模式中央主角的幀來源
  const [demoFeed] = useState<PoseFeed>(() => ({ current: null }));
  // 結束訓練發獎：整個宿主生命週期一個（同一次訓練只發一次），每次呼叫讀最新的 profile
  const settle = useFitnessSettle(profile, grantFragments);
  // 發獎「之前」的餘額：領獎資源列從這裡加上每一項（發獎後的 profile 可能被遊戲端暫時多疊一次，見 claimMachine.ts）
  const beforeSettle = useRef<FitnessBalances | null>(null);
  // 遊戲端的分頁列只在主頁出現，其他頁面各自有右上角的關閉鍵回島嶼（同健康頁、設定頁）；全螢幕訓練時隱藏
  const [chrome, setChromeState] = useState(true);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // StrictMode 開發模式會掛兩次：同一個元素不能 attachShadow 兩次，重用並清空
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    shadow.replaceChildren();
    ensureFontFaces();
    cloneGameStyles(shadow);
    const style = document.createElement('style');
    style.textContent = FITNESS_CSS.css;
    shadow.append(style);

    // 結構同舊版 index.html 的 #app > #view，健身頁的版面規則原封沿用
    const body = document.createElement('div');
    body.className = 'fx-body';
    const app = document.createElement('div');
    app.id = 'app';
    const view = document.createElement('main');
    view.id = 'view';
    const layer = document.createElement('div');
    layer.className = 'fx-overlay';
    app.append(view);
    body.append(app, layer);
    shadow.append(body);
    setOverlay(layer);

    let toastTimer = 0;
    const coach = createCoach({ enabled: store.getState().prefs.voice });
    const ctx = {
      store,
      coach,
      // MediaPipe wasm／模型由 server.ts 掛在站台根目錄的 /vendor（不依賴頁面網址剛好在根目錄）
      assetRoot: '/vendor',
      navigate: (id: string) => {
        if (id === 'island') appRef.current.setCurrentView(View.HOME);
      },
      toast: (msg: string) => {
        setToast(msg);
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setToast(null), 2200);
      },
      // 全螢幕訓練：遊戲端的 HUD、分頁列靠 isWorkoutActive 隱藏
      setChrome: (visible: boolean) => {
        view.classList.toggle('full', !visible);
        setChromeState(visible);
        appRef.current.setIsWorkoutActive(!visible);
      },
      slots: { set: (map: Slots) => setSlots({ ...map }) },
      events: {
        emit: (type: string, payload: unknown) => {
          if (type === 'demoFrame') demoFeed.current = (payload as { landmarks?: PoseFeed['current'] })?.landmarks ?? null;
          else companionFeed.emit(type, payload);
        },
      },
      game: {
        balances: balanceFeed.balances,
        subscribe: balanceFeed.subscribe,
        settle: (session: FitnessSession) => {
          beforeSettle.current = balanceFeed.balances();
          return settle(session);
        },
        claim: (awards: Award[]) =>
          new Promise<void>((resolve) =>
            setClaim({ awards, before: beforeSettle.current ?? balanceFeed.balances(), resolve }),
          ),
      },
    };

    workout.mount(view, ctx);
    return () => {
      workout.unmount();
      window.clearTimeout(toastTimer);
      appRef.current.setIsWorkoutActive(false);
      setSlots({});
      setOverlay(null);
    };
  }, []);

  const portal = (name: string, node: React.ReactNode) =>
    slots[name] ? createPortal(node, slots[name], name) : null;
  // 插槽所屬的動作：寫在插槽外層的 data-ex 上（說明頁、示範舞台）
  const exOf = (name: string) => slots[name]?.closest('[data-ex]')?.getAttribute('data-ex') ?? 'squat';

  return (
    <div ref={hostRef} className="absolute inset-0">
      {portal('wallet', <FitnessWallet feed={balanceFeed} />)}
      {/* 推薦卡的主角做的是推薦卡那個動作（卡片上的 data-rec-id） */}
      {portal('hero', <FitnessCharacter exercise={slots.hero?.closest('[data-rec-id]')?.getAttribute('data-rec-id') ?? 'squat'} />)}
      {/* 動作卡：插槽名稱就帶著動作 id */}
      {Object.keys(slots)
        .filter((name) => name.startsWith('card-'))
        .map((name) => portal(name, <FitnessCharacter exercise={name.slice(5)} />))}
      {portal('intro', <FitnessCharacter exercise={exOf('intro')} />)}
      {portal('stage', <FitnessCharacter exercise={exOf('stage')} mode="feed" feed={demoFeed} />)}
      {portal('backdrop', <CoachBackdrop />)}
      {portal('companion', <CompanionCoach feed={companionFeed} />)}
      {overlay &&
        chrome &&
        !claim &&
        createPortal(
          <button
            type="button"
            onClick={() => appRef.current.setCurrentView(View.HOME)}
            aria-label="關閉健身頁，回到島嶼"
            className="fixed corner-safe-tr w-14 h-14 bg-white border border-island-line hover:bg-island-cream-2 rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all duration-200 z-50 shadow-[0_10px_24px_rgba(38,70,83,0.15)] active:scale-[0.98] hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 focus-visible:outline-2 focus-visible:outline-island-teal"
          >
            <X size={28} strokeWidth={3} />
          </button>,
          overlay,
        )}
      {overlay &&
        claim &&
        createPortal(
          <ClaimSequence
            awards={claim.awards}
            before={claim.before}
            onDone={() => {
              claim.resolve();
              setClaim(null);
            }}
          />,
          overlay,
        )}
      {overlay &&
        toast &&
        createPortal(
          <div className="fixed bottom-28 left-1/2 z-toast -translate-x-1/2 rounded-xl bg-island-navy px-4 py-2 text-sm font-bold text-white shadow-sm">
            {toast}
          </div>,
          overlay,
        )}
    </div>
  );
}
