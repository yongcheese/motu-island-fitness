import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
        // 健身組整合：健身頁原始碼只有一份，在上一層的 app/（舊版 :8080 與它的測試照常使用）
        '@fitness': path.resolve(process.cwd(), '../app'),
      },
    },
    build: {
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('@mediapipe') || id.includes('tasks-vision')) {
                return 'mediapipe-vendor';
              }
              if (id.includes('firebase')) {
                return 'firebase-vendor';
              }
              return 'vendor';
            }
          }
        }
      }
    },
    server: {
      // @fitness 指向專案根目錄之外的 ../app，開發伺服器必須允許讀取上一層
      fs: { allow: [path.resolve(process.cwd(), '..')] },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // The project lives under a OneDrive folder, where native file-system
      // events are unreliable: edits on disk never invalidated Vite's
      // transform cache, so the browser kept receiving stale modules even
      // after a full refresh. Polling sidesteps the missing events.
      watch: {
        usePolling: true,
        interval: 300,
      },
    },
  };
});
