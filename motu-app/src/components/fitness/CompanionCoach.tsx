/**
 * 訓練中右上角的陪伴主角＋對話框（Slice 7）。
 *
 * 健身頁本體（workout.js）呼叫 ctx.events.emit(type, payload)，宿主把它轉進 {@link createCompanionFeed}，
 * 這支元件訂閱它：
 *   - 每有一下「有效」的 `rep`，主角就做一下同樣的動作（FitnessCharacter 的 sync 模式）；
 *   - 事件經 cheerLines.ts 翻成台詞，用遊戲組 `HintBubble` 說出來，說話時主角改做加油動作。
 *
 * 台詞至少停留 {@link LINE_MIN_MS}：「本組達標」與「休息」常在同一幀發生，若後一句立刻蓋掉前一句，
 * 使用者就看不到達標那句。停留期間又來的台詞依序排隊，最多排 {@link LINE_QUEUE} 句（超過丟最舊的），
 * 所以「第 10 下稱讚」還沒停夠時接著來的「達標」「休息」兩句都說得到。
 *
 * 語音仍由我方語音教練負責，這裡只有字；容器 `role="status" aria-live="polite"`，報讀不打斷語音。
 */
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { HintBubble } from '../UI/DesignKit';
import { FitnessCharacter } from './FitnessCharacter';
import { cheerLine, initialCheerState, type CheerState } from './cheerLines';

/** 一句台詞最少顯示多久才能被下一句換掉。 */
export const LINE_MIN_MS = 1600;
/** 一句台詞顯示多久後收起（沒有新台詞時）。 */
export const LINE_SHOW_MS = 3200;
/** 等著說的台詞最多幾句。 */
export const LINE_QUEUE = 2;

export interface CompanionEvent {
  type: string;
  payload: unknown;
}
export type CompanionListener = (event: CompanionEvent) => void;
export interface CompanionFeed {
  emit(type: string, payload: unknown): void;
  /** 訂閱之後的事件；回傳取消訂閱。不會補送過去的事件（要現況讀 lastPhase）。 */
  subscribe(fn: CompanionListener): () => void;
  /** 最近一次 `phase` 事件：插槽比事件晚一步掛上時，靠它補上現在練哪個動作、在哪個階段。 */
  lastPhase(): CompanionEvent | null;
}

export function createCompanionFeed(): CompanionFeed {
  const listeners = new Set<CompanionListener>();
  let phase: CompanionEvent | null = null;
  return {
    emit(type, payload) {
      const event = { type, payload };
      if (type === 'phase') phase = event;
      listeners.forEach((fn) => fn(event));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    lastPhase: () => phase,
  };
}

/** phase 事件帶的動作 id（沒有就是 null）。 */
function exerciseOf(event: CompanionEvent | null): string | null {
  const p = event?.payload as { exercise?: unknown } | undefined;
  return typeof p?.exercise === 'string' ? p.exercise : null;
}

export function CompanionCoach({ feed }: { feed: CompanionFeed }) {
  const { profile } = useApp();
  const name = profile?.displayName?.trim() || '島嶼主角';
  // 掛上時補讀最近的階段：startLive 在插槽交給宿主的同一刻就發了 ready，那時這裡還沒掛上
  const [exercise, setExercise] = useState(() => exerciseOf(feed.lastPhase()) ?? 'squat');
  const [reps, setReps] = useState(0);
  const [line, setLine] = useState<string | null>(null);

  const cheer = useRef<CheerState>(initialCheerState());
  const shownAt = useRef(0);
  const pending = useRef<string[]>([]);
  const swapTimer = useRef(0);
  const replayed = useRef<CompanionEvent | null>(null);

  useEffect(() => {
    const show = (text: string) => {
      shownAt.current = performance.now();
      setLine(text);
    };
    // 排隊中的台詞：前一句停夠了就說下一句，還有就再等一輪
    const drain = () => {
      swapTimer.current = 0;
      const next = pending.current.shift();
      if (!next) return;
      show(next);
      if (pending.current.length) swapTimer.current = window.setTimeout(drain, LINE_MIN_MS);
    };
    const offer = (text: string) => {
      const wait = LINE_MIN_MS - (performance.now() - shownAt.current);
      if (wait <= 0 && !pending.current.length) return show(text);
      pending.current = [...pending.current, text].slice(-LINE_QUEUE);
      if (!swapTimer.current) swapTimer.current = window.setTimeout(drain, Math.max(0, wait));
    };
    const handle = (event: CompanionEvent) => {
      if (event.type === 'phase') {
        const ex = exerciseOf(event);
        if (ex) setExercise(ex);
        if ((event.payload as { phase?: string } | undefined)?.phase === 'ready') setReps(0);
      }
      if (event.type === 'rep' && (event.payload as { valid?: boolean } | undefined)?.valid) {
        setReps((n) => n + 1);
      }
      const r = cheerLine(event, cheer.current);
      cheer.current = r.state;
      if (r.line) offer(r.line);
    };
    // 掛上前錯過的那個階段（通常是 ready）也要說；開發模式 effect 會跑兩次，同一個事件只補一次
    const missed = feed.lastPhase();
    if (missed && replayed.current !== missed) {
      replayed.current = missed;
      handle(missed);
    }
    const off = feed.subscribe(handle);
    return () => {
      off();
      window.clearTimeout(swapTimer.current);
      swapTimer.current = 0;
      pending.current = [];
    };
  }, [feed]);

  // 台詞停留一段時間後收起（台詞不會連續重複，所以每換一句就重新計時）
  useEffect(() => {
    if (!line) return;
    const id = window.setTimeout(() => setLine(null), LINE_SHOW_MS);
    return () => window.clearTimeout(id);
  }, [line]);

  // 靠右對齊：對話框出現、消失或換句時寬度會變，主角不能跟著左右跳。
  // HintBubble 的箭頭固定在底部正中，對話框比主角寬時會指歪，所以箭頭改由這裡畫、對準主角中線（樣式同 HintBubble 的 arrow）。
  return (
    <div className="pointer-events-none flex flex-col items-end gap-2">
      <div role="status" aria-live="polite" className="flex min-h-[3.75rem] items-end">
        {line && (
          <div className="relative">
            <HintBubble className="px-4 py-2.5 max-w-[15rem]">
              <p className="mb-1 text-[11px] font-black leading-none text-island-teal-dark">{name}</p>
              <p className="text-sm font-bold leading-snug text-island-navy">{line}</p>
            </HintBubble>
            <span className="absolute right-[50px] lg:right-[66px] -bottom-[6px] w-3 h-3 bg-white border-b border-r border-island-line rotate-45 pointer-events-none" />
          </div>
        )}
      </div>
      {/* 寬螢幕放大一級，和左下阿肌的比例相當（原本 1920 寬時主角只有阿肌的一半高）；箭頭跟著對準新的中線 */}
      <div className="relative h-32 w-28 lg:h-40 lg:w-36">
        {/* 落地陰影：主角是透明畫布，沒有這一圈看起來像飄在半空。陰影中心對準實測腳底：兩種框的腳底都在框高約 80% 處（Slice 12 以無頭瀏覽器逐像素量得） */}
        <span
          aria-hidden="true"
          className="absolute bottom-[16%] left-1/2 h-3 w-16 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(38,70,83,0.22),transparent)] lg:w-20"
        />
        {/* 畫布包一層 relative，才會疊在陰影上方（定位元素預設畫在一般流元素之上） */}
        <div className="relative h-full w-full">
          <FitnessCharacter exercise={exercise} mode="sync" reps={reps} cheering={!!line} />
        </div>
      </div>
    </div>
  );
}
