import { registerSW } from 'virtual:pwa-register';
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Service Worker登録（PWAオフライン対応）
if (import.meta.env.PROD) {
  registerSW({
    onNeedRefresh() {
      // 新しいコンテンツが利用可能な場合（自動更新のため何もしない）
    },
    onOfflineReady() {
      console.log('[PWA] オフラインで使用できる状態になりました');
    },
  });
}

createRoot(document.getElementById("root")!).render(<App />);
