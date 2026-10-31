/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { ChevronRight } from 'lucide-react';
import { ACTIVITY_FETCH_LIMIT } from '../../lib/healthData';
import type { HealthSnapshot } from './useHealthSnapshot';
import { BigNumber, HEALTH_CARD } from './HealthChrome';
import { BarChart, CATEGORY_COLORS } from './HealthCharts';
import { average, type PersonalBest } from './healthStats';
import { activityCivilDate, durationLabel, formatNumber, shortDate } from './healthFormat';

/** 紀錄進展最多畫幾步。更早的收成一個「…」：手機上一行放得下五格。 */
const PROGRESSION_STEPS = 5;

/**
 * 「個人紀錄」—— 每個項目單次最多做過幾下。
 *
 * 只放「單次」的紀錄。「連續達標」「單週最多天數」這種持續性的紀錄回答的是另一個問題（我有沒有
 * 一直在動），在連續達標頁（HealthStreakPage）—— 它們曾經放在這一頁的下半，結果從首頁點「連續達
 * 標」進來，第一眼看到的是一排各項目的獎牌。
 *
 * ## 一個項目一張卡
 *
 * 這一頁曾經只有每個項目一顆獎牌（一個數字＋日期）和一條「最長單次運動」：三個數字撐一整頁，桌
 * 機上是一排四格只填了兩格、下半頁全空。缺的不是更多卡片，而是讓那個紀錄看得懂的東西 —— 「42
 * 下」是遙不可及還是上週才做到？所以每張卡由上往下是：
 *
 *  1. **紀錄**：獎牌、哪一天創下、是不是最近 7 天的新紀錄，以及它是怎麼一路刷新上來的。
 *  2. **最近幾次**：長條圖加一條紀錄線，創紀錄的那一次是實心的 —— 一眼看出最近離紀錄多遠。
 *  3. **補充**：最近幾次的平均、最長一次、總共做過幾次。
 *
 * 「最長單次運動」原本是全頁一條，現在是每個項目各自的「最長一次」：全頁那一條就是其中較長的那
 * 個，留著會是同一個數字講兩次。
 *
 * 桌機兩欄（目前健身做得出來的是兩個項目），手機一欄 —— 一張卡塞進半個手機寬，長條會只剩幾 px。
 *
 * 獎牌的顏色是類別色（同一個項目在趨勢頁的甜甜圈裡也是這個順序），不是金銀銅 —— `island-gold`
 * 是金幣專用，而這裡也沒有名次。
 */
export function HealthRecordsPage({ snapshot }: { snapshot: HealthSnapshot }) {
  const { bests, mayBeTruncated } = snapshot;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {bests.map((entry, i) => (
          <RecordCard key={entry.type} entry={entry} color={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
        ))}
      </div>
      <p className="text-[11px] font-bold text-island-navy-soft/60">
        「新紀錄」是最近 7 天內刷新的。
        {mayBeTruncated ? `紀錄只計算最近 ${ACTIVITY_FETCH_LIMIT} 次運動。` : ''}
      </p>
    </div>
  );
}

function RecordCard({ entry, color }: { entry: PersonalBest; color: string }) {
  const { type, best, fresh, sessions, latest, longest, recent, progression } = entry;
  const dim = `color-mix(in srgb, ${color} 30%, white)`;

  return (
    <section aria-label={`${type} 的紀錄`} className={`${HEALTH_CARD} p-4 sm:p-5 flex flex-col gap-4`}>
      {/* 第一層：紀錄 */}
      <div className="flex items-center gap-4 min-w-0">
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-[6px] flex flex-col items-center justify-center flex-shrink-0"
          style={{ borderColor: best ? color : 'var(--color-island-line)', background: `color-mix(in srgb, ${color} 9%, white)` }}
        >
          <span className="text-2xl sm:text-3xl font-black font-mono text-island-navy leading-none">{best ? formatNumber(best.reps) : '—'}</span>
          <span className="text-xs font-bold text-island-navy-soft/70 mt-1">下</span>
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="min-w-0 text-lg sm:text-xl font-black text-island-navy tracking-tight leading-snug line-clamp-2 break-all">{type}</h3>
            {fresh && <span className="text-[11px] font-black px-2.5 py-0.5 rounded-full bg-island-teal text-white flex-shrink-0">新紀錄</span>}
          </div>
          <p className="text-xs sm:text-sm font-bold text-island-navy-soft/70 truncate">
            {best ? `單次最多 · ${shortDate(activityCivilDate(best))} 創下` : sessions > 0 ? `做過 ${formatNumber(sessions)} 次` : '還沒做過'}
          </p>
        </div>
      </div>

      {/* 紀錄是怎麼一路刷新上來的。只做過一次（還沒刷新過）就不畫 —— 一格的「進展」不是進展。 */}
      {progression.length > 1 && (
        <div className="flex flex-col gap-2 border-t border-island-line pt-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-black text-island-navy">紀錄進展</span>
            <span className="text-xs font-bold text-island-navy-soft/70">刷新過 {progression.length - 1} 次</span>
          </div>
          <ol className="flex items-center gap-1 flex-wrap" aria-label={`${type} 的紀錄進展`}>
            {progression.length > PROGRESSION_STEPS && (
              <li className="text-sm font-black text-island-navy-soft/50 px-1" aria-hidden="true">
                …
              </li>
            )}
            {progression.slice(-PROGRESSION_STEPS).map((step, i, shown) => {
              const current = i === shown.length - 1;
              return (
                <li key={step.activityId} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight size={14} strokeWidth={2.6} className="text-island-navy-soft/40 flex-shrink-0" aria-hidden="true" />}
                  <span
                    aria-label={`${shortDate(activityCivilDate(step))} ${step.reps} 下`}
                    className="min-w-12 px-2 py-1 rounded-xl border flex flex-col items-center leading-none"
                    style={
                      current
                        ? { borderColor: color, background: `color-mix(in srgb, ${color} 12%, white)` }
                        : { borderColor: 'var(--color-island-line)', background: 'var(--color-island-cream-2)' }
                    }
                  >
                    <span className="text-sm font-black font-mono text-island-navy">{formatNumber(step.reps)}</span>
                    <span className="text-[10px] font-bold text-island-navy-soft/70 mt-1">{shortDate(activityCivilDate(step))}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {!best || !latest ? (
        <p className="text-sm font-bold text-island-navy-soft/70 leading-relaxed border-t border-island-line pt-3">
          {sessions > 0
            ? '這個項目的紀錄裡沒有偵測到動作次數，所以還沒有「單次最多」。'
            : `完成一次${type}，這裡會記下你最多做過幾下，以及之後每一次離紀錄多遠。`}
        </p>
      ) : (
        <>
          {/* 第二層：最近幾次離紀錄多遠 */}
          <div className="flex flex-col gap-2 border-t border-island-line pt-3">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
              <span className="text-sm font-black text-island-navy">最近 {recent.length} 次</span>
              <span className="text-xs font-bold text-island-navy-soft/70">
                {latest.activityId === best.activityId ? (
                  '上一次就是紀錄'
                ) : (
                  <>
                    上一次 <b className="font-black font-mono text-island-navy">{formatNumber(latest.reps)}</b> 下，差紀錄{' '}
                    {formatNumber(Math.max(0, best.reps - latest.reps))} 下
                  </>
                )}
              </span>
            </div>
            <BarChart
              values={recent.map((activity) => activity.reps)}
              height={72}
              // 紀錄線不貼著頂：留一點高度給「紀錄 42」那個標籤。
              max={best.reps * 1.25}
              color={color}
              dim={dim}
              selected={recent.findIndex((activity) => activity.activityId === best.activityId)}
              refValue={best.reps}
              refLabel={`紀錄 ${formatNumber(best.reps)}`}
              ariaLabels={recent.map((activity) => `${shortDate(activityCivilDate(activity))} ${activity.reps} 下`)}
            />
          </div>

          {/* 第三層：補充 */}
          <dl className="grid grid-cols-3 gap-2 border-t border-island-line pt-3">
            {/* 平均跟旁邊的長條圖是同一段：最近那幾次。 */}
            <Fact label={`近 ${recent.length} 次平均`} value={<BigNumber value={formatNumber(average(recent.map((activity) => activity.reps)))} unit=" 下" size="sm" />} />
            <Fact label="最長一次" value={longest ? <Duration seconds={longest.durationSeconds} /> : <BigNumber value="—" size="sm" />} />
            <Fact label="做過" value={<BigNumber value={formatNumber(sessions)} unit=" 次" size="sm" />} />
          </dl>
        </>
      )}
    </section>
  );
}

/** `12 分 30 秒` 畫成跟 {@link BigNumber} 一樣：數字大、單位小。 */
function Duration({ seconds }: { seconds: number }) {
  return (
    <span className="text-lg sm:text-xl font-black font-mono text-island-navy leading-none tracking-tight">
      {durationLabel(seconds)
        .split(/(\d+)/)
        .filter(Boolean)
        .map((part, i) =>
          /^\d+$/.test(part) ? (
            <span key={i}>{part}</span>
          ) : (
            <span key={i} className="text-sm sm:text-base font-bold font-sans text-island-navy-soft/70 tracking-normal">
              {part}
            </span>
          ),
        )}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <dt className="text-xs font-bold text-island-navy-soft/70 truncate">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}
