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
import { useState } from 'react';
import { Ruler, Loader2, Mail, KeyRound } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// 確認コードの許容桁数。Supabase の Email OTP Length 設定(既定6)に追従できるよう
// 固定長にせず幅を持たせる。generate_link は現状8桁を返すことがある。
const OTP_MIN_LEN = 4;
const OTP_MAX_LEN = 10;

export default function Login() {
  const { sendMagicLink, verifyOtpCode } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      toast.error('メールアドレスを入力してください');
      return;
    }
    setLoading(true);
    try {
      await sendMagicLink(email);
      setStep('code');
    } catch (err: unknown) {
      // 実際の失敗理由を出す(例: "Signups not allowed for otp" = 未登録メール)
      const message = err instanceof Error ? err.message : 'エラーが発生しました';
      toast.error(`確認コードを送信できませんでした: ${message}`);
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
                  disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      送信中...
                    </>
                  ) : (
                    '確認コードを送信'
                  )}
                </button>
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
