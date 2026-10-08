/**
 * 關於頁的純資料（第三階段 Slice 6）：版本、製作團隊、資料來源。
 *
 * - 團隊只寫分組與負責範圍，不寫個人姓名（專案既定分工）。
 * - 運動安全建議直接沿用健身頁「運動前須知」的 SAFETY_SOURCES（已逐句對照原文），不另抄一份。
 * - 開源技術的授權名稱一律從套件的 package.json 讀出（2026-10-09）：
 *     @mediapipe/tasks-vision 0.10.35 → "license": "Apache-2.0"
 *     three 0.184.0                  → "license": "MIT"
 *     react 19.2.5                   → "license": "MIT"
 *   網址：three／react 取 package.json 的 homepage；MediaPipe 的 homepage 是 http，
 *   改用該套件 README 指向的 Pose Landmarker 官方文件（https）。
 * - 版本不寫死：建置時由 vite.config.ts 的 define 注入 __APP_BUILD_TIME__／__APP_COMMIT__。
 */
import { SAFETY_SOURCES } from '@fitness/features/workout/safety.js';

export interface AboutSource {
  name: string;
  url: string;
  note?: string;
  license?: string;
}

export interface AboutSourceGroup {
  title: string;
  sources: readonly AboutSource[];
}

export interface AboutTeamGroup {
  group: string;
  duties: readonly string[];
}

export const ABOUT_TEAM: readonly AboutTeamGroup[] = [
  { group: '健身組', duties: ['AI 動作判定', '健身訓練頁', '健身設定'] },
  { group: '遊戲組', duties: ['島嶼遊戲', '商店', '健康頁', '登入與雲端存檔'] },
];

/** 運動安全建議：與健身頁「運動前須知」同一份來源。 */
export const ABOUT_SAFETY_SOURCES: readonly AboutSource[] = SAFETY_SOURCES.map((s) => ({
  name: s.name,
  url: s.url,
  note: `資料日期：${s.date}`,
}));

export const ABOUT_TECH_SOURCES: readonly AboutSource[] = [
  {
    name: 'MediaPipe Pose Landmarker（Google）',
    url: 'https://developers.google.com/mediapipe/solutions/vision/pose_landmarker/web_js',
    note: '人體姿勢偵測',
    license: 'Apache-2.0',
  },
  { name: 'Three.js', url: 'https://threejs.org/', note: '3D 島嶼與角色繪製', license: 'MIT' },
  { name: 'React', url: 'https://react.dev/', note: '介面框架', license: 'MIT' },
];

export const ABOUT_SOURCE_GROUPS: readonly AboutSourceGroup[] = [
  { title: '運動安全建議', sources: ABOUT_SAFETY_SOURCES },
  { title: '開源技術', sources: ABOUT_TECH_SOURCES },
];

export interface AppBuildInfo {
  /** 建置時間（ISO 字串）；沒經過 Vite 注入時為 null */
  buildTime: string | null;
  /** git commit 短碼；取不到時為 'unknown' */
  commit: string;
}

/** 讀建置時注入的版本資訊；純 node 執行（測試）時常數不存在，回退成 null／'unknown'。 */
export function getBuildInfo(): AppBuildInfo {
  const buildTime = typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : null;
  const commit = typeof __APP_COMMIT__ === 'string' && __APP_COMMIT__ ? __APP_COMMIT__ : 'unknown';
  return { buildTime, commit };
}

/** ISO 時間 → 使用者當地的 YYYY-MM-DD；無效或缺值回「未知」。 */
export function formatBuildDate(iso: string | null): string {
  if (!iso) return '未知';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
