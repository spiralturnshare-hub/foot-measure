// ============================================================
// SPIRAL TURN - ログインページ(確認コード直接入力方式)
// foot-measure: 特定ユーザーのみアクセス可能
//
// 【方式 / 過去の失敗と対策 (2026-08-28)】
//   以前はメールで届く「マジックリンク」をタップさせる方式だったが、モバイルで
//   機能しないことが判明(アプリ内ブラウザにセッションが隔離される / Gmail の
//   URL 先読みでトークンが消費される)。詳細は lib/supabase.ts の注釈参照。
//   → 現在は「メール送信 → 画面で確認コードを入力 → verifyOtp」の2ステップ。
//   接続先: Supabase Auth(Green fhamrkmsxidxayaoexso)。verifyOtp は RLS を通らない。
// ============================================================
import { useEffect, useState } from 'react';
import { Ruler, Loader2, Mail, KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// 確認コードの許容桁数。Supabase の Email OTP Length 設定(既定6)に追従できるよう
// 固定長にせず幅を持たせる。generate_link は現状8桁を返すことがある。
const OTP_MIN_LEN = 4;
const OTP_MAX_LEN = 10;

// 送信ボタンの機械的ロック秒数(誤操作の二重クリック防止)。
// Supabase Auth の同一メール宛の再送ブロックは実測で約30秒あり、それは
// 案内文で「30秒ほどお待ちください」と伝える。ここは短め(12秒)にして
// ボタンが固まって見える時間を抑える。ブロック中に押した場合は
// エラー文言の "after N seconds" を読んでロックをその秒数まで延長する
// (下の handleSendCode を参照)。
const RESEND_COOLDOWN_SEC = 12;

// Supabase の「送信頻度オーバー」エラーか判定する。
// HTTP 429、または "... after N seconds" という文言を持つエラーを対象にする。
function isSendRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 429) return true;
  return typeof e.message === 'string' && /after \d+ seconds?/i.test(e.message);
}

export default function Login() {
  const { sendMagicLink, verifyOtpCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  // > 0 の間は再送不可(残り秒数)。1秒ごとに減算し 0 で解除。
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      toast.error('メールアドレスを入力してください');
      return;
    }
    if (cooldown > 0) {
      // まだ Supabase の再送ブロック中。押しても失敗するので送らずに案内。
      toast('確認コードを送信しました。もう一度送信する場合は30秒ほどお待ちください。');
      return;
    }
    setLoading(true);
    try {
      await sendMagicLink(email);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SEC);
    } catch (err: unknown) {
      if (isSendRateLimitError(err)) {
        // 直前に送信済み(別タブ・別アプリ含む)。英語エラーは出さず日本語で待機を促す。
        // "after N seconds" があれば、その秒数(+余裕)までロックを延長する。
        const retryMsg = err instanceof Error ? err.message : '';
        const m = /after (\d+) seconds?/i.exec(retryMsg);
        setCooldown(m ? Math.max(RESEND_COOLDOWN_SEC, parseInt(m[1], 10) + 3) : RESEND_COOLDOWN_SEC);
        toast('確認コードを送信しました。もう一度送信する場合は30秒ほどお待ちください。');
      } else {
        // それ以外は実際の失敗理由を出す(例: "Signups not allowed for otp" = 未登録メール)
        const message = err instanceof Error ? err.message : 'エラーが発生しました';
        toast.error(`確認コードを送信できませんでした: ${message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < OTP_MIN_LEN || code.length > OTP_MAX_LEN) {
      toast.error('メールに記載された確認コードを入力してください');
      return;
    }
    setLoading(true);
    try {
      await verifyOtpCode(email, code);
      // 成功時は onAuthStateChange 経由で AuthGuard がアプリ本体へ切り替える
    } catch (err: unknown) {
      // expired = 期限切れ / invalid = コード誤り など
      const message = err instanceof Error ? err.message : 'エラーが発生しました';
      toast.error(`確認できませんでした: ${message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary shadow-lg mb-4">
            <Ruler size={28} className="text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Foot Measure
          </h1>
          <p className="text-sm text-muted-foreground mt-1">SPIRAL TURN 足計測システム</p>
        </div>

        <div className="bg-card rounded-2xl border border-border shadow-sm p-6">
          {step === 'email' ? (
            <>
              <h2 className="text-lg font-semibold mb-1">ログイン</h2>
              <p className="text-sm text-muted-foreground mb-5">
                登録済みのメールアドレスに確認コードを送信します。パスワードは不要です。
              </p>
              <form onSubmit={handleSendCode} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="email" className="text-sm font-medium">
                    メールアドレス
                  </label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="email"
                      type="email"
                      placeholder="your@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete="email"
                      disabled={loading}
                      autoFocus
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading || cooldown > 0}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      送信中...
                    </>
                  ) : cooldown > 0 ? (
                    '送信しました'
                  ) : (
                    '確認コードを送信'
                  )}
                </button>
                {cooldown > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    確認コードを送信しました。もう一度送信する場合は30秒ほどお待ちください。
                  </p>
                )}
              </form>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-1">確認コードを入力</h2>
              <p className="text-sm text-muted-foreground mb-5">
                <span className="font-medium text-foreground">{email}</span> に届いたメールに記載の
                確認コードを、この画面に入力してください。
                <span className="block mt-1 text-xs">
                  メール内のリンクは使わないでください（スマホでは正しくログインできません）。
                </span>
              </p>
              <form onSubmit={handleVerify} className="space-y-4">
                <div className="space-y-1.5">
                  <label htmlFor="otp" className="text-sm font-medium">
                    確認コード（メール記載）
                  </label>
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="otp"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={OTP_MAX_LEN}
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                      disabled={loading}
                      autoFocus
                      className="w-full pl-9 pr-3 py-2 rounded-lg border border-input bg-background text-lg text-center font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      確認中...
                    </>
                  ) : (
                    '確認してサインイン'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => { setStep('email'); setCode(''); }}
                  className="w-full text-xs text-muted-foreground underline text-center"
                >
                  メールアドレスを変更する
                </button>
                <p className="text-xs text-muted-foreground text-center">
                  コードが届かない場合は迷惑メールフォルダをご確認ください。
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
