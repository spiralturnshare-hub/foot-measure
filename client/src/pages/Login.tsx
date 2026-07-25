// ============================================================
// SPIRAL TURN - ログインページ（Magic Link認証）
// foot-measure: 特定ユーザーのみアクセス可能
// ============================================================
import { useState } from 'react';
import { Ruler, Loader2, Mail, CheckCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export default function Login() {
  const { sendMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      toast.error('メールアドレスを入力してください');
      return;
    }
    setLoading(true);
    try {
      await sendMagicLink(email);
      setSent(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'エラーが発生しました';
      toast.error(message);
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
          {sent ? (
            <div className="flex flex-col items-center text-center gap-3 py-4">
              <CheckCircle size={40} className="text-green-500" />
              <h2 className="text-lg font-semibold">メールを送信しました</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">{email}</span> にログインリンクを送信しました。
                メールを確認してリンクをクリックしてください。
              </p>
              <button
                className="text-xs text-muted-foreground underline mt-2"
                onClick={() => setSent(false)}
              >
                別のメールアドレスで試す
              </button>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-5">ログイン</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
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
                    'ログインリンクを送信'
                  )}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
