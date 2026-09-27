/**
 * 健身分頁的宿主 — 取代遊戲組原型 FitnessView（該檔保留不刪）。
 *
 * 健身頁本體是健身組的原始碼（上一層的 app/，純 ES Modules），以 `@fitness` 別名直接引用，
 * 不複製第二份：舊版 :8080 與它的測試照常使用同一份程式。這支檔案只做三件事：
 *
 *   1. 把健身頁關進 shadow root（樣式改寫見 fitnessStyles.ts），兩邊的 CSS 互不干擾；
 *   2. 提供健身頁需要的 ctx（store、語音教練、切頁、全螢幕），全螢幕改走遊戲端的 isWorkoutActive；
 *   3. 健身頁在自己的 DOM 留插槽（ctx.slots），這裡用 React portal 把遊戲組元件畫進去；
 *      結束訓練時健身頁呼叫 ctx.game.claim(awards)，這裡播領獎序列，玩家按任意鍵後才 resolve。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { View } from '../../types';
import { toShadowCss } from './fitnessStyles';
import { FitnessCharacter } from './FitnessCharacter';
import {
  BackdropSkeleton,
  ClaimSkeleton,
  CompanionSkeleton,
  WalletSkeleton,
  type ClaimAward,
} from './skeleton/FitnessSkeleton';

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
  const { setIsWorkoutActive, setCurrentView } = useApp();
  // 健身頁只掛載一次：context 的 setter 若在重繪時換了參考，也不能因此把訓練中的頁面拆掉重掛
  const appRef = useRef({ setIsWorkoutActive, setCurrentView });
  appRef.current = { setIsWorkoutActive, setCurrentView };
  const hostRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<Slots>({});
  const [overlay, setOverlay] = useState<HTMLElement | null>(null);
  const [claim, setClaim] = useState<{ awards: ClaimAward[]; resolve: () => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
      game: {
        claim: (awards: ClaimAward[]) =>
          new Promise<void>((resolve) => setClaim({ awards, resolve })),
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

  return (
    <div ref={hostRef} className="absolute inset-0">
      {portal('wallet', <WalletSkeleton />)}
      {/* 推薦卡的主角做的是推薦卡那個動作（卡片上的 data-rec-id） */}
      {portal('hero', <FitnessCharacter exercise={slots.hero?.closest('[data-rec-id]')?.getAttribute('data-rec-id') ?? 'squat'} />)}
      {portal('backdrop', <BackdropSkeleton />)}
      {portal('companion', <CompanionSkeleton />)}
      {overlay &&
        chrome &&
        !claim &&
        createPortal(
          <button
            type="button"
            onClick={() => appRef.current.setCurrentView(View.HOME)}
            aria-label="關閉健身頁，回到島嶼"
            className="fixed corner-safe-tr w-14 h-14 bg-white border border-island-line hover:bg-island-cream-2 rounded-2xl flex items-center justify-center text-island-navy-soft hover:text-island-navy transition-all z-50 shadow-[0_10px_24px_rgba(38,70,83,0.15)] active:scale-95 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-island-teal"
          >
            <X size={28} strokeWidth={3} />
          </button>,
          overlay,
        )}
      {overlay &&
        claim &&
        createPortal(
          <ClaimSkeleton
            awards={claim.awards}
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
