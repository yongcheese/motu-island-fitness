/**
 * 開發測試用：開著「示範模式」啟動開發伺服器（健身頁相機失敗時可改用合成動作跑訓練）。
 * 一般 `npm run dev` 與正式 build 都沒有示範模式（見 FitnessHost.tsx 的 ctx.demo）。
 *
 * 用一支腳本設環境變數而不是在 package.json 寫 `VITE_FITNESS_DEMO=1 tsx server.ts`：後者 Windows 不能跑。
 *
 *   npm run dev:demo
 */
process.env.VITE_FITNESS_DEMO = '1';
await import('../server.ts');
