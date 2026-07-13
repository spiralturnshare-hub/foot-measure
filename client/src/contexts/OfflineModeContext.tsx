/**
 * OfflineModeContext.tsx
 * オンライン/オフラインモードの状態管理Context
 *
 * - isOfflineMode: ユーザーが手動で選択したモード（true=オフライン、false=オンライン）
 * - isNetworkOnline: ブラウザのネットワーク接続状態（navigator.onLine）
 * - toggleOfflineMode: モードを切り替える
 *
 * オフラインモードでの計測は「一時的な計測」として扱い、
 * データ保存・同期は一切行わない。
 */
import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface OfflineModeContextValue {
  /** ユーザーが選択したオフラインモード */
  isOfflineMode: boolean;
  /** ブラウザのネットワーク接続状態 */
  isNetworkOnline: boolean;
  /** モードを切り替える */
  toggleOfflineMode: () => void;
}

const OfflineModeContext = createContext<OfflineModeContextValue | null>(null);

const STORAGE_KEY = "feet-meter-offline-mode";

export function OfflineModeProvider({ children }: { children: React.ReactNode }) {
  // localStorageから前回の選択を復元
  const [isOfflineMode, setIsOfflineMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [isNetworkOnline, setIsNetworkOnline] = useState<boolean>(navigator.onLine);

  // ネットワーク状態の監視（同期処理なし）
  useEffect(() => {
    const handleOnline = () => setIsNetworkOnline(true);
    const handleOffline = () => setIsNetworkOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const toggleOfflineMode = useCallback(() => {
    setIsOfflineMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return (
    <OfflineModeContext.Provider
      value={{
        isOfflineMode,
        isNetworkOnline,
        toggleOfflineMode,
      }}
    >
      {children}
    </OfflineModeContext.Provider>
  );
}

export function useOfflineMode() {
  const ctx = useContext(OfflineModeContext);
  if (!ctx) {
    throw new Error("useOfflineMode must be used within OfflineModeProvider");
  }
  return ctx;
}
