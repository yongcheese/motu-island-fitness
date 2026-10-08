/// <reference types="vite/client" />

// Pulls in Vite's ambient types, chiefly `import.meta.env` (DEV/PROD/MODE).
// Added when Scene.tsx started gating the z-fighting scene audit on
// `import.meta.env.DEV` so the tool ships only in dev builds.

// 關於頁版本資訊（健身組第三階段 Slice 6）：由 vite.config.ts 的 define 在建置時注入。
declare const __APP_BUILD_TIME__: string;
declare const __APP_COMMIT__: string;
