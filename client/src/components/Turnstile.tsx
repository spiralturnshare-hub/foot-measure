import { useEffect, useRef } from 'react';

// ============================================================
// Cloudflare Turnstile ウィジェット
// ============================================================
// 何をする / なぜ必要か:
//   2026-09-10 に upload-center の電話番号ログイン対策として Green Supabase の
//   Auth > Attack Protection > Enable Captcha protection(= Turnstile)を ON にした。
//   これは電話認証だけでなく signInWithOtp(メール)を含む全ての認証リクエストに
//   captchaToken を必須化する「プロジェクト全体」の設定。トークンの無い要求は
//   Supabase が 400「captcha protection: request disallowed (no captcha_token found)」で拒否する。
//   → foot-measure のメールログイン(確認コード送信)にも Turnstile トークンが要る。
//
// どこと繋がるか:
//   - index.html が読み込む https://challenges.cloudflare.com/turnstile/v0/api.js(window.turnstile)。
//   - サイトキー: import.meta.env.VITE_TURNSTILE_SITE_KEY(Vercel 環境変数・公開して良い値)。
//     Supabase の captcha secret はプロジェクトに1枠のため、全 Green アプリで
//     upload-center と「同一の」Turnstile ウィジェット / サイトキーを共用する。
//   - Cloudflare 側でこのウィジェットの Hostname 許可リストに本アプリの配信ドメイン
//     (footmeasure.insoleorder.jp / foot-measure の vercel.app エイリアス等)を追加すること。docs/27 §5b-1。
//
// なぜこう作ったか:
//   npm 依存を増やさず、スクリプトタグ + window.turnstile.render の明示レンダリングで最小実装。
//   upload-center/client/src/components/Turnstile.tsx のミラー。
//   サイトキー未設定時はウィジェットを出さず素通り(プレビュー/ローカルで詰まらせない)。
// ============================================================

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          size?: 'normal' | 'flexible' | 'compact';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Props {
  /** トークン取得時に呼ばれる。期限切れ/エラー時は null で呼ばれる。 */
  onToken: (token: string | null) => void;
}

export default function Turnstile({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY) {
      if (import.meta.env.PROD) {
        console.warn('[Turnstile] VITE_TURNSTILE_SITE_KEY 未設定。captcha 保護が有効な Supabase ではログインできません。');
      }
      return;
    }

    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      const el = containerRef.current;
      if (!window.turnstile || !el) {
        window.setTimeout(tryRender, 200); // api.js のロード待ち
        return;
      }
      if (widgetIdRef.current) return; // 二重レンダリング防止
      widgetIdRef.current = window.turnstile.render(el, {
        sitekey: SITE_KEY,
        size: 'flexible',
        callback: (token) => onTokenRef.current(token),
        'expired-callback': () => onTokenRef.current(null),
        'error-callback': () => onTokenRef.current(null),
      });
    };
    tryRender();

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* 破棄失敗は無視 */
        }
        widgetIdRef.current = null;
      }
    };
  }, []);

  if (!SITE_KEY) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}

/** Supabase にトークンを渡す必要があるか(サイトキーが設定されているか) */
export const turnstileEnabled = Boolean(SITE_KEY);
