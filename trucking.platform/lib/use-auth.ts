"use client";
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from './supabase-browser';
import { getMyProfile } from './users-actions';
import type { Profile } from './users';

// 'needsPassword': la persona llegó por un link de invitación o de
// recuperación (Supabase ya le abrió una sesión temporal) y debe fijar su
// contraseña antes de entrar al sistema — nunca se salta este paso.
export type AuthStatus = 'loading' | 'signedOut' | 'needsPassword' | 'noProfile' | 'disabled' | 'ready';

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
      // El link de invitación, de recuperación de contraseña y (antes) el
      // mágico vuelven todos con ?code=... (flujo PKCE, el default de
      // supabase-js) — hay que canjearlo por la sesión a mano; sin este
      // paso la persona "entraba" pero no quedaba sesión guardada en el
      // navegador, y por eso se le pedía iniciar sesión otra vez cada vez.
      //
      // "type=invite" o "type=recovery" en la URL (Supabase siempre lo
      // manda junto con el code en esos dos casos) es cómo se distingue un
      // link normal de un link que exige fijar contraseña antes de entrar
      // — sin importar el nombre exacto del evento que dispare Supabase.
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      const linkType = url.searchParams.get('type');
      let forcePasswordSetup = false;
      if (code) {
        await supabase.auth.exchangeCodeForSession(code);
        forcePasswordSetup = linkType === 'invite' || linkType === 'recovery';
        url.searchParams.delete('code');
        url.searchParams.delete('type');
        window.history.replaceState({}, '', url.toString());
      }
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session) { setStatus('signedOut'); return; }
      if (forcePasswordSetup) { setEmail(session.user.email || ''); setStatus('needsPassword'); return; }
      void loadProfile(session.access_token, session.user.email || '');
    }
    void init();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { setEmail(session?.user.email || ''); setStatus('needsPassword'); return; }
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
  const signInWithPassword = useCallback(async (targetEmail: string, password: string) => {
    setError('');
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.signInWithPassword({ email: targetEmail.trim().toLocaleLowerCase(), password });
    if (err) throw new Error(err.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : err.message);
  }, []);

  const sendPasswordReset = useCallback(async (targetEmail: string) => {
    setError('');
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.resetPasswordForEmail(targetEmail.trim().toLocaleLowerCase(), { redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined });
    if (err) throw new Error(err.message);
  }, []);

  // Se usa tanto para "fijar contraseña la primera vez" (invitación) como
  // para "ya elegí mi nueva contraseña" (recuperación) — Supabase ya dejó
  // una sesión temporal activa en ambos casos, así que es la misma llamada.
  const setNewPassword = useCallback(async (password: string) => {
    setError('');
    const supabase = supabaseBrowser();
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) throw new Error(err.message);
    const { data } = await supabase.auth.getSession();
    if (data.session) void loadProfile(data.session.access_token, data.session.user.email || '');
  }, [loadProfile]);

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

  return { status, email, profile, error, signInWithPassword, sendPasswordReset, setNewPassword, signOut, accessToken };
}
export type AuthController = ReturnType<typeof useAuth>;
