// ============================================================
// SPIRAL TURN - 認証コンテキスト（Supabase Magic Link）
// foot-measure: 特定ユーザーのみアクセス可能
// ============================================================
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, sendMagicLink as sendMagicLinkFn, verifyOtpCode as verifyOtpCodeFn, signOut as signOutFn } from '@/lib/supabase';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isLoggedIn: boolean;
  sendMagicLink: (email: string) => Promise<void>;
  verifyOtpCode: (email: string, token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 初回セッション取得
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    // セッション変更を監視
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const sendMagicLink = async (email: string) => {
    await sendMagicLinkFn(email);
  };

  const verifyOtpCode = async (email: string, token: string) => {
    await verifyOtpCodeFn(email, token);
  };

  const signOut = async () => {
    await signOutFn();
    setUser(null);
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      loading,
      isLoggedIn: !!session && !!user,
      sendMagicLink,
      verifyOtpCode,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
