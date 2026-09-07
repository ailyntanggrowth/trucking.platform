"use client";
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import { getMyProfile } from './users-actions';
import type { Profile } from './users';

export type AuthStatus = 'loading' | 'signedOut' | 'noProfile' | 'ready';

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async (accessToken: string, userEmail: string) => {
    try {
      const p = await getMyProfile(accessToken);
      setEmail(userEmail);
      if (p) { setProfile(p); setStatus('ready'); }
      else { setProfile(null); setStatus('noProfile'); }
    } catch (e) { setError((e as Error).message); setStatus('noProfile'); }
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();
    async function init() {
      // El link mágico vuelve con ?code=... (flujo PKCE, el default de supabase-js
      // desde hace varias versiones) — hay que canjearlo por la sesión a mano; a
      // diferencia del viejo flujo #access_token=..., esto NUNCA pasa solo. Sin
      // este paso, la persona "entraba" pero no quedaba sesión guardada en el
      // navegador, y por eso el correo se pedía otra vez cada vez.
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        url.searchParams.delete('code');
        window.history.replaceState({}, '', url.toString());
      }
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session) void loadProfile(session.access_token, session.user.email || '');
      else setStatus('signedOut');
    }
    void init();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) void loadProfile(session.access_token, session.user.email || '');
      else { setProfile(null); setEmail(''); setStatus('signedOut'); }
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  async function sendMagicLink(targetEmail: string) {
    setError('');
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithOtp({ email: targetEmail.trim().toLocaleLowerCase(), options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined } });
    if (err) throw new Error(err.message);
  }

  async function signOut() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
  }

  async function accessToken(): Promise<string> {
    const supabase = supabaseBrowser();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
    return data.session.access_token;
  }

  return { status, email, profile, error, sendMagicLink, signOut, accessToken };
}
export type AuthController = ReturnType<typeof useAuth>;
