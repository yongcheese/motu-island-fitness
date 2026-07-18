// 動作註冊表。MVP 完整實作 + 測試：squat / jumpingjack / highknees / pushup。
// 其餘 6 項以規格占位（meta + 規劃中標記），於 UI 顯示「即將推出」。
import { squat } from './squat.js';
import { jumpingjack } from './jumpingjack.js';
import { highknees } from './highknees.js';
import { pushup } from './pushup.js';

export const EXERCISES = { squat, jumpingjack, highknees, pushup };

// 規劃中（企劃第二、三階段）— 供 UI 列表展示完整 10 項
export const PLANNED = [
  { id: 'lunge', name: '弓箭步', group: 'lower', difficulty: 2, met: 5.4 },
  { id: 'burpee', name: '波比跳', group: 'cardio', difficulty: 3, met: 8.0 },
  { id: 'situp', name: '仰臥起坐', group: 'core', difficulty: 2, met: 8.0 },
  { id: 'crunch', name: '捲腹', group: 'core', difficulty: 1, met: 6.0 },
  { id: 'glutebridge', name: '臀橋', group: 'glute', difficulty: 1, met: 5.0 },
  { id: 'sidelunge', name: '側弓步', group: 'glute', difficulty: 2, met: 5.4 },
];

export const GROUPS = {
  lower: '下肢', cardio: '全身有氧', upper: '上肢', core: '核心', glute: '臀腿',
};
