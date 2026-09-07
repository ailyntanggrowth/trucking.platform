"use client";
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import { getMyProfile } from './users-actions';
import type { Profile } from './users';

export type AuthStatus = 'loading' | 'signedOut' | 'noProfile' | 'disabled' | 'ready';

export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');

  const loadProfile = useCallback(async (accessToken: string, userEmail: string) => {
    try {
      const p = await getMyProfile(accessToken);
      setEmail(userEmail);
      if (p && p.active) { setProfile(p); setStatus('ready'); }
      else if (p) { setProfile(p); setStatus('disabled'); }
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

  // useCallback con deps [] es crítico aquí: use-chat.ts y use-my-loads.ts
  // reciben accessToken como dependencia de sus propios useEffect/useCallback.
  // Si esta función cambiara de referencia en cada render (como antes, al
  // ser una función plana redefinida cada vez), esos efectos se disparan de
  // nuevo en cada render → nuevo estado → nuevo render → loop infinito de
  // peticiones al servidor (justo lo que pasó al agregar useMyLoads).
  const sendMagicLink = useCallback(async (targetEmail: string) => {
    setError('');
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithOtp({ email: targetEmail.trim().toLocaleLowerCase(), options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined } });
    if (err) throw new Error(err.message);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
  }, []);

  const accessToken = useCallback(async (): Promise<string> => {
    const supabase = supabaseBrowser();
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Sesión inválida o vencida. Vuelve a entrar.');
    return data.session.access_token;
  }, []);

  return { status, email, profile, error, sendMagicLink, signOut, accessToken };
}
export type AuthController = ReturnType<typeof useAuth>;
