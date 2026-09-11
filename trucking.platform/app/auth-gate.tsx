"use client";
import { useState, type FormEvent, type ReactNode } from 'react';
import type { AuthController } from '../lib/use-auth';
import type { Lang } from '../lib/i18n';
import { Truck } from 'lucide-react';
import styles from './auth-gate.module.css';

type View = 'login' | 'forgot';

export default function AuthGate({ auth, lang, t, children }: { auth: AuthController; lang: Lang; t: (es: string) => string; children: ReactNode }) {
  const [view, setView] = useState<View>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [newPassword2, setNewPassword2] = useState('');

  async function submitNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError('');
    if (newPassword.length < 8) { setError(t('La contraseña debe tener al menos 8 caracteres.')); return; }
    if (newPassword !== newPassword2) { setError(t('Las contraseñas no coinciden.')); return; }
    setBusy(true);
    try { await auth.setNewPassword(newPassword); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(''); setBusy(true);
    try { await auth.signInWithPassword(email, password); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function submitForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError(''); setBusy(true);
    try { await auth.sendPasswordReset(email); setResetSent(true); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }

  if (auth.status === 'ready') return <>{children}</>;
  if (auth.status === 'loading') return <div className={styles.screen}><div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div></div>;

  if (auth.status === 'needsPassword') {
    return <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
        <h1>{t('Elige tu contraseña')}</h1>
        <p className={styles.subtitle}>{auth.email ? `${t('Cuenta:')} ${auth.email}` : t('Esta contraseña es la que vas a usar cada vez que entres al sistema.')}</p>
        <form onSubmit={submitNewPassword}>
          <label>{t('Contraseña nueva')}<input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={t('Mínimo 8 caracteres')} /></label>
          <label>{t('Repite la contraseña')}<input type="password" required minLength={8} autoComplete="new-password" value={newPassword2} onChange={e => setNewPassword2(e.target.value)} /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Guardando…') : t('Guardar contraseña y entrar')}</button>
        </form>
      </div>
    </div>;
  }

  if (auth.status === 'noProfile') return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>{t('Sin acceso todavía')}</h1>
      <p>{t('El correo')} <b>{auth.email}</b> {t('no tiene acceso a este sistema. Pídele al administrador que te agregue desde Usuarios y Permisos.')}</p>
      <button onClick={() => void auth.signOut()}>{t('Probar con otra cuenta')}</button>
    </div>
  </div>;

  if (auth.status === 'disabled') return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>{t('Cuenta desactivada')}</h1>
      <p>{t('Tu acceso a este sistema fue desactivado. Pídele al dueño de la cuenta que te reactive desde Usuarios y Permisos.')}</p>
      <button onClick={() => void auth.signOut()}>{t('Salir')}</button>
    </div>
  </div>;

  if (view === 'forgot') return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>{t('Recuperar acceso')}</h1>
      {!resetSent ? <>
        <p className={styles.subtitle}>{t('Escribe tu correo y te mandamos un link para elegir una contraseña nueva.')}</p>
        <form onSubmit={submitForgot}>
          <label>{t('Correo')}<input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Enviando…') : t('Enviar link de recuperación')}</button>
        </form>
      </> : <p className={styles.success} role="status">{t('Listo — revisa tu correo')} <b>{email}</b> {t('y toca el link para elegir tu nueva contraseña.')}</p>}
      <button onClick={() => { setView('login'); setResetSent(false); setError(''); }}>{t('Volver a iniciar sesión')}</button>
    </div>
  </div>;

  return <div className={styles.screen}>
    <div className={styles.card}>
      <div className={styles.logo} aria-hidden="true"><Truck size={26} strokeWidth={1.75} /></div>
      <h1>M&amp;A KING</h1>
      <p className={styles.subtitle}>{t('Escribe tu correo y tu contraseña para entrar.')}</p>
      <form onSubmit={submitLogin}>
        <label>{t('Correo')}<input type="email" required autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@correo.com" /></label>
        <label>{t('Contraseña')}<input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? t('Entrando…') : t('Iniciar sesión')}</button>
      </form>
      <button onClick={() => { setView('forgot'); setError(''); }}>{t('¿Olvidaste tu contraseña?')}</button>
    </div>
  </div>;
}
