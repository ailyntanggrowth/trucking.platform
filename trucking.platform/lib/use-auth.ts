"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
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

  // Guarda contra una carrera real (confirmada probando el flujo completo,
  // dos veces con causas distintas): Supabase a veces dispara MÁS de un
  // evento de sesión al procesar un link de recuperación/invitación (uno
  // genérico primero, PASSWORD_RECOVERY después) — el genérico alcanza a
  // arrancar loadProfile() antes de saberse que era de recuperación, y esa
  // llamada (asíncrona, espera al servidor) puede terminar DESPUÉS y pisar
  // el estado igual. Mientras este flag esté prendido, ni un evento
  // genérico nuevo ni una llamada a loadProfile ya en camino pueden tocar
  // el estado — solo setNewPassword (al terminar) o un cierre de sesión.
  const needsPasswordRef = useRef(false);

  const loadProfile = useCallback(async (accessToken: string, userEmail: string) => {
    try {
      const p = await getMyProfile(accessToken);
      // Carrera real confirmada probando el flujo completo: esta llamada
      // arranca por un evento de sesión que llegó ANTES de que se supiera
      // que el link era de recuperación/invitación, y termina DESPUÉS
      // (espera al servidor) — sin este chequeo, pisaba "needsPassword" con
      // "noProfile" ya con la pantalla de "Elige tu contraseña" en pantalla.
      if (needsPasswordRef.current) return;
      setEmail(userEmail);
      if (p && p.active) { setProfile(p); setStatus('ready'); }
      else if (p) { setProfile(p); setStatus('disabled'); }
      else { setProfile(null); setStatus('noProfile'); }
    } catch (e) { if (needsPasswordRef.current) return; setError((e as Error).message); setStatus('noProfile'); }
  }, []);

  useEffect(() => {
    const supabase = supabaseBrowser();

    // Comprobado directo contra Supabase (curl, sin adivinar): un link de
    // recuperación o invitación NO vuelve con "?code=" — vuelve con un
    // fragmento "#access_token=...&refresh_token=...&type=recovery". Eso
    // lo procesa automáticamente detectSessionInUrl (prendido en
    // lib/supabase-browser.ts), que es quien de verdad establece la sesión
    // y dispara el evento PASSWORD_RECOVERY — por eso init() ya NO llama a
    // getSession()/loadProfile por su cuenta: hacerlo era una carrera real
    // contra ese procesamiento automático (a veces ganaba uno, a veces el
    // otro, y a veces "needsPassword" se saltaba directo a la app). El
    // único "code=" que puede aparecer es el flujo PKCE por query string
    // (otros proveedores/flujos) — se sigue canjeando a mano por si acaso,
    // pero la fuente de verdad para TODO lo demás es únicamente
    // onAuthStateChange, una sola vez, sin dos caminos corriendo a la vez.
    async function exchangeCodeIfPresent() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (!code) return;
      await supabase.auth.exchangeCodeForSession(code);
      url.searchParams.delete('code');
      url.searchParams.delete('type');
      window.history.replaceState({}, '', url.toString());
    }
    void exchangeCodeIfPresent();

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') { needsPasswordRef.current = true; setEmail(session?.user.email || ''); setStatus('needsPassword'); return; }
      if (needsPasswordRef.current) return; // ver comentario junto a la declaración del ref
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
    needsPasswordRef.current = false;
    const { data } = await supabase.auth.getSession();
    if (data.session) void loadProfile(data.session.access_token, data.session.user.email || '');
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    needsPasswordRef.current = false;
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
