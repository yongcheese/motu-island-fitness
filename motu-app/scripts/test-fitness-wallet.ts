/**
 * 健身頁資源列與餘額訊息（src/components/fitness/FitnessWallet.tsx）。
 *
 * 鎖住三件事：
 *   1. 數字縮寫與遊戲組 TopBar 同規則（照抄的那份不能悄悄走樣）；
 *   2. 餘額訊息：宿主發布 → 訂閱者收到、沒變不吵、取消訂閱後不再收到；
 *   3. 資源列畫出來的是訊息裡的數字（念出完整數字、畫面縮寫），存檔一變畫面就跟著變。
 *
 *   npm run test:fitness
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FitnessWallet, createBalanceFeed, shortNumber, type BalanceFeed } from '../src/components/fitness/FitnessWallet';
import { balancesFromProfile, type FitnessBalances } from '../src/components/fitness/gameContract';
import type { UserProfile } from '../src/types';

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

const bal = (coins: number, fragments: number, xp = 0, level = 1): FitnessBalances => ({ coins, fragments, xp, level });
const render = (feed: BalanceFeed) => renderToStaticMarkup(createElement(FitnessWallet, { feed }));

console.log('數字縮寫（同遊戲組 TopBar）');
ok('0 → "0"', shortNumber(0) === '0', shortNumber(0));
ok('9,999 以下照原數加千分位', shortNumber(9_999) === (9_999).toLocaleString(), shortNumber(9_999));
ok('邊界 10,000 → "10.0K"', shortNumber(10_000) === '10.0K', shortNumber(10_000));
ok('12,345 → "12.3K"', shortNumber(12_345) === '12.3K', shortNumber(12_345));
ok('邊界 1,000,000 → "1.0M"', shortNumber(1_000_000) === '1.0M', shortNumber(1_000_000));
ok('2,500,000 → "2.5M"', shortNumber(2_500_000) === '2.5M', shortNumber(2_500_000));

console.log('餘額訊息');
{
  const feed = createBalanceFeed(bal(100, 5));
  const got: FitnessBalances[] = [];
  const off = feed.subscribe((b) => got.push(b));
  ok('訂閱時不立刻回呼', got.length === 0);

  const before = feed.balances();
  feed.publish(bal(100, 5));
  ok('四個數字都沒變 → 不通知', got.length === 0);
  ok('沒變 → balances() 仍是同一個物件（React 不重畫）', feed.balances() === before);

  feed.publish(bal(250, 5));
  ok('金幣變動 → 通知一次且帶新值', got.length === 1 && got[0].coins === 250, JSON.stringify(got));
  ok('balances() 回傳新值', feed.balances().coins === 250);

  feed.publish(bal(250, 5, 0, 2));
  ok('只有等級變動也要通知', got.length === 2);

  off();
  feed.publish(bal(999, 9));
  ok('取消訂閱後不再收到', got.length === 2);
  ok('取消訂閱後 balances() 仍更新', feed.balances().coins === 999);
}
{
  const feed = createBalanceFeed(bal(0, 0));
  let second = 0;
  const offFirst = feed.subscribe(() => offFirst());
  feed.subscribe(() => (second += 1));
  feed.publish(bal(1, 0));
  ok('回呼中取消自己的訂閱，不影響同一輪的其他訂閱者', second === 1);
}

console.log('資源列畫面');
{
  const profile = { balanceGold: 1234, wallet: { fragments: 56 }, currentXp: 0 } as unknown as UserProfile;
  const feed = createBalanceFeed(balancesFromProfile(profile));
  const html = render(feed);
  ok('金幣念出完整數字', html.includes('aria-label="金幣 1234"'), html);
  ok('碎片念出完整數字', html.includes('aria-label="碎片 56"'), html);
  ok('畫面顯示千分位', html.includes('1,234'), html);

  feed.publish(balancesFromProfile({ ...profile, balanceGold: 48_000 } as UserProfile));
  const after = render(feed);
  ok('存檔變動後重畫 → 新數字（大數字縮寫）', after.includes('aria-label="金幣 48000"') && after.includes('48.0K'), after);

  const empty = render(createBalanceFeed(balancesFromProfile(null)));
  ok('profile 尚未載入 → 顯示 0，不是空白或 NaN', empty.includes('aria-label="金幣 0"') && !empty.includes('NaN'), empty);
}

console.log(`\n${checks - failures}/${checks} 通過`);
if (failures > 0) process.exit(1);
