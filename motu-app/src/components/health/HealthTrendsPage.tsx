/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { HealthActivity } from '../../lib/healthData';
import { addCivilDays } from '../../constants/civilTime';
import type { HealthGoals } from './healthGoals';
import type { HealthSnapshot } from './useHealthSnapshot';
import { BigNumber, HEALTH_CARD } from './HealthChrome';
import { BarChart, CATEGORY_COLORS, Donut, HBar, METRIC_STYLE, type HealthMetric } from './HealthCharts';
import { average, repsByType, type WeekTotals } from './healthStats';
import { formatNumber, shortDate } from './healthFormat';

const METRIC_TABS: Array<{ id: HealthMetric; label: string; unit: string }> = [
  { id: 'reps', label: '次數', unit: '下動作' },
  { id: 'minutes', label: '分鐘', unit: '分鐘' },
  { id: 'days', label: '天數', unit: '天' },
];

const pick = (week: WeekTotals, metric: HealthMetric) => week[metric];

/**
 * 「我的趨勢」—— 近 8 週，三種量法切換，點任一根長條看那一週。
 *
 * 本週的長條永遠是虛線框：它只過了幾天，矮不代表退步，而把它畫得跟完整的週一樣會讓每個星期一的
 * 趨勢圖看起來都在崩跌。
 */
export function HealthTrendsPage({
  snapshot,
  goals,
  activities,
}: {
  snapshot: HealthSnapshot;
  goals: HealthGoals;
  activities: readonly HealthActivity[];
}) {
  const { weeks, today } = snapshot;

  const [metric, setMetric] = useState<HealthMetric>('reps');
  const [selected, setSelected] = useState(weeks.length - 2);

  const tab = METRIC_TABS.find((entry) => entry.id === metric) ?? METRIC_TABS[0];
  const style = METRIC_STYLE[metric];
  const values = weeks.map((week) => pick(week, metric));
  const labels = weeks.map((week) => (week.current ? '本週' : shortDate(week.weekStart)));
  const pastAvg = Math.round(average(values.slice(0, -1)));
  const refValue = metric === 'days' ? goals.daysPerWeek : pastAvg;
  const refLabel = metric === 'days' ? `目標 ${goals.daysPerWeek} 天` : pastAvg > 0 ? `平均 ${formatNumber(pastAvg)}` : undefined;

  const sel = weeks[selected] ?? weeks[weeks.length - 1];
  const selValue = pick(sel, metric);
  // 大數字下面那一行講「這一週算多還是少」—— 跟圖上那條虛線（目標或平均）同一個基準，而不是再寫
  // 一次「該週合計」。
  const diff = selValue - pastAvg;
  const note = sel.current
    ? '本週進行中'
    : metric === 'days'
      ? selValue >= goals.daysPerWeek
        ? '該週達成目標'
        : '該週未達成目標'
      : pastAvg === 0
        ? '該週合計'
        : diff === 0
          ? '跟平均一樣'
          : `比平均${diff > 0 ? '多' : '少'} ${formatNumber(Math.abs(diff))} ${metric === 'minutes' ? '分' : '下'}`;

  // 亮點：最近 3 個完整的週 vs 再之前的 3 週。
  const recent3 = weeks.slice(-4, -1);
  const prior3 = weeks.slice(-7, -4);
  const highlights = (['minutes', 'reps'] as const).map((key) => ({
    key,
    now: Math.round(average(recent3.map((week) => week[key]))),
    before: Math.round(average(prior3.map((week) => week[key]))),
  }));

  const mixFrom = addCivilDays(today, -27);
  const mix = useMemo(() => repsByType(activities, mixFrom, today), [activities, mixFrom, today]);
  const mixTotal = mix.reduce((sum, entry) => sum + entry.reps, 0);

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div role="group" aria-label="切換指標" className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-island-sand border border-island-line max-w-md">
        {METRIC_TABS.map((entry) => {
          const on = entry.id === metric;
          return (
            <button
              key={entry.id}
              type="button"
              aria-pressed={on}
              onClick={() => setMetric(entry.id)}
              className={`h-9 rounded-xl text-sm font-black transition-all ${
                on ? 'bg-white text-island-navy shadow-[0_2px_6px_rgba(38,70,83,0.12)]' : 'text-island-navy-soft/70 hover:text-island-navy'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <section aria-label="每週長條圖" className={`${HEALTH_CARD} p-4 sm:p-6 flex flex-col gap-4`}>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-bold text-island-navy-soft/70">{sel.current ? '本週' : `${shortDate(sel.weekStart)} 這一週`}</span>
          <BigNumber value={formatNumber(selValue)} unit={` ${tab.unit}`} size="lg" />
          <span className={`text-xs sm:text-sm font-black ${style.text}`}>{note}</span>
        </div>
        <div className="sm:hidden">
          <BarChart
            values={values}
            height={170}
            color={style.color}
            dim={style.dim}
            max={metric === 'days' ? 7 : undefined}
            selected={selected}
            currentIndex={weeks.length - 1}
            refValue={refValue}
            refLabel={refLabel}
            labels={labels}
            ariaLabels={labels.map((label, i) => `${label} ${values[i]} ${tab.unit}`)}
            onSelect={setSelected}
          />
        </div>
        <div className="hidden sm:block">
          <BarChart
            values={values}
            height={240}
            color={style.color}
            dim={style.dim}
            max={metric === 'days' ? 7 : undefined}
            selected={selected}
            currentIndex={weeks.length - 1}
            refValue={refValue}
            refLabel={refLabel}
            labels={labels}
            ariaLabels={labels.map((label, i) => `${label} ${values[i]} ${tab.unit}`)}
            onSelect={setSelected}
          />
        </div>
        <p className="text-xs font-bold text-island-navy-soft/60 text-center">點任一週的長條，看當週的數字</p>
      </section>

      {/* 第二層：兩張亮點與動作分布。三張都是「一個小圖＋一句話」的份量，桌機排成一列 —— 動作分布曾
          經自己佔一整列，甜甜圈加兩行字擺在 1100px 寬的卡片左邊，右邊大半是空的。1280px 以下（平板、
          小筆電）兩張亮點並排、分布在下面跨兩欄 —— 三欄在 1024px 時每張不到 300px，項目名稱會被截掉；
          手機一欄。三張卡各自有標題，所以上面不再另外掛一個「亮點」—— 它會變成
          動作分布的標題，而分布不是亮點。 */}
      <div className="mt-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        {highlights.map((entry) => (
          <Highlight key={entry.key} metric={entry.key} now={entry.now} before={entry.before} />
        ))}

        {/* 這一頁曾經在最底下再放一次本月月曆。月曆回答的是「哪幾天有動、那天做了什麼」，屬於活動
            紀錄頁（首頁的 N 月卡也改成進那裡）；趨勢頁只講一週一週的量。 */}
        <section aria-label="近 4 週做了哪些動作" className={`${HEALTH_CARD} md:col-span-2 xl:col-span-1 p-4 sm:p-5 flex flex-col gap-4`}>
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-black text-island-navy truncate">近 4 週做了哪些動作</h3>
            <span className="text-xs font-bold text-island-navy-soft/70 flex-shrink-0">共 {formatNumber(mixTotal)} 下</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <Donut
              className="w-20 sm:w-28"
              label={`動作分布：${mix.map((entry) => `${entry.type} ${entry.reps}`).join('、') || '沒有紀錄'}`}
              parts={mix.map((entry, i) => ({ value: entry.reps, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }))}
            />
            <ul className="flex-1 min-w-0 max-w-md flex flex-col gap-2.5">
              {mix.length === 0 && <li className="text-sm font-bold text-island-navy-soft/70">近 4 週還沒有動作紀錄。</li>}
              {mix.map((entry, i) => (
                <li key={entry.type} className="flex items-center gap-2 text-sm">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                  <span className="flex-1 min-w-0 font-bold text-island-navy truncate">{entry.type}</span>
                  <span className="font-black font-mono text-island-navy">{formatNumber(entry.reps)}</span>
                  <span className="w-10 text-right text-xs font-bold text-island-navy-soft/70">{mixTotal > 0 ? Math.round((entry.reps / mixTotal) * 100) : 0}%</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

/** 一張亮點卡：近 3 週 vs 之前 3 週，兩條長條直接比。 */
function Highlight({ metric, now, before }: { metric: 'minutes' | 'reps'; now: number; before: number }) {
  const style = METRIC_STYLE[metric];
  const unit = metric === 'minutes' ? '分' : '下';
  const noun = metric === 'minutes' ? '運動時間' : '動作次數';
  const diff = now - before;
  const Icon = diff > 0 ? ArrowUp : diff < 0 ? ArrowDown : Minus;
  const title = now === 0 && before === 0 ? `還沒有${noun}紀錄` : diff > 0 ? `${noun}變多了` : diff < 0 ? `${noun}變少了` : `${noun}持平`;
  const top = Math.max(1, now, before);
  return (
    <section aria-label={title} className={`${HEALTH_CARD} p-4 sm:p-5 flex flex-col gap-3`}>
      <div className={`flex items-center gap-1.5 text-[15px] font-black ${style.text}`}>
        <Icon size={17} strokeWidth={2.8} />
        {title}
      </div>
      <p className="text-sm font-bold text-island-navy-soft leading-relaxed">
        近 3 週平均每週 <b className="text-island-navy">{formatNumber(now)} {unit}</b>，之前 3 週是 {formatNumber(before)} {unit}。
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <HBar ratio={now / top} color={style.color} thick />
          </div>
          <span className="w-16 text-right text-xs font-black font-mono text-island-navy">{formatNumber(now)} {unit}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <HBar ratio={before / top} color={style.dim} thick />
          </div>
          <span className="w-16 text-right text-xs font-bold font-mono text-island-navy-soft/70">{formatNumber(before)} {unit}</span>
        </div>
      </div>
    </section>
  );
}
