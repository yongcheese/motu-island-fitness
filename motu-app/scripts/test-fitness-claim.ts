/**
 * 逐項領獎的狀態機（src/components/fitness/claimMachine.ts）與畫面的靜態輸出（ClaimSequence.tsx）。
 *
 * 鎖住五件事：
 *   1. 主流程：揭曉 → 可領 → 飛行 → 下一項 …… → 結尾 → 結束；
 *   2. 輸入閘：揭曉中、飛行中、結尾淡入中的輸入一律忽略（連按不會跳過項目）；
 *   3. 空清單直接結束；只有金幣時只演一項；
 *   4. 資源列數字＝發獎前餘額＋已飛抵的獎勵（飛行中還沒入帳）；碎片只算本次；
 *   5. 畫面第一格：顯示第一項的數量與進度、資源列只列清單裡有的種類。
 *
 *   npm run test:fitness
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  acceptsInput,
  claimBarKinds,
  claimBarValues,
  initialClaim,
  landedTotals,
  stepClaim,
  type ClaimEvent,
  type ClaimState,
} from '../src/components/fitness/claimMachine';
import type { Award } from '../src/components/fitness/gameContract';

let checks = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail = '') {
  checks += 1;
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures += 1;
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

const FULL: Award[] = [
  { kind: 'coins', amount: 10 },
  { kind: 'xp', amount: 64 },
  { kind: 'fragments', amount: 6 },
];

function run(queue: Award[], events: ClaimEvent[], from: ClaimState = initialClaim(queue)) {
  const trail = [from];
  for (const e of events) trail.push(stepClaim(trail[trail.length - 1], e, queue));
  return trail;
}
const sig = (s: ClaimState) => `${s.phase}#${s.index}/${s.landed}`;

console.log('\n1. 主流程');
{
  const trail = run(FULL, ['settled', 'input', 'landed', 'settled', 'input', 'landed', 'settled', 'input', 'landed', 'settled', 'input']);
  const got = trail.map(sig).join(' → ');
  const want = [
    'reveal#0/0', 'ready#0/0', 'flying#0/0', 'reveal#1/1', 'ready#1/1', 'flying#1/1',
    'reveal#2/2', 'ready#2/2', 'flying#2/2', 'outro-in#3/3', 'outro#3/3', 'done#3/3',
  ].join(' → ');
  ok('三項依序演完才結束', got === want, got);
  ok('只有「可領」與「結尾」接受輸入', trail.filter(acceptsInput).map((s) => s.phase).join(',') === 'ready,ready,ready,outro');
}

console.log('\n2. 輸入閘');
{
  const start = initialClaim(FULL);
  ok('揭曉中按鍵被忽略（同一個狀態）', stepClaim(start, 'input', FULL) === start);
  const flying = run(FULL, ['settled', 'input']).pop()!;
  ok('飛行中按鍵被忽略', stepClaim(flying, 'input', FULL) === flying);
  // 連按 10 次：揭曉落定前的 5 次全部被吃掉，落定後第 1 次開始飛，其餘 4 次在飛行中被吃掉
  const mash = run(FULL, [...Array(5).fill('input'), 'settled', ...Array(5).fill('input')]).pop()!;
  ok('連按不會跳過項目（仍在第 1 項飛行中）', sig(mash) === 'flying#0/0', sig(mash));
  const outroIn = run([FULL[0]], ['settled', 'input', 'landed']).pop()!;
  ok('結尾淡入中按鍵被忽略', outroIn.phase === 'outro-in' && stepClaim(outroIn, 'input', [FULL[0]]) === outroIn);
  ok('可領階段收到遲到的「落定」不會亂跳', (() => {
    const ready = run(FULL, ['settled']).pop()!;
    return stepClaim(ready, 'settled', FULL) === ready && stepClaim(ready, 'landed', FULL) === ready;
  })());
  const done = run([FULL[0]], ['settled', 'input', 'landed', 'settled', 'input']).pop()!;
  ok('結束後任何事件都不再改變', (['settled', 'input', 'landed'] as ClaimEvent[]).every((e) => stepClaim(done, e, [FULL[0]]) === done));
}

console.log('\n3. 邊界：空清單、只有金幣');
{
  const empty = initialClaim([]);
  ok('空清單一開始就是結束', empty.phase === 'done');
  ok('空清單不接受輸入', !acceptsInput(empty));
  const coins: Award[] = [{ kind: 'coins', amount: 3 }];
  const trail = run(coins, ['settled', 'input', 'landed', 'settled', 'input']);
  ok('只有金幣：演一項就進結尾', trail.map(sig).join(' → ') === 'reveal#0/0 → ready#0/0 → flying#0/0 → outro-in#1/1 → outro#1/1 → done#1/1');
  ok('只有金幣：資源列只有金幣一欄', claimBarKinds(coins).join(',') === 'coins');
}

console.log('\n4. 資源列數字');
{
  const before = { coins: 100, xp: 90 };
  ok('一開始＝發獎前餘額、碎片 0', JSON.stringify(claimBarValues(before, FULL, 0)) === JSON.stringify({ coins: 100, xp: 90, fragments: 0 }));
  ok('金幣飛抵後才加（飛行中仍是 100）', (() => {
    const flying = run(FULL, ['settled', 'input']).pop()!;
    const landed = stepClaim(flying, 'landed', FULL);
    return claimBarValues(before, FULL, flying.landed).coins === 100 && claimBarValues(before, FULL, landed.landed).coins === 110;
  })());
  ok('全部飛抵＝餘額＋公式值（經驗可跨級）', JSON.stringify(claimBarValues(before, FULL, 3)) === JSON.stringify({ coins: 110, xp: 154, fragments: 6 }));
  ok('同一種出現兩次會相加', landedTotals([{ kind: 'coins', amount: 2 }, { kind: 'coins', amount: 5 }], 2).coins === 7);
  ok('landed 超出或為負數不出錯', landedTotals(FULL, 99).xp === 64 && landedTotals(FULL, -1).coins === 0);
  ok('資源列欄位順序同清單', claimBarKinds(FULL).join(',') === 'coins,xp,fragments');
}

console.log('\n5. 畫面第一格（靜態輸出）');
{
  // 畫面元件會碰 window（音效、震動只在計時器裡），靜態輸出只跑第一次 render，不會觸發
  const { ClaimSequence } = await import('../src/components/fitness/ClaimSequence');
  const html = renderToStaticMarkup(createElement(ClaimSequence, { awards: FULL, before: { coins: 100, xp: 90 }, onDone: () => {} }));
  ok('是對話框、有標題', html.includes('role="dialog"') && html.includes('aria-label="領取訓練獎勵"'));
  ok('第一格演第一項：+10 與進度 1 / 3', html.includes('+10') && html.includes('訓練獎勵 1 / 3'));
  ok('第一格還不能領（提示字隱藏）', /opacity-0[^"]*">按任意鍵領取/.test(html));
  ok('資源列三欄：金幣 100、LV 1、本次商品碎片 0', html.includes('aria-label="金幣 100"') && html.includes('LV 1') && html.includes('aria-label="本次商品碎片 0"'));
  const onlyCoins = renderToStaticMarkup(createElement(ClaimSequence, { awards: [FULL[0]], before: { coins: 0, xp: 0 }, onDone: () => {} }));
  ok('只有金幣時資源列沒有經驗與碎片', onlyCoins.includes('aria-label="金幣 0"') && !onlyCoins.includes('LV ') && !onlyCoins.includes('商品碎片 0'));
}

console.log(`\n${checks - failures}/${checks} passed`);
if (failures) process.exit(1);
